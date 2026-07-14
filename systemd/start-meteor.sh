#!/bin/bash
# Wrapper script for the Meteor backend — sets defaults for env vars that
# Launchpad injects into /etc/environment, falls back to localhost values
# for local testing.
#
# Systemd reads /etc/environment via EnvironmentFile; this script provides
# defaults for any vars Launchpad didn't inject.

export MONGO_URL="${MONGO_URL:-mongodb://localhost:27017/timehuddle?replicaSet=rs0}"
export MONGO_OPLOG_URL="${MONGO_OPLOG_URL:-mongodb://localhost:27017/local?replicaSet=rs0}"
export ROOT_URL="${ROOT_URL:-http://localhost:3100}"
export APP_URL="${APP_URL:-http://localhost:3000}"
export CORS_ORIGINS="${CORS_ORIGINS:-http://localhost:3000}"
export METEOR_AGENDA_ENABLED="${METEOR_AGENDA_ENABLED:-true}"
export PORT=3100

echo "[meteor] Starting Meteor backend on port $PORT"
echo "[meteor] MONGO_URL=${MONGO_URL}"
echo "[meteor] ROOT_URL=${ROOT_URL}"
echo "[meteor] CORS_ORIGINS=${CORS_ORIGINS}"

exec node /app/meteor-bundle/bundle/main.js
