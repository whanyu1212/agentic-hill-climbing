# Agentic Hill Climbing

A proof of concept for using the OpenCode SDK to improve a seven-day NYC subway ridership forecast. OpenCode proposes a Python model, a trusted evaluator backtests it, and the loop keeps it only if it improves on the current best. A forecast blend that refits without an agent is the comparison baseline.

By default the loop replays a [pinned snapshot](orchestrator/data/mta-subway-2026-11-15.json) of [MTA daily ridership estimates](https://data.ny.gov/d/sayj-mze2). It gives OpenCode up to three attempts on four search weeks, then tests only the winner on three separate promotion weeks. To replace the current model, the winner must beat both the current model and the refitted blend on promotion mean absolute error (MAE). The replay target is scored separately after model selection; its actuals are not used for training or promotion.

## Layout

| Path | Purpose |
| --- | --- |
| [`orchestrator/`](orchestrator/) | Bun and TypeScript project for the OpenCode SDK, evaluator, and Cloud Storage access |
| [`sandbox/`](sandbox/) | Python 3.12 environment and Docker image for candidate execution |
| [`candidates/`](candidates/) | Python candidate interface and refitted-blend baseline |
| [`infra/`](infra/) | GCP setup and scheduling instructions |

## Local setup

Prerequisites: Bun and Docker. uv and Python 3.12 are optional for inspecting dependencies.

```sh
bun install --cwd orchestrator --frozen-lockfile
docker build -f sandbox/Dockerfile --target sandbox -t hill-climbing-python .
cd orchestrator
bun test
bun run forecast --baseline-only
```

The baseline-only command uses the bundled MTA history without contacting MTA or a model provider. To try the agent loop from `orchestrator/`, configure credentials for your chosen OpenCode provider and run:

```sh
FORECAST_MODEL=provider/model bun run forecast
```

The embedded SDK uses an in-memory credential store, so supply a provider environment variable such as `OPENAI_API_KEY`. To use an account already connected to your **running local OpenCode service** instead, set `FORECAST_USE_LOCAL_SERVICE=1` along with `FORECAST_MODEL`. This option doesn't apply on Cloud Run.

The default replay targets November 9–15, 2026, the last complete week in the snapshot. You can pass an earlier start date, such as `2026-11-02`. Run replay dates in chronological order so each week starts from the previous winner. Snapshot artifacts are written once under `artifacts/snapshots/<snapshot-id>/baseline/` or `artifacts/snapshots/<snapshot-id>/forecasts/`, with a replay score for the target week. Running the same window again in the same store skips existing results.

Use `bun run forecast --live` to forecast the next seven dates starting today in New York. Live results are separate (`artifacts/forecasts/`, or `artifacts/baseline/` with `--baseline-only`). Training ends two calendar days before the target start in both modes. Live mode stops without publishing if the feed is incomplete, and scores a previously published forecast once its actuals are available. Candidate code only runs in the sandbox. See [the GCP deployment instructions](infra/README.md).
