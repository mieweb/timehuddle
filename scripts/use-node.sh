#!/usr/bin/env bash
# use-node.sh — activate the Node version pinned in .nvmrc.
#
# Sourced (not executed) by the other scripts here, so the activated version
# applies to the calling shell. Running any node/npm/npx command on a different
# version drifts package-lock.json and breaks CI, and scripts launched from
# Xcode or a GUI never inherit a shell that has already run `nvm use`.
#
# Usage:  source "$(dirname "$0")/use-node.sh"

# nvm is a shell function, so it has to be sourced in non-interactive shells.
if [[ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]]; then
  # shellcheck disable=SC1090
  source "${NVM_DIR:-$HOME/.nvm}/nvm.sh"
fi

if command -v nvm &>/dev/null; then
  nvm use
elif [ -f .nvmrc ]; then
  echo "Warning: nvm not found. Ensure Node $(cat .nvmrc) is active." >&2
fi
