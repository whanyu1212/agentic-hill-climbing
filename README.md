# Agentic Hill Climbing

A proof of concept for using the OpenCode SDK to improve a seven-day NYC subway ridership forecast. Each week, OpenCode proposes a Python model, a trusted evaluator backtests it, and the loop keeps it only if it improves on the current best. A forecast blend that refits weekly without an agent is the comparison baseline.

The loop reads [MTA daily ridership estimates](https://data.ny.gov/d/sayj-mze2). It gives OpenCode up to three attempts on four search weeks, then tests only the winner on three separate promotion weeks. To replace the current model, the winner must beat both the current model and the refitted blend on promotion mean absolute error (MAE). Published forecasts are scored separately once all seven actuals arrive.

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
bun run forecast --baseline-only 2026-09-07
```

The baseline-only command uses real MTA history without contacting a model provider. Results go to `artifacts/baseline/`. To try the agent loop from `orchestrator/`, configure credentials for your chosen OpenCode provider and run:

```sh
FORECAST_MODEL=provider/model bun run forecast 2026-09-07
FORECAST_MODEL=provider/model bun run forecast 2026-09-14
```

The embedded SDK uses an in-memory credential store, so supply a provider environment variable such as `OPENAI_API_KEY`. To use an account already connected to your **running local OpenCode service** instead, set `FORECAST_USE_LOCAL_SERVICE=1` along with `FORECAST_MODEL`. This option doesn't apply on Cloud Run.

Run replay dates in chronological order so each week starts from the previous winner. Replay uses the currently published historical data, which may include revisions. Omit the date to forecast the next seven dates starting today in New York. Training ends two calendar days before the target start to allow for reporting lag. The job fails without publishing if recent history is incomplete.

Each `artifacts/forecasts/YYYY-MM-DD.json` is written once and includes the source, both forecasts, trial scores, promotion decision, and the latest available score for a previously locked forecast. Candidate code only runs in the sandbox. For a recurring GCP deployment, see [the deployment instructions](infra/README.md).
