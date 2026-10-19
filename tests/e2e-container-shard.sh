#!/usr/bin/env bash
# Runs the Playwright e2e suite (or one --shard of it) against a TimeHuddle
# Docker image — the same image pr-preview.yml builds for Launchpad — instead
# of a local `meteor run`. The image already contains MongoDB (replica set)
# and a prebuilt Meteor bundle, so the backend starts in seconds and always
# matches the code it was built from. Only its Mongo + Meteor are used: the
# frontend comes from Playwright's own webServer (Vite on this machine), the
# same as a local run, so the image's baked-in preview URLs don't matter.
#
# This is what CI runs per shard (see the e2e job in pr-preview.yml) — one
# shard per runner VM, so shards scale across machines rather than competing
# for one laptop's RAM the way tests/e2e-shard-runner.sh's pm2 shards do.
#
# Requires Linux: the image's mongod listens on 127.0.0.1 only, so the
# container shares this host's network (--network host) for global-setup and
# the specs that talk to Mongo directly. On macOS, use `npm run test:sharded`.
#
# Usage:
#   tests/e2e-container-shard.sh <image> [playwright-test-args...]
# Example:
#   tests/e2e-container-shard.sh ghcr.io/mieweb/timehuddle:pr-717 --shard=2/6
set -uo pipefail
cd "$(dirname "$0")/.."

IMAGE="${1:?usage: $0 <image> [playwright-test-args...]}"
shift

BACKEND_URL="http://localhost:3100"
E2E_FRONTEND_URL="http://localhost:3003"
MONGO_URL="mongodb://127.0.0.1:27017/timehuddle_test?replicaSet=rs0"
MAILPIT_IMAGE="axllent/mailpit:v1.31.3"
APP_CONTAINER="timehuddle-e2e-app-$$"
MAILPIT_CONTAINER="timehuddle-e2e-mailpit-$$"

# Both containers are removed on every exit path; INT/TERM only set the code
# so the EXIT trap runs cleanup exactly once (same pattern as
# e2e-shard-runner.sh). Nothing started here outlives the run.
cleanup() {
  docker rm -f "$APP_CONTAINER" "$MAILPIT_CONTAINER" > /dev/null 2>&1 || true
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

echo "=== Starting Mailpit ($MAILPIT_IMAGE) on :1025 (SMTP) / :8025 (API) ==="
docker run -d --name "$MAILPIT_CONTAINER" --network host "$MAILPIT_IMAGE" > /dev/null || exit 1

echo "=== Starting backend from $IMAGE ==="
# The PR-preview image bakes DEV_QUICK_LOGIN_ENABLED=true for reviewers;
# tests run against the normal sign-in surface. REDMINE_ENCRYPTION_KEY is a
# throwaway — the Redmine specs mock the Redmine API in the browser, but
# redmine-crypto.js throws when the key is unset.
docker run -d --name "$APP_CONTAINER" --network host \
  -e MONGO_URL="$MONGO_URL" \
  -e ROOT_URL="$BACKEND_URL" \
  -e APP_URL="$E2E_FRONTEND_URL" \
  -e CORS_ORIGINS="$BACKEND_URL,$E2E_FRONTEND_URL" \
  -e DEV_QUICK_LOGIN_ENABLED=false \
  -e SMTP_HOST=127.0.0.1 \
  -e SMTP_PORT=1025 \
  -e SMTP_SECURE=false \
  -e EMAIL_FROM="TimeHuddle <noreply@timehuddle.local>" \
  -e REDMINE_BASE_URL="https://redmine0.os.mieweb.org" \
  -e REDMINE_ENCRYPTION_KEY="e2e-only-throwaway-key" \
  "$IMAGE" > /dev/null || exit 1

deadline=$((SECONDS + 180))
until curl -sf "$BACKEND_URL/health" > /dev/null 2>&1; do
  if [ "$SECONDS" -ge "$deadline" ]; then
    echo "ERROR: backend did not become healthy within 180s ($BACKEND_URL/health)" >&2
    docker logs --tail 100 "$APP_CONTAINER" >&2
    exit 1
  fi
  sleep 2
done
echo "Backend healthy ($BACKEND_URL/health)"

MONGO_URL="$MONGO_URL" \
API_TARGET="$BACKEND_URL" \
METEOR_BASE_URL="$BACKEND_URL" \
METEOR_WS="ws://localhost:3100/websocket" \
MAILPIT_URL="http://localhost:8025" \
  npx playwright test -c tests/playwright.config.ts "$@"
status=$?

if [ "$status" -ne 0 ]; then
  echo "=== Backend log tail (tests failed) ==="
  docker logs --tail 200 "$APP_CONTAINER" 2>&1
fi
exit "$status"
