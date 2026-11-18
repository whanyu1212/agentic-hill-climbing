import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cloudRunExecutor } from "./executor";

test.each([0, 1])("removes sandbox after exit %i", async (exitCode) => {
  const directory = await mkdtemp(join(tmpdir(), "forecast-sandbox-"));
  try {
    const launcher = join(directory, "launcher");
    await writeFile(
      launcher,
      `#!/bin/sh
printf '%s\\n' "$*" >> "$0.calls"
case "$1" in
  run) cat >/dev/null; printf '[100]'; exit ${exitCode} ;;
  delete) exit 0 ;;
  *) exit 125 ;;
esac
`,
      { mode: 0o700 },
    );
    const execute = cloudRunExecutor(launcher);
    const result = execute("trusted test source", {
      history: [],
      forecast_dates: [],
    });
    if (exitCode === 0) {
      await expect(result).resolves.toEqual([100]);
    } else {
      await expect(result).rejects.toThrow("Candidate exited with status 1");
    }

    const [run, cleanup] = (await readFile(`${launcher}.calls`, "utf8"))
      .trimEnd()
      .split("\n");
    expect(run).toStartWith("run --rootfs /opt/python-rootfs ");
    expect(run).not.toContain("--allow-egress");
    const name = run.split(" -- ")[0].split(" ").at(-1);
    expect(name).toMatch(/^hill-climb-/);
    expect(cleanup).toBe(`delete --force ${name}`);
  } finally {
    await rm(directory, { recursive: true });
  }
});
