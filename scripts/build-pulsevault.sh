#!/usr/bin/env bash
# build-pulsevault.sh — Build the vendored @mieweb/pulsevault submodule.
#
# meteor-backend takes @mieweb/pulsevault as a file: dependency on
# vendor/pulsevault (a git submodule). Its dist/ isn't committed, so it has to
# be built before meteor-backend installs it — locally, in CI, in the Docker
# builder and on the deploy hosts alike.
#
# What it does:
#   1. Installs the package's dependencies (dev included — the build needs tsc)
#   2. Builds dist/
#   3. Prunes the dev dependencies, so the Meteor bundle (which copies the
#      package's node_modules) doesn't ship TypeScript and the test stack
#
# Needs the submodule checked out first:
#   git submodule update --init vendor/pulsevault

set -euo pipefail

PULSEVAULT_DIR="$(cd "$(dirname "$0")/../vendor/pulsevault" && pwd)"

if [ ! -f "$PULSEVAULT_DIR/package.json" ]; then
  echo "vendor/pulsevault is empty — run: git submodule update --init vendor/pulsevault" >&2
  exit 1
fi

cd "$PULSEVAULT_DIR"
npm ci --no-audit --no-fund
npm run build
npm prune --omit=dev --no-audit --no-fund
