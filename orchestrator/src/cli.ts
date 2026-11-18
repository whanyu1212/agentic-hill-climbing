import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { cloudArtifacts, localArtifacts } from "./artifacts";
import { cloudRunExecutor, dockerExecutor } from "./executor";
import { withOpenCode, type Propose } from "./propose";
import { fetchRidership, nyToday, validDate } from "./ridership";
import { replaySnapshot } from "./snapshot";
import { runWeek, scorePublished } from "./weekly";

async function main(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      "baseline-only": { type: "boolean" },
      live: { type: "boolean" },
    },
    allowPositionals: true,
  });
  const baselineOnly = values["baseline-only"];
  const replay = values.live ? undefined : replaySnapshot;
  const latestStart = replay?.defaultStart ?? nyToday();
  const asOf = positionals[0] ?? latestStart;
  if (positionals.length > 1 || !validDate(asOf) || asOf > latestStart) {
    throw new Error(
      `Usage: bun run forecast [--baseline-only] [--live] [YYYY-MM-DD]; latest start is ${latestStart}.`,
    );
  }
  const model = process.env.FORECAST_MODEL;
  if (!model && !baselineOnly) {
    throw new Error(
      "Set FORECAST_MODEL=provider/model or pass --baseline-only.",
    );
  }
  const cloud = process.env.FORECAST_EXECUTOR === "cloud-run";
  const bucket = process.env.FORECAST_BUCKET;
  if (cloud && (!bucket || baselineOnly)) {
    throw new Error(
      "Cloud mode requires FORECAST_BUCKET and an OpenCode model.",
    );
  }
  const kind = baselineOnly ? "baseline" : "forecasts";
  const folder = replay ? `snapshots/${replay.id}/${kind}` : kind;
  const store =
    bucket && !baselineOnly
      ? cloudArtifacts(bucket, `${folder}/`)
      : await localArtifacts(
          fileURLToPath(new URL(`../../artifacts/${folder}/`, import.meta.url)),
        );
  const key = `${asOf}.json`;
  const keys = await store.list();
  if (keys.includes(key)) {
    console.log(`Forecast ${asOf} is already published.`);
    return;
  }
  const prior = keys
    .filter((existing) => existing < key)
    .sort()
    .reverse();
  const baseline = await readFile(
    new URL("../../candidates/baseline.py", import.meta.url),
    "utf8",
  );
  const history = replay?.history ?? (await fetchRidership(asOf));
  const previous = prior.length ? await store.read(prior[0]) : undefined;
  let lastLiveScore: ReturnType<typeof scorePublished> = null;
  if (!replay) {
    for (const earlier of prior) {
      lastLiveScore = scorePublished(history, await store.read(earlier));
      if (lastLiveScore) break;
    }
  }
  const execute = cloud ? cloudRunExecutor() : dockerExecutor();
  const run = (propose?: Propose) =>
    runWeek({ asOf, history, baseline, previous, execute, propose });
  const result =
    baselineOnly || !model
      ? await run()
      : await withOpenCode(
          model,
          run,
          !cloud && process.env.FORECAST_USE_LOCAL_SERVICE === "1",
        );
  const evaluation = replay
    ? { snapshotId: replay.id, replayScore: scorePublished(history, result) }
    : { lastLiveScore };
  const artifact = { ...result, ...evaluation };
  if (!(await store.publish(key, artifact))) {
    console.log(`Forecast ${asOf} was already published by another run.`);
    return;
  }
  console.log(
    JSON.stringify(
      {
        asOf,
        promoted: result.promoted,
        experiments: result.experiments.length,
        promotion: result.promotion,
        ...evaluation,
      },
      null,
      2,
    ),
  );
}

await main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : "Forecast run failed.",
  );
  process.exitCode = 1;
});
