#!/usr/bin/env bash
# Builds the before/after perf comparison image (see README.md) and, by default,
# pushes it. Runs the same locally (Docker with buildx) and in CI
# (.github/workflows/perf-env.yml).
#
#   PERF_PASSWORD=… tests/performance/env/build.sh
#
# Env (defaults in brackets):
#   PERF_PASSWORD  required — sign-in password for the perf account
#   PERF_EMAIL     [perf-bot@test.local]
#   OLD_REF        [c9dc10f9… — main as measured in PR #691] commit served as "old"
#   API_URL        [https://huddle-perf-api.os.mieweb.org]  public URL of port 3100
#   NEW_URL        [https://huddle-perf-new.os.mieweb.org]  public URL of port 3001
#   IMAGE          [ghcr.io/mieweb/timehuddle:perf]         also pushes "$IMAGE-base"
#   PLATFORM       [linux/amd64]                            the cluster's architecture
#   PUSH           [1] — 0 loads the image into the local Docker instead
#
# The "new" side is whatever is checked out; run it from the commit to measure.
set -euo pipefail

: "${PERF_PASSWORD:?PERF_PASSWORD is required}"
PERF_EMAIL="${PERF_EMAIL:-perf-bot@test.local}"
OLD_REF="${OLD_REF:-c9dc10f92898ddc55b3fcf17cbdc7d02dac59b48}"
API_URL="${API_URL:-https://huddle-perf-api.os.mieweb.org}"
NEW_URL="${NEW_URL:-https://huddle-perf-new.os.mieweb.org}"
IMAGE="${IMAGE:-ghcr.io/mieweb/timehuddle:perf}"
PLATFORM="${PLATFORM:-linux/amd64}"
PUSH="${PUSH:-1}"

cd "$(git rev-parse --show-toplevel)"
if [ ! -d vendor/meteor-wormhole/packages ]; then
  echo "vendor/meteor-wormhole is missing — run: git submodule update --init vendor/meteor-wormhole" >&2
  exit 1
fi

OUTPUT=(--push)
[ "$PUSH" = "1" ] || OUTPUT=(--load)

echo "==> Base image (new side, $(git rev-parse --short HEAD)) → $IMAGE-base"
docker buildx build --platform "$PLATFORM" -f Dockerfile \
  --build-arg VITE_TIMECORE_URL="$API_URL" \
  --build-arg VITE_DEV_QUICK_LOGIN=true \
  --build-arg DEV_QUICK_LOGIN_ENABLED=true \
  -t "$IMAGE-base" "${OUTPUT[@]}" .

echo "==> Comparison image (old side, ${OLD_REF:0:8}) → $IMAGE"
docker buildx build --platform "$PLATFORM" -f tests/performance/env/Dockerfile \
  --build-arg BASE_IMAGE="$IMAGE-base" \
  --build-arg OLD_REF="$OLD_REF" \
  --build-arg API_URL="$API_URL" \
  --build-arg NEW_URL="$NEW_URL" \
  --build-arg PERF_EMAIL="$PERF_EMAIL" \
  --build-arg PERF_PASSWORD="$PERF_PASSWORD" \
  -t "$IMAGE" "${OUTPUT[@]}" .
