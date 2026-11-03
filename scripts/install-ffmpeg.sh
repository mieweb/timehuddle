#!/usr/bin/env bash
# install-ffmpeg.sh — Install the pinned FFmpeg build PulseVault conforms uploads with.
#
# Usage (as root):
#   bash scripts/install-ffmpeg.sh
#
# A static BtbN build (https://github.com/BtbN/FFmpeg-Builds), pinned to a month-end autobuild
# (those releases are kept; the daily ones are pruned) and checked against its sha256. It goes to
# /opt/ffmpeg/<build>, with ffmpeg and ffprobe linked into /usr/local/bin, ahead of a distro
# package in /usr/bin on PATH. Does nothing when both links already run that build, so every
# deploy can run it; a build that won't run here leaves the current one in place. Bump all three
# pins together.
#
# Requirements: curl, xz-utils, amd64 or arm64.
set -euo pipefail

RELEASE="autobuild-2026-10-31-12-59"
VERSION="n9.0.2-39-g7adfbe40dc"

case "$(uname -m)" in
  x86_64)
    BUILD="ffmpeg-${VERSION}-linux64-gpl-9.0"
    SHA256="73e29a56974ae5a651133a04584c7483b21afe941e17dc91d79814a758b608d3"
    ;;
  aarch64 | arm64)
    BUILD="ffmpeg-${VERSION}-linuxarm64-gpl-9.0"
    SHA256="6cad88ae5bcec356cfc5d7979a036cc4007128201928a0cf243df3db483276cc"
    ;;
  *)
    echo "install-ffmpeg: unsupported architecture $(uname -m)" >&2
    exit 1
    ;;
esac

DEST="/opt/ffmpeg/${BUILD}"

# Both links point at this build and both binaries run (PulseVault needs ffprobe too).
installed() {
  [ "$(readlink /usr/local/bin/ffmpeg 2>/dev/null || true)" = "${DEST}/bin/ffmpeg" ] &&
    [ "$(readlink /usr/local/bin/ffprobe 2>/dev/null || true)" = "${DEST}/bin/ffprobe" ] &&
    "${DEST}/bin/ffmpeg" -version >/dev/null 2>&1 &&
    "${DEST}/bin/ffprobe" -version >/dev/null 2>&1
}

if installed; then
  echo "install-ffmpeg: ${BUILD} already installed"
  exit 0
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
curl -fsSL -o "$TMP/ffmpeg.tar.xz" \
  "https://github.com/BtbN/FFmpeg-Builds/releases/download/${RELEASE}/${BUILD}.tar.xz"
echo "${SHA256}  $TMP/ffmpeg.tar.xz" | sha256sum -c - >/dev/null
tar -xJf "$TMP/ffmpeg.tar.xz" -C "$TMP"

# Both must run on this host before anything already installed is touched: a failure here exits
# non-zero with the current ffmpeg and ffprobe still in place.
"$TMP/${BUILD}/bin/ffmpeg" -version >/dev/null
"$TMP/${BUILD}/bin/ffprobe" -version >/dev/null

mkdir -p /opt/ffmpeg
rm -rf "$DEST"
mv "$TMP/${BUILD}" "$DEST"
ln -sfn "${DEST}/bin/ffmpeg" /usr/local/bin/ffmpeg
ln -sfn "${DEST}/bin/ffprobe" /usr/local/bin/ffprobe
if ! installed; then
  echo "install-ffmpeg: ffmpeg/ffprobe in /usr/local/bin don't run ${BUILD}" >&2
  exit 1
fi
version="$(/usr/local/bin/ffmpeg -version)"
echo "install-ffmpeg: installed ${version%%$'\n'*}"
