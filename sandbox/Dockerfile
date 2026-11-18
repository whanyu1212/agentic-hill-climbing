FROM python:3.12-slim AS dependencies

COPY --from=ghcr.io/astral-sh/uv:0.9.8 /uv /usr/local/bin/uv

WORKDIR /opt/sandbox
COPY sandbox/pyproject.toml sandbox/uv.lock ./
RUN uv sync --locked --no-dev --no-install-project --no-python-downloads

FROM python:3.12-slim AS sandbox

COPY --from=dependencies /opt/sandbox/.venv /opt/sandbox/.venv
COPY sandbox/run_candidate.py /opt/sandbox/run_candidate.py

ENV PATH="/opt/sandbox/.venv/bin:$PATH" \
    PYTHONDONTWRITEBYTECODE=1 \
    OPENBLAS_NUM_THREADS=1 \
    OMP_NUM_THREADS=1 \
    MKL_NUM_THREADS=1
WORKDIR /opt/sandbox
USER 65532:65532
ENTRYPOINT ["/opt/sandbox/.venv/bin/python"]

FROM oven/bun:1.3.11 AS cloud

WORKDIR /app/orchestrator
COPY orchestrator/package.json orchestrator/bun.lock ./
RUN bun install --production --frozen-lockfile
COPY orchestrator/src ./src
COPY candidates/baseline.py /app/candidates/baseline.py
COPY --from=sandbox / /opt/python-rootfs/

ENV FORECAST_EXECUTOR=cloud-run
ENTRYPOINT ["bun", "run", "src/cli.ts"]
