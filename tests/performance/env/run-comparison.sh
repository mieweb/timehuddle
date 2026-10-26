#!/usr/bin/env bash
# Runs the perf suite against the old and new sites of the comparison
# environment (see README.md), keeping the median run's video for each page,
# and writes a before/after table. The same locally and in CI.
#
#   PERF_PASSWORD=… tests/performance/env/run-comparison.sh [out-dir]
#
# Env (defaults in brackets):
#   PERF_PASSWORD   required — the perf account's password
#   PERF_EMAIL      [perf-bot@test.local]
#   NAME            [huddle-perf] — measures https://$NAME-old/-new.os.mieweb.org
#   PERF_RUNS       [5] — keep it odd so the median is a real run with a video
#   PERF_NETWORK    [fast4g]
#   SETTLE_SECONDS  [0] — extra wait after the sites answer (CI uses it after a
#                   fresh deploy, while the fixture is still being seeded)
#
# Writes to out-dir [perf-comparison]: results/{old,new}/*.json,
# videos/<side>-<page>-<returning|signin>-<ms>ms.webm, {old,new}.log, comparison.md.
set -euo pipefail

: "${PERF_PASSWORD:?PERF_PASSWORD is required}"
NAME="${NAME:-huddle-perf}"
OUT_ARG="${1:-perf-comparison}"
mkdir -p "$OUT_ARG"
OUT="$(cd "$OUT_ARG" && pwd)"
cd "$(git rev-parse --show-toplevel)"

wait_for() {
  for _ in $(seq 1 60); do
    if curl -sf --max-time 5 "$1" > /dev/null; then return 0; fi
    sleep 5
  done
  echo "$1 is not answering" >&2
  exit 1
}
for side in api old new; do wait_for "https://$NAME-$side.os.mieweb.org/"; done
sleep "${SETTLE_SECONDS:-0}"

status=0
for side in old new; do
  echo "==> Measuring $side (https://$NAME-$side.os.mieweb.org)"
  PERF_BASE_URL="https://$NAME-$side.os.mieweb.org" \
    PERF_EMAIL="${PERF_EMAIL:-perf-bot@test.local}" \
    PERF_PASSWORD="$PERF_PASSWORD" \
    PERF_DASH_TEAM_ID=7e2f01000000000000000000 \
    PERF_NETWORK="${PERF_NETWORK:-fast4g}" \
    PERF_RUNS="${PERF_RUNS:-5}" \
    PERF_REPORT_ONLY=1 \
    PERF_RESULTS_DIR="$OUT/results/$side" \
    PERF_VIDEO_DIR="$OUT/videos" \
    PERF_VIDEO_LABEL="$side" \
    npx playwright test -c tests/performance/playwright.config.ts 2>&1 | tee "$OUT/$side.log" ||
    status=1
done
rm -rf "$OUT/videos/.runs"

node tests/performance/compare.mjs "$OUT/results/old" "$OUT/results/new" | tee "$OUT/comparison.md"
exit "$status"
