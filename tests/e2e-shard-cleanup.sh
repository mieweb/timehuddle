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
LOCK_DIR=".e2e-shard-run.lock"
RUN_ID="${E2E_SHARD_RUN_ID:-$(cat "$RUN_STATE_FILE" 2>/dev/null || true)}"

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

# This script's ancestors — when the runner calls this from its EXIT trap,
# the runner is one of them.
ancestors=" "
p=$PPID
while [ -n "$p" ] && [ "$p" -gt 1 ]; do
  ancestors+="$p "
  p=$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ')
done

# PIDs carrying this run's ID, minus this script, its descendants, and its
# ancestors. Filtered by ancestry, not by process group, so it's correct
# whether or not the caller has job control.
owned_pids() {
  local pid
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

# Run standalone while a run is still live, the runner itself must be stopped
# first: it exports E2E_SHARD_RUN_ID after it starts, and ps only shows a
# process's starting environment, so the ID sweep below never finds it. Left
# alive, it could launch fresh shards after this script removed the state
# file. SIGTERM makes the runner run its own EXIT-trap cleanup; waiting for it
# to exit before going further keeps the two cleanup paths from racing. The
# PID comes from the run ID (e2e-<time>-<runner pid>) and is only trusted if
# it is still an e2e-shard-runner.sh process. Skipped when the runner is the
# caller (it's an ancestor).
if [ -n "$RUN_ID" ]; then
  runner_pid="${RUN_ID##*-}"
  if case "$ancestors" in *" $runner_pid "*) false ;; *) true ;; esac &&
    ps -o command= -p "$runner_pid" 2>/dev/null | grep -q "e2e-shard-runner.sh"; then
    echo "=== Stopping sharded run still in progress (runner pid $runner_pid) ==="
    kill -TERM "$runner_pid" 2>/dev/null || true
    for _ in $(seq 1 60); do
      kill -0 "$runner_pid" 2>/dev/null || break
      sleep 1
    done
    if kill -0 "$runner_pid" 2>/dev/null; then
      echo "runner did not exit within 60s, SIGKILL"
      kill -KILL "$runner_pid" 2>/dev/null || true
    else
      echo "runner exited after running its own cleanup"
    fi
  fi
fi

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
# Discovered from pm2's own registry rather than looped over a fixed max, so
# a shard count raised past any previous ceiling — or a backend left behind
# by an interrupted run with a now-reverted E2E_SHARDS — is still found and
# stopped. `name` appears twice per app in `pm2 jlist` (top-level and under
# pm2_env), hence the `sort -u`.
stopped=""
shard_apps=$(pm2 jlist 2>/dev/null \
  | grep -o '"name":"timehuddle-meteor-test[0-9][0-9]*"' \
  | sed -E 's/"name":"(.*)"/\1/' | sort -u)
for app in $shard_apps; do
  pm2 stop "$app" > /dev/null 2>&1 || true
  stopped+="$app "
done
echo "${stopped:-(none registered)}"

# Only clear the state file when it's the run just cleaned up, so a stale
# value in the environment can't erase the record of a different run.
if [ -n "$RUN_ID" ] && [ "$(cat "$RUN_STATE_FILE" 2>/dev/null)" = "$RUN_ID" ]; then
  rm -f "$RUN_STATE_FILE"
fi
# The lock dir has no independent identity to check against — by this point
# any runner that held it has either exited on its own or just been
# terminated above, so it's always safe to drop.
rmdir "$LOCK_DIR" 2>/dev/null || true
