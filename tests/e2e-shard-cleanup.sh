#!/usr/bin/env bash
# Stops every e2e shard process this test infra can start, regardless of how
# the last run ended. e2e-shard-runner.sh's own trap handles graceful exits
# (success, failure, Ctrl-C), but a run that gets force-killed (SIGKILL — e.g.
# the harness killing a hung background job) skips traps entirely and can
# leave a Vite dev server pegging a CPU core indefinitely, or a shard's
# Meteor backend sitting "online" with nothing using it. Run this any time
# you're not sure what's still running, or before/after a sharded run as a
# belt-and-suspenders step.
#
# Never touches timehuddle-meteor-test (shard 1) — that's the pre-existing
# always-on dev instance, not something this test infra owns the lifecycle of.
#
# Usage: tests/e2e-shard-cleanup.sh
set -uo pipefail
cd "$(dirname "$0")/.."

# Covers up to this many shards regardless of how many are actually
# configured right now (E2E_SHARDS in e2e-shard-runner.sh / E2E_EXTRA_SHARDS
# in ecosystem.config.cjs) — a few extra no-op checks for ports/apps that
# don't exist are harmless, and it means this never needs editing when
# someone bumps the shard count.
MAX_SHARDS=8
E2E_PORTS=()
SHARD_APPS=()
for n in $(seq 1 "$MAX_SHARDS"); do
  E2E_PORTS+=($((3002 + n)))
  [ "$n" -gt 1 ] && SHARD_APPS+=("timehuddle-meteor-test${n}")
done

echo "=== Killing anything bound to e2e shard ports: ${E2E_PORTS[*]} ==="
for port in "${E2E_PORTS[@]}"; do
  pids=$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)
  if [ -n "$pids" ]; then
    echo "port $port -> killing pid(s): $pids"
    kill -9 $pids 2>/dev/null || true
  fi
done

echo "=== Stopping shard backend(s): ${SHARD_APPS[*]} ==="
for app in "${SHARD_APPS[@]}"; do
  if pm2 describe "$app" > /dev/null 2>&1; then
    pm2 stop "$app" > /dev/null 2>&1 || true
    echo "$app stopped"
  fi
done

echo "=== Terminating remaining e2e-related processes ==="
# This is the real backstop for the SIGKILL case: the runner's own PGID
# tracking (e2e-shard-runner.sh) only exists in that process's memory, so a
# SIGKILL'd runner leaves no record for THIS script to read — matching by
# command line is the only way left to find a stranded worker or browser.
#
# Deliberately does NOT match "e2e-shard-runner.sh" itself: this script is
# normally invoked FROM that runner's own cleanup() trap while it's still
# alive and waiting on this very call — matching its command line here would
# kill the live, still-cleaning-up caller out from under itself (confirmed:
# this is exactly what the first version of this line did, killing the
# runner mid-cleanup and taking the whole run down with SIGKILL). A runner
# that's actually gone (the SIGKILL case this script exists for) was never
# going to show up in this search anyway — it's already dead.
remaining_pids=$(ps aux | grep -E "playwright test -c tests/playwright|vite --port 300[0-9]|chrome-headless-shell" | grep -v grep | awk '{print $2}')
if [ -n "$remaining_pids" ]; then
  echo "killing: $remaining_pids"
  kill -9 $remaining_pids 2>/dev/null || true
else
  echo "(none)"
fi
