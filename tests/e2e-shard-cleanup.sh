#!/usr/bin/env bash
# Stops everything a sharded e2e run started, regardless of how that run
# ended. e2e-shard-runner.sh calls this from its own EXIT trap; run it by hand
# (`npm run test:sharded:cleanup`) after a run that was SIGKILLed, which
# skips that trap and can leave a Vite server pegging a CPU core or a shard's
# Meteor backend sitting "online" indefinitely.
#
# Only kills what the run owns:
#   - processes carrying the run's E2E_SHARD_RUN_ID (inherited by every
#     process the runner starts — Playwright, its detached Vite server and
#     browsers). Taken from the environment when the runner calls this, or
#     from the .e2e-shard-run state file it leaves behind otherwise.
#   - the shard pm2 apps timehuddle-meteor-test2..N, which exist only for this.
# Never matches by process name or port, so other projects' Vite, Chromium or
# Playwright processes — and timehuddle-meteor-test (shard 1, the always-on
# dev instance) — are never touched.
#
# Usage: tests/e2e-shard-cleanup.sh
set -uo pipefail
cd "$(dirname "$0")/.."

RUN_STATE_FILE=".e2e-shard-run"
RUN_ID="${E2E_SHARD_RUN_ID:-$(cat "$RUN_STATE_FILE" 2>/dev/null || true)}"

# Covers up to this many shards regardless of how many are configured now, so
# this never needs editing when someone bumps E2E_SHARDS / E2E_EXTRA_SHARDS.
MAX_SHARDS=8

# Walks a PID's parent chain; succeeds if this script ($$) is on it — i.e. the
# PID is this script or something it spawned (its own ps/grep pipeline
# inherits the run ID too).
descends_from_self() {
  local p="$1" hops=0
  while [ -n "$p" ] && [ "$p" -gt 1 ] && [ "$hops" -lt 64 ]; do
    [ "$p" = "$$" ] && return 0
    p=$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ')
    hops=$((hops + 1))
  done
  return 1
}

# PIDs carrying this run's ID, minus this script, its descendants, and its
# ancestors (the runner waiting on this very call). Filtered by ancestry, not
# by process group, so it's correct whether or not the caller has job control.
owned_pids() {
  local ancestors p pid
  ancestors=" "
  p=$PPID
  while [ -n "$p" ] && [ "$p" -gt 1 ]; do
    ancestors+="$p "
    p=$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ')
  done
  for pid in $(ps eww -ax -o pid=,command= 2>/dev/null \
    | grep -E "E2E_SHARD_RUN_ID=${RUN_ID}( |$)" | awk '{ print $1 }'); do
    case "$ancestors" in *" $pid "*) continue ;; esac
    # Re-checked per PID: drops the listing pipeline's own short-lived
    # processes (gone by now, so their ancestry can't be traced to $$) and
    # any PID the OS has reused for something else since the listing.
    ps eww -o command= -p "$pid" 2>/dev/null \
      | grep -qE "E2E_SHARD_RUN_ID=${RUN_ID}( |$)" || continue
    descends_from_self "$pid" && continue
    echo "$pid"
  done
}

if [ -n "$RUN_ID" ]; then
  echo "=== Terminating processes owned by run $RUN_ID ==="
  pids=$(owned_pids)
  if [ -n "$pids" ]; then
    echo "SIGTERM: $(echo $pids)"
    kill -TERM $pids 2>/dev/null || true
    sleep 2
    pids=$(owned_pids)
    if [ -n "$pids" ]; then
      echo "still running, SIGKILL: $(echo $pids)"
      kill -KILL $pids 2>/dev/null || true
    fi
  else
    echo "(none)"
  fi
else
  echo "=== No recorded sharded run — no processes to terminate ==="
fi

echo "=== Stopping shard backends ==="
stopped=""
for n in $(seq 2 "$MAX_SHARDS"); do
  app="timehuddle-meteor-test${n}"
  if pm2 describe "$app" > /dev/null 2>&1; then
    pm2 stop "$app" > /dev/null 2>&1 || true
    stopped+="$app "
  fi
done
echo "${stopped:-(none registered)}"

# Only clear the state file when it's the run just cleaned up, so a stale
# value in the environment can't erase the record of a different run.
if [ -n "$RUN_ID" ] && [ "$(cat "$RUN_STATE_FILE" 2>/dev/null)" = "$RUN_ID" ]; then
  rm -f "$RUN_STATE_FILE"
fi
