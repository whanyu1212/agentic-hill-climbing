#!/usr/bin/env bash
set -euo pipefail

image="${1:?Usage: bash infra/build-cloud-image.sh IMAGE}"
platform=linux/amd64

docker build --platform "$platform" -f sandbox/Dockerfile --target cloud -t "$image" .
docker run --rm --platform "$platform" --network none --entrypoint bun "$image" \
  run src/smoke.ts

# Check the copied Python rootfs without relying on the Cloud Run launcher.
docker run --rm --platform "$platform" --network none --entrypoint chroot "$image" \
  --userspec=65532:65532 /opt/python-rootfs /opt/sandbox/.venv/bin/python \
  -c 'import numpy, pandas, scipy, sklearn, statsmodels'
