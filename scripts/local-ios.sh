#!/usr/bin/env bash
# local-ios.sh — Build a production bundle pointed at the local Meteor backend,
# sync it into the iOS native shell, and open Xcode.
#
# Unlike dev:ios, there is no live-reload server — the native WebView serves the
# bundled assets directly, so the app works offline and survives backgrounding.
# Unlike testflight/prod:ios, VITE_TIMECORE_URL is set to the machine's LAN IP
# so the backend calls hit the locally-running Meteor instance.
#
# Usage:
#   npm run local:ios                      # auto-detect LAN IP
#   BACKEND_PORT=3100 npm run local:ios    # override port (default: 3100)

set -euo pipefail

BACKEND_PORT="${BACKEND_PORT:-3100}"
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# Activate the pinned Node before any npx below — Xcode and Finder launch this
# with a bare environment that has never run `nvm use`. Read .nvmrc from the
# repo root, not the caller's cwd.
cd "$ROOT_DIR"
# shellcheck source=scripts/use-node.sh
source "$(dirname "$0")/use-node.sh"

# ── 1. Detect LAN IP ──────────────────────────────────────────────────────────
IP=""
# Try common macOS interfaces (en0=Wi-Fi, en1/en2=Thunderbolt/USB, utun=VPN)
for iface in en0 en1 en2 en3 en4 bridge0; do
  CANDIDATE=$(ipconfig getifaddr "$iface" 2>/dev/null || true)
  if [[ -n "$CANDIDATE" ]]; then
    IP="$CANDIDATE"
    break
  fi
done

# Fallback: pick the first non-loopback IPv4 from ifconfig
if [[ -z "$IP" ]]; then
  IP=$(ifconfig | awk '/inet / && !/127\.0\.0\.1/ {print $2; exit}' 2>/dev/null || true)
fi

if [[ -z "$IP" ]]; then
  echo "ERROR: Could not detect a LAN IP address." >&2
  echo "       Make sure you are connected to Wi-Fi and try again." >&2
  exit 1
fi

BACKEND_URL="http://$IP:$BACKEND_PORT"

echo "🌐  Local IP      : $IP"
echo "🔧  Backend URL   : $BACKEND_URL"
echo ""

# ── 2. Production build pointing at local backend ─────────────────────────────
echo "📦  Building production bundle (VITE_TIMECORE_URL=$BACKEND_URL)..."
CAPACITOR=1 VITE_TIMECORE_URL="$BACKEND_URL" VITE_LOCAL_BUILD=true npx vite build
echo "✅  Build complete."
echo ""

# ── 3. Sync Capacitor (OTA_CHANNEL=local disables the updater so the device
#    runs the freshly-built native bundle instead of a cached OTA bundle) ──
echo "🔄  Syncing Capacitor (OTA disabled)..."
OTA_CHANNEL=local npx cap sync ios
python3 scripts/patch-ios-spm.py
echo ""

# ── 4. Open Xcode ─────────────────────────────────────────────────────────────
echo "🚀  Opening Xcode — build & run on your device from there."
npx cap open ios

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Bundle  → dist/  (production, offline-capable)"
echo "  Meteor  → $BACKEND_URL"
echo ""
echo "  Make sure the Meteor backend is running locally:"
echo "  cd meteor-backend && pm2 start ecosystem.config.cjs --only timehuddle-meteor"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
