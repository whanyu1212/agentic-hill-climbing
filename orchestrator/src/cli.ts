import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { cloudArtifacts, localArtifacts } from "./artifacts";
import { cloudRunExecutor, dockerExecutor } from "./executor";
import { withOpenCode, type Propose } from "./propose";
import { fetchRidership, nyToday, validDate } from "./ridership";
import { runWeek, scorePublished } from "./weekly";

async function main(args: string[]): Promise<void> {
  const baselineOnly = args[0] === "--baseline-only";
  const dates = baselineOnly ? args.slice(1) : args;
  const asOf = dates[0] ?? nyToday();
  if (dates.length > 1 || !validDate(asOf) || asOf > nyToday()) {
    throw new Error("Usage: bun run forecast [--baseline-only] [YYYY-MM-DD]");
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
  const folder = baselineOnly ? "baseline" : "forecasts";
  const store =
    bucket && !baselineOnly
      ? cloudArtifacts(bucket)
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
  const history = await fetchRidership(asOf);
  const previous = prior.length ? await store.read(prior[0]) : undefined;
  let lastLiveScore: ReturnType<typeof scorePublished> = null;
  for (const earlier of prior) {
    lastLiveScore = scorePublished(history, await store.read(earlier));
    if (lastLiveScore) break;
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
  const artifact = { ...result, lastLiveScore };
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
        lastLiveScore,
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
