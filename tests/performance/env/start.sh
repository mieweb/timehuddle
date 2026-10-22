#!/bin/bash
# Starts the perf comparison container (see README.md): the base PR-preview
# entrypoint runs MongoDB, Meteor on 3100 and the old frontend on 3000; this
# adds the new frontend on 3001 and re-seeds the perf fixture.
set -e

set -a
# shellcheck source=/dev/null
. /app/perf/perf.env
set +a

# New frontend, restarted if it ever exits.
(
  cd /app
  while true; do
    npx serve -s /app/dist-new -l tcp:0.0.0.0:3001
    echo "[perf] new frontend exited, restarting..."
    sleep 2
  done
) &

# Re-seed once the backend answers, so the time-relative data always ends "now".
(
  until curl -sf --max-time 3 http://localhost:3100/ > /dev/null 2>&1; do sleep 2; done
  echo "[perf] seeding the perf fixture..."
  NODE_PATH=/app/meteor-bundle/bundle/programs/server/npm/node_modules \
    node /app/perf/seed-perf-fixture.mjs && echo "[perf] fixture seeded"
) &

exec /usr/local/bin/docker-entrypoint.sh
