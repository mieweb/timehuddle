#!/bin/bash
#
# Keeps the PM2 dev stack bound to this machine's current LAN IP.
#
# The Meteor backend bakes its address into ROOT_URL, and the Vite frontend
# bakes it into VITE_METEOR_URL, both at process start. Move between networks
# (dock -> WiFi -> hotspot) and those values go stale: the browser keeps dialing
# the old address and every DDP websocket dies with a connect timeout, even
# though PM2 still reports all three processes as "online".
#
# This script reconciles that. It asks ecosystem.config.cjs what IP it *would*
# use right now, compares against what the running Meteor process was actually
# started with, and restarts the stack only when the two disagree. Detection
# logic is deliberately NOT duplicated here — the config's detectLanIp() stays
# the single source of truth.
#
# Modes:
#   sync-lan-ip.sh             one-shot reconcile (for launchd / cron / by hand)
#   sync-lan-ip.sh --watch     poll forever (this is how PM2 runs it)
#   sync-lan-ip.sh --dry-run   report drift, change nothing
#
set -uo pipefail

MODE="${1:-once}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG="$ROOT/ecosystem.config.cjs"
LOG="$HOME/Library/Logs/timehuddle-lanip.log"
# How often --watch re-checks. Cheap: two node invocations, no restart unless
# the address actually moved.
POLL_SECONDS=30
# Meteor needs ~30s to rebuild after a restart. Refuse to restart again inside
# this window so a flapping interface can't put the stack in a rebuild loop.
COOLDOWN_SECONDS=45
STAMP="${TMPDIR:-/tmp}/timehuddle-lanip.stamp"

mkdir -p "$(dirname "$LOG")"
log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >>"$LOG"; }

# Background jobs (launchd, cron, PM2) start with a bare PATH — no node, no
# meteor, no pm2. Prepend the toolchain explicitly rather than sourcing the
# login shell: the Node version must match .nvmrc, and `meteor` lives in
# /usr/local/bin while `pm2` is a Homebrew install.
NODE_BIN="$(ls -d "$HOME"/.nvm/versions/node/v"$(cat "$ROOT/.nvmrc" 2>/dev/null || echo 24)"*/bin 2>/dev/null | tail -1)"
for dir in "$NODE_BIN" /usr/local/bin /opt/homebrew/bin; do
  [ -n "$dir" ] && [ -d "$dir" ] && PATH="$dir:$PATH"
done
export PATH

for bin in node pm2; do
  command -v "$bin" >/dev/null 2>&1 || { log "FATAL: $bin not on PATH; giving up"; exit 1; }
done

[ -f "$CONFIG" ] || { log "no ecosystem.config.cjs at $CONFIG — nothing to do"; exit 0; }

# The address a fresh start would use right now.
desired_url() {
  (cd "$ROOT" && node -e "
    const cfg = require('./ecosystem.config.cjs');
    const app = cfg.apps.find((a) => a.name === 'timehuddle-meteor');
    process.stdout.write(app?.env?.ROOT_URL ?? '');
  " 2>/dev/null)
}

# The address the running Meteor is actually serving on.
running_url() {
  pm2 jlist 2>/dev/null | node -e "
    let raw = '';
    process.stdin.on('data', (c) => (raw += c)).on('end', () => {
      let apps = [];
      try { apps = JSON.parse(raw); } catch {}
      const app = apps.find((a) => a.name === 'timehuddle-meteor');
      process.stdout.write(app?.pm2_env?.ROOT_URL ?? '');
    });
  " 2>/dev/null
}

reconcile() {
  local dry="${1:-0}"
  local desired current now last
  desired="$(desired_url)"
  current="$(running_url)"

  if [ -z "$desired" ]; then
    log "could not resolve desired ROOT_URL from config — skipping"
    return 0
  fi

  # 'localhost' is detectLanIp()'s offline fallback. Rebinding the stack to it
  # would break the phone worse than a stale-but-routable address, so sit tight
  # until a real interface comes back.
  case "$desired" in
    *//localhost:*|*//127.0.0.1:*)
      log "no routable LAN IP right now (desired=$desired) — leaving stack alone"
      return 0
      ;;
  esac

  if [ -z "$current" ]; then
    [ "$dry" = 1 ] && echo "stack not running under PM2 — would not auto-start"
    return 0
  fi

  if [ "$desired" = "$current" ]; then
    [ "$dry" = 1 ] && echo "in sync: $current — would do nothing"
    return 0
  fi

  if [ "$dry" = 1 ]; then
    echo "DRIFT: running=$current desired=$desired — would restart meteor + frontend"
    return 0
  fi

  now="$(date +%s)"
  last="$(cat "$STAMP" 2>/dev/null || echo 0)"
  if [ $((now - last)) -lt "$COOLDOWN_SECONDS" ]; then
    log "IP changed ($current -> $desired) but restarted $((now - last))s ago — deferring"
    return 0
  fi
  echo "$now" >"$STAMP"

  # --only: the test instance is localhost-bound so an IP change is irrelevant
  # to it, and scoping the restart means this script can safely run as a
  # PM2-managed process itself without tearing down the shell issuing it.
  log "LAN IP changed: $current -> $desired — restarting PM2 stack"
  if (cd "$ROOT" && pm2 restart ecosystem.config.cjs --update-env \
        --only timehuddle-meteor,timehuddle-frontend >>"$LOG" 2>&1); then
    log "restart issued; Meteor will rebuild (~30s) and come up on $desired"
  else
    log "ERROR: pm2 restart failed — see output above"
    return 1
  fi
}

case "$MODE" in
  --watch)
    log "watcher started (poll ${POLL_SECONDS}s)"
    while true; do
      reconcile 0
      sleep "$POLL_SECONDS"
    done
    ;;
  --dry-run) reconcile 1 ;;
  *)         reconcile 0 ;;
esac
