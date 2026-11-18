import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { Observation } from "./ridership";

export interface FoldInput {
  history: Observation[];
  forecast_dates: string[];
}

export type ExecuteCandidate = (
  source: string,
  input: FoldInput,
) => Promise<unknown>;

export class CandidateError extends Error {}

export const MAX_SOURCE_BYTES = 24_000;
const MAX_OUTPUT_BYTES = 32_768;
const TRIAL_TIMEOUT_MS = 25_000;

function runProcess(
  command: string[],
  input: string,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command[0], command.slice(1), {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    let outputBytes = 0;
    let failure: Error | undefined;

    function stop(error: Error): void {
      failure ??= error;
      child.kill("SIGKILL");
    }

    function count(chunk: Buffer): boolean {
      outputBytes += chunk.length;
      if (outputBytes <= MAX_OUTPUT_BYTES) return true;
      stop(new CandidateError("Sandbox output exceeded the limit."));
      return false;
    }

    const timer = setTimeout(() => {
      stop(new CandidateError("Sandbox execution exceeded its deadline."));
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      if (count(chunk)) stdout.push(chunk);
    });
    child.stderr.on("data", count);
    child.stdin.on("error", () => {
      // An early exit can close stdin before the whole request is delivered.
    });
    child.on("error", (error) => {
      failure ??= error;
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (failure) reject(failure);
      else if (code === 125 || code === 126 || code === 127) {
        reject(new Error(`Sandbox launcher failed with status ${code}.`));
      } else if (code !== 0) {
        reject(new CandidateError(`Candidate exited with status ${code}.`));
      } else {
        resolve(Buffer.concat(stdout).toString("utf8"));
      }
    });
    child.stdin.end(input);
  });
}

export function dockerExecutor(
  image = "hill-climbing-python",
): ExecuteCandidate {
  return isolatedExecutor(
    (name) => [
      "docker",
      "run",
      "--rm",
      "--pull=never",
      "--name",
      name,
      "-i",
      "--network=none",
      "--read-only",
      "--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=64m",
      "--memory=1g",
      "--memory-swap=1g",
      "--cpus=1",
      "--pids-limit=64",
      "--cap-drop=ALL",
      "--security-opt=no-new-privileges",
      image,
      "/opt/sandbox/run_candidate.py",
    ],
    (name) => ["docker", "rm", "-f", name],
  );
}

export function cloudRunExecutor(
  launcher = "/usr/local/gcp/bin/sandbox",
): ExecuteCandidate {
  // The preview launcher can use a custom rootfs with `run` but not `do`.
  return isolatedExecutor(
    (name) => [
      launcher,
      "run",
      "--rootfs",
      "/opt/python-rootfs",
      "--workdir",
      "/opt/sandbox",
      "--env",
      "PYTHONDONTWRITEBYTECODE=1",
      "--env",
      "OPENBLAS_NUM_THREADS=1",
      "--env",
      "OMP_NUM_THREADS=1",
      "--env",
      "MKL_NUM_THREADS=1",
      name,
      "--",
      "/opt/sandbox/.venv/bin/python",
      "/opt/sandbox/run_candidate.py",
    ],
    (name) => [launcher, "delete", "--force", name],
    { removeAfterSuccess: true },
  );
}

function isolatedExecutor(
  run: (name: string) => string[],
  remove: (name: string) => string[],
  { removeAfterSuccess = false } = {},
): ExecuteCandidate {
  return async (source, input) => {
    const name = `hill-climb-${randomUUID()}`;
    const cleanup = () => runProcess(remove(name), "", 5_000);
    let output: string;
    try {
      output = await runProcess(
        run(name),
        JSON.stringify({ source, ...input }),
        TRIAL_TIMEOUT_MS,
      );
    } catch (error) {
      // A killed launcher can leave its sandbox running; it may also already be gone.
      await cleanup().catch(() => {});
      throw error;
    }
    if (removeAfterSuccess) {
      try {
        await cleanup();
      } catch (cause) {
        throw new Error(`Failed to remove Cloud Run sandbox ${name}.`, {
          cause,
        });
      }
    }
    try {
      return JSON.parse(output);
    } catch {
      throw new CandidateError("Candidate output must be a JSON array.");
    }
  };
}
