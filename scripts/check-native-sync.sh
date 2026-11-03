#!/usr/bin/env bash
# check-native-sync.sh — Fail if the native projects don't match the Capacitor
# plugins in package.json, i.e. someone added or removed a plugin without
# re-syncing Android and iOS (#823).
#
# Usage:
#   npm run build                    # cap sync copies dist/, so build first
#   ./scripts/check-native-sync.sh
#
# It regenerates the native plugin files the way a developer would
# (`npx cap sync` + the iOS SPM patch) and fails if any committed file changed.
# `npx cap update` would skip the web copy, but on a fresh checkout it fails
# writing android/app/src/main/assets/capacitor.plugins.json, which only
# exists after a copy.

set -euo pipefail

cd "$(dirname "$0")/.."

GENERATED_FILES=(
  android/capacitor.settings.gradle
  android/app/capacitor.build.gradle
  ios/App/CapApp-SPM/Package.swift
)
FIX_COMMAND='npx cap sync && python3 scripts/patch-ios-spm.py'

if [[ ! -f dist/index.html ]]; then
  echo "Error: dist/index.html not found. Run 'npm run build' first — npx cap sync copies it." >&2
  exit 1
fi

npx cap sync
python3 scripts/patch-ios-spm.py

if git diff --quiet -- "${GENERATED_FILES[@]}"; then
  echo "Native projects match the Capacitor plugins in package.json."
  exit 0
fi

echo "" >&2
echo "Error: the native projects are out of sync with the Capacitor plugins in package.json." >&2
echo "These generated files changed after a sync:" >&2
git diff --name-only -- "${GENERATED_FILES[@]}" | sed 's/^/  /' >&2
echo "" >&2
git diff -- "${GENERATED_FILES[@]}" >&2
echo "" >&2
echo "Fix: run '$FIX_COMMAND' and commit the changes." >&2
exit 1
