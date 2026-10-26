#!/usr/bin/env bash
# Starts the perf comparison image and checks that all three services answer
# and the fixture was seeded. Used by CI after build.sh; runs locally too.
#
#   tests/performance/env/smoke-test.sh [image]   (default ghcr.io/mieweb/timehuddle:perf)
set -euo pipefail

IMAGE="${1:-ghcr.io/mieweb/timehuddle:perf}"
NAME="timehuddle-perf-smoke-$$"
trap 'docker rm -f "$NAME" > /dev/null 2>&1 || true' EXIT

docker run -d --name "$NAME" -p 13000:3000 -p 13001:3001 -p 13100:3100 "$IMAGE" > /dev/null

wait_for() {
  local label="$1" url="$2"
  for _ in $(seq 1 90); do
    if curl -sf --max-time 3 "$url" > /dev/null; then
      echo "ok   $label ($url)"
      return 0
    fi
    sleep 2
  done
  echo "FAIL $label did not answer at $url" >&2
  docker logs "$NAME" | tail -60 >&2
  exit 1
}

wait_for "backend (3100)" http://localhost:13100/
wait_for "old frontend (3000)" http://localhost:13000/
wait_for "new frontend (3001)" http://localhost:13001/

for _ in $(seq 1 60); do
  if docker logs "$NAME" 2>&1 | grep -q '\[perf\] fixture seeded'; then
    echo "ok   fixture seeded"
    docker logs "$NAME" 2>&1 | grep -A 12 '"dashTeamId"' | head -12
    # The two frontends must be different builds.
    old=$(curl -s http://localhost:13000/ | grep -o 'assets/index-[^"]*\.js' | head -1)
    new=$(curl -s http://localhost:13001/ | grep -o 'assets/index-[^"]*\.js' | head -1)
    if [ -z "$old" ] || [ "$old" = "$new" ]; then
      echo "FAIL old and new frontends serve the same entry chunk ($old)" >&2
      exit 1
    fi
    echo "ok   old ($old) and new ($new) are different builds"
    exit 0
  fi
  sleep 2
done
echo "FAIL fixture was not seeded" >&2
docker logs "$NAME" | tail -60 >&2
exit 1
