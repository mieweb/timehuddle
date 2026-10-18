#!/usr/bin/env bash
# Runs the Playwright e2e suite as isolated shards in parallel. Shard 1 reuses
# the existing timehuddle-meteor-test instance (port 3101, db timehuddle_test)
# — the always-on dev service, never touched by this script. Shards 2+ are
# started here and ALWAYS stopped again on exit (success, failure, or
# Ctrl-C/kill) so nothing from this run keeps running in the background
# afterward — Playwright's own webServer cleanup does not reliably fire if
# global-setup throws before the test phase starts, so this does not rely on
# it: it force-kills anything left bound to each shard's e2e port too.
#
# No test files or fixtures are touched by this script — it only varies
# which backend/db/port each shard's Playwright process points at via env
# vars the suite already reads (MONGO_URL, API_TARGET, E2E_PORT).
#
# Usage:
#   tests/e2e-shard-runner.sh [playwright-test-args...]
#
# Examples:
#   tests/e2e-shard-runner.sh                             # full suite, all shards
#   tests/e2e-shard-runner.sh tests/e2e/huddle/*.spec.ts  # just these files
set -uo pipefail
cd "$(dirname "$0")/.."

# Number of shards to run — must match 1 + E2E_EXTRA_SHARDS in
# ecosystem.config.cjs (that's where the extra shards' pm2 apps come from).
# Ports/db names are derived by formula below, not hardcoded, so growing the
# suite over time (more spec files) needs no changes here — Playwright's own
# --shard=i/N already rebalances whatever files exist across however many
# shards this is set to. Bump both constants together to add more shards.
E2E_SHARDS="${E2E_SHARDS:-3}"

# Shard N -> "pm2-app-name:port:db-name:e2e-port". Shard 1 has no pm2-app-name
# — it's the pre-existing always-on timehuddle-meteor-test, never stopped by
# this script. Must match extraShardPort()/extraShardE2EPort() in
# ecosystem.config.cjs.
shard_def() {
  local shard_num="$1"
  local port=$((3100 + shard_num))
  local e2e_port=$((3002 + shard_num))
  if [ "$shard_num" -eq 1 ]; then
    echo ":${port}:timehuddle_test:${e2e_port}"
  else
    echo "timehuddle-meteor-test${shard_num}:${port}:timehuddle${shard_num}_test:${e2e_port}"
  fi
}

# Handles graceful exits (success, failure, Ctrl-C). A run that gets
# force-killed (SIGKILL) skips this entirely — see e2e-shard-cleanup.sh,
# which is the backstop for that case and shares the same kill logic.
cleanup() {
  echo
  echo "=== Cleanup ==="
  tests/e2e-shard-cleanup.sh
}
trap cleanup EXIT INT TERM

wait_for_health() {
  local url="$1" label="$2" deadline=$((SECONDS + 120))
  until curl -sf "$url/health" > /dev/null 2>&1; do
    if [ "$SECONDS" -ge "$deadline" ]; then
      echo "ERROR: $label did not become healthy within 120s ($url/health)" >&2
      exit 1
    fi
    sleep 2
  done
  echo "$label healthy ($url/health)"
}

n="$E2E_SHARDS"
pids=()
for shard_num in $(seq 1 "$n"); do
  IFS=':' read -r app port db e2e_port <<< "$(shard_def "$shard_num")"

  if [ -n "$app" ]; then
    echo "=== Ensuring shard-$shard_num backend ($app) is running ==="
    pm2 start ecosystem.config.cjs --only "$app" > /dev/null 2>&1 || true
  fi

  wait_for_health "http://localhost:$port" "shard-$shard_num backend"
done

for shard_num in $(seq 1 "$n"); do
  mkdir -p "playwright-report-shard$shard_num"
done

for shard_num in $(seq 1 "$n"); do
  IFS=':' read -r app port db e2e_port <<< "$(shard_def "$shard_num")"
  echo "=== Launching shard $shard_num/$n (port $port, db $db, vite :$e2e_port) ==="
  (
    MONGO_URL="mongodb://127.0.0.1:27017/$db?replicaSet=rs0" \
    API_TARGET="http://localhost:$port" \
    METEOR_BASE_URL="http://localhost:$port" \
    E2E_PORT="$e2e_port" \
    PLAYWRIGHT_HTML_REPORT="../playwright-report-shard$shard_num" \
    npx playwright test -c tests/playwright.config.ts --shard="$shard_num/$n" "$@" \
      > "playwright-report-shard$shard_num.log" 2>&1
  ) &
  pids+=("$!")
done

status=0
for pid in "${pids[@]}"; do
  wait "$pid" || status=1
done

for shard_num in $(seq 1 "$n"); do
  echo
  echo "=== shard $shard_num/$n summary ==="
  tail -n 15 "playwright-report-shard$shard_num.log"
done

exit "$status"
