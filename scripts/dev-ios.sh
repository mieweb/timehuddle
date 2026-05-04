#!/usr/bin/env bash
# dev-ios.sh — Start iOS live-reload dev session.
#
# What it does:
#   1. Detects the machine's LAN IP
#   2. Ensures timehuddle-backend is running in PM2 (starts if absent)
#   3. (Re)registers timehuddle-frontend in PM2 pointed at THIS project
#      with VITE_TIMECORE_URL=http://<ip>:4000 and --host so the device
#      can reach it — any stale/wrong-project process is replaced cleanly
#   4. Syncs Capacitor so the native WebView loads from the live server
#   5. Opens Xcode — build & run on device from there
#
# After this script exits both PM2 processes keep running.
# Use:  pm2 logs timehuddle-frontend   — tail Vite output
#       pm2 stop all                   — stop everything

set -euo pipefail

VITE_PORT=3000
BACKEND_PORT=4000
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# ── 1. Detect LAN IP ──────────────────────────────────────────────────────────
IP=""
for iface in en0 en1 en2; do
  CANDIDATE=$(ipconfig getifaddr "$iface" 2>/dev/null || true)
  if [[ -n "$CANDIDATE" ]]; then
    IP="$CANDIDATE"
    break
  fi
done

if [[ -z "$IP" ]]; then
  echo "ERROR: Could not detect a LAN IP address." >&2
  echo "       Make sure you are connected to Wi-Fi and try again." >&2
  exit 1
fi

echo "🌐  Local IP      : $IP"
echo "⚡  Vite dev URL  : http://$IP:$VITE_PORT"
echo "🔧  Backend URL   : http://$IP:$BACKEND_PORT"
echo ""

# ── Helper ────────────────────────────────────────────────────────────────────
pm2_status() {
  # Prints the PM2 status of a named process, or "absent" if not found
  pm2 jlist 2>/dev/null \
    | node -e "
        const d = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf8'));
        const p = d.find(x => x.name === '$1');
        console.log(p ? p.pm2_env.status : 'absent');
      " 2>/dev/null || echo "absent"
}

# ── 2. Backend ────────────────────────────────────────────────────────────────
BACKEND_STATUS=$(pm2_status "timehuddle-backend")

if [[ "$BACKEND_STATUS" == "online" ]]; then
  echo "✅  timehuddle-backend is already online — restarting with LAN IP origins..."
  pm2 stop timehuddle-backend >/dev/null 2>&1 || true
fi

# Always delete and re-register backend with the dynamic LAN IP env vars.
# Passing env via a temp process config is the only reliable way to override
# dotenv's .env file without touching it.
pm2 delete timehuddle-backend >/dev/null 2>&1 || true

TEMP_EC=$(mktemp /tmp/timehuddle-backend-XXXXXX.json)
cat > "$TEMP_EC" << ECOSYSTEM
[{
  "name": "timehuddle-backend",
  "script": "npm",
  "args": "run dev",
  "cwd": "$ROOT_DIR/backend",
  "watch": false,
  "autorestart": true,
  "max_restarts": 5,
  "env": {
    "NODE_ENV": "development",
    "FORCE_COLOR": "1",
    "TRUSTED_ORIGINS": "http://localhost:3000,http://$IP:$VITE_PORT",
    "BETTER_AUTH_URL": "http://$IP:$VITE_PORT"
  }
}]
ECOSYSTEM

pm2 start "$TEMP_EC" >/dev/null 2>&1
rm "$TEMP_EC"
echo "✅  timehuddle-backend running (TRUSTED_ORIGINS includes http://$IP:$VITE_PORT)."
echo ""

# ── 3. Frontend ───────────────────────────────────────────────────────────────
# Always delete and re-register so:
#   - the cwd is guaranteed to be THIS project (not a stale entry)
#   - VITE_TIMECORE_URL reflects the current LAN IP (which may have changed)
echo "♻️   Registering timehuddle-frontend in PM2..."
pm2 delete timehuddle-frontend >/dev/null 2>&1 || true

TEMP_FE=$(mktemp /tmp/timehuddle-frontend-XXXXXX.json)
cat > "$TEMP_FE" << ECOSYSTEM
[{
  "name": "timehuddle-frontend",
  "script": "npm",
  "args": "run dev:mobile",
  "cwd": "$ROOT_DIR",
  "watch": false,
  "autorestart": true,
  "max_restarts": 5,
  "env": {
    "NODE_ENV": "development",
    "FORCE_COLOR": "1",
    "VITE_TIMECORE_URL": "http://$IP:$BACKEND_PORT"
  }
}]
ECOSYSTEM

pm2 start "$TEMP_FE" >/dev/null 2>&1
rm "$TEMP_FE"

echo "⏳  Waiting for Vite to be ready at http://$IP:$VITE_PORT ..."
RETRIES=30
until curl -sf "http://$IP:$VITE_PORT" >/dev/null 2>&1; do
  RETRIES=$((RETRIES - 1))
  if [[ $RETRIES -le 0 ]]; then
    echo "ERROR: Vite did not start within 30 seconds." >&2
    echo "       Check logs with: pm2 logs timehuddle-frontend" >&2
    exit 1
  fi
  sleep 1
done
echo "✅  Vite is ready."
echo ""

# ── 4. Sync Capacitor ─────────────────────────────────────────────────────────
echo "🔄  Syncing Capacitor (live-reload → http://$IP:$VITE_PORT)..."
CAPACITOR_SERVER_URL="http://$IP:$VITE_PORT" npx cap sync ios
echo ""

# ── 5. Open Xcode ─────────────────────────────────────────────────────────────
echo "🚀  Opening Xcode — build & run on your device from there."
npx cap open ios

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Vite  → http://$IP:$VITE_PORT   (pm2: timehuddle-frontend)"
echo "  API   → http://$IP:$BACKEND_PORT (pm2: timehuddle-backend)"
echo ""
echo "  pm2 logs timehuddle-frontend   tail Vite output"
echo "  pm2 stop all                   stop both processes"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
