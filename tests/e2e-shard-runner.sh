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

# Job control: with this on, each `( ... ) &` background shard job below
# becomes its own process group (PGID == its own PID), so `kill -TERM -$pgid`
# in cleanup() reaches the npx/node/playwright tree, not just the subshell
# `wait` sees. It does NOT reach the Vite server or browsers: Playwright
# launches those detached, in process groups of their own — the run ID below
# is what finds those.
set -m

# Every process this run starts inherits E2E_SHARD_RUN_ID, including the
# detached Vite servers and browsers. e2e-shard-cleanup.sh kills by this ID
# and nothing else, so other projects' Vite/Chromium/Playwright processes on
# this machine are never touched. The state file is what lets a standalone
# cleanup recover a run that was SIGKILLed before its EXIT trap could fire.
#
# Checked before the EXIT trap exists on purpose: refusing to start must not
# trigger cleanup, which would read this file and kill the run it points at.
RUN_STATE_FILE=".e2e-shard-run"
if [ -f "$RUN_STATE_FILE" ]; then
  prev_run_id=$(cat "$RUN_STATE_FILE")
  prev_pid="${prev_run_id##*-}"
  if ps -o command= -p "$prev_pid" 2>/dev/null | grep -q "e2e-shard-runner.sh"; then
    echo "ERROR: another sharded run is still in progress (pid $prev_pid)." >&2
    echo "Both would reset the same shard databases. Wait for it, or stop it" \
      "with: npm run test:sharded:cleanup" >&2
    exit 1
  fi
  echo "=== Previous sharded run ($prev_run_id) never cleaned up — recovering it ==="
  tests/e2e-shard-cleanup.sh
fi
export E2E_SHARD_RUN_ID="e2e-$(date +%s)-$$"
echo "$E2E_SHARD_RUN_ID" > "$RUN_STATE_FILE"

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
#
# INT/TERM only set the exit code and return — they do NOT call cleanup
# directly. Bash still runs the EXIT trap after any trap handler returns (or
# calls `exit`), so cleanup fires exactly once either way. The earlier version
# called cleanup() from the INT/TERM handlers too and then returned instead of
# exiting: a Ctrl-C during the health-polling loop below would resume that
# loop and launch Playwright right after cleanup had just stopped the shard
# backends it depends on; a Ctrl-C during `wait` would only interrupt that one
# `wait` call and leave every other shard's job running.
pgids=()
cleanup() {
  echo
  echo "=== Cleanup ==="
  # Negative PID = "the whole process group", not just that one PID — see the
  # `set -m` comment above for what this does and doesn't reach. Best-effort:
  # a group that already exited errors harmlessly.
  for pgid in "${pgids[@]:-}"; do
    [ -n "$pgid" ] && kill -TERM -"$pgid" 2>/dev/null || true
  done
  sleep 1
  for pgid in "${pgids[@]:-}"; do
    [ -n "$pgid" ] && kill -KILL -"$pgid" 2>/dev/null || true
  done
  tests/e2e-shard-cleanup.sh
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

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
    # ecosystem.config.cjs is gitignored/local-only (it holds real dev
    # secrets), so its shard app definitions aren't something this repo can
    # ship — but a developer missing them from their own copy deserves a
    # clear error now, not a silent no-op followed by a 120s health-check
    # timeout with no explanation. Fail immediately with PM2's own message,
    # pointing at the generator (E2E_EXTRA_SHARDS) their copy needs it from.
    #
    # Checked independently of `pm2 start`'s own exit code: PM2's CLI is not
    # guaranteed to return nonzero for "no such app in this config" (some
    # subcommands print a warning and exit 0) — `pm2 describe` on the name
    # itself is the one check that's actually conditioned on the app existing.
    pm2_output=$(pm2 start ecosystem.config.cjs --only "$app" 2>&1) || true
    if ! pm2 describe "$app" > /dev/null 2>&1; then
      echo "ERROR: pm2 app '$app' does not exist after 'pm2 start':" >&2
      echo "$pm2_output" >&2
      echo "Your local (gitignored) ecosystem.config.cjs likely predates the" \
        "E2E_EXTRA_SHARDS shard-backend generator — see its comments for the" \
        "app shape '$app' needs, or set E2E_SHARDS=1 to run a single shard" \
        "against only the always-on dev backend." >&2
      exit 1
    fi
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
    METEOR_WS="ws://localhost:$port/websocket" \
    E2E_PORT="$e2e_port" \
    PLAYWRIGHT_HTML_REPORT="../playwright-report-shard$shard_num" \
    npx playwright test -c tests/playwright.config.ts --output="test-results/shard$shard_num" --shard="$shard_num/$n" "$@" \
      > "playwright-report-shard$shard_num.log" 2>&1
  ) &
  pid="$!"
  pids+=("$pid")
  # With `set -m` above, a backgrounded job's PGID equals its own PID — this
  # is what cleanup() targets with `kill -TERM -$pgid` to reach the whole
  # tree, not just this one subshell.
  pgids+=("$pid")
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
