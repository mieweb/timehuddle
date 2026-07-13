#!/bin/bash
set -e

echo "=================================================="
echo "TimeHuddle PR Preview"
echo "=================================================="
echo "Node version: $(node --version)"
echo "NPM version: $(npm --version)"
echo "Working directory: $(pwd)"
echo "=================================================="

cd /app

# Check if dist exists
if [ ! -d "dist" ]; then
  echo "ERROR: dist directory not found!"
  ls -la
  exit 1
fi

# Function to cleanup on exit
cleanup() {
  echo "Shutting down services..."
  kill $(jobs -p) 2>/dev/null || true
  mongod --shutdown 2>/dev/null || true
  exit 0
}
trap cleanup SIGTERM SIGINT

# 1. Start MongoDB as a single-node replica set (required for Meteor oplog tailing)
echo "Starting MongoDB..."
mkdir -p /data/db
chown -R node:node /data/db || true
mongod --fork --logpath /var/log/mongodb.log --dbpath /data/db --bind_ip 127.0.0.1 --port 27017 --replSet rs0

# Wait for MongoDB to be ready
echo "Waiting for MongoDB..."
until mongosh --eval "db.adminCommand('ping')" > /dev/null 2>&1; do
  echo "  MongoDB not ready yet, waiting..."
  sleep 2
done

# Initiate replica set (idempotent — safe to run on every start)
echo "Initiating replica set..."
mongosh --eval "
  try {
    rs.status();
    print('Replica set already initiated');
  } catch(e) {
    rs.initiate({ _id: 'rs0', members: [{ _id: 0, host: '127.0.0.1:27017' }] });
    print('Replica set initiated');
  }
" > /dev/null 2>&1

# Wait for replica set PRIMARY to be elected
echo "Waiting for replica set PRIMARY..."
until mongosh --eval "rs.isMaster().ismaster" 2>/dev/null | grep -q true; do
  echo "  Waiting for PRIMARY..."
  sleep 1
done
echo "MongoDB is ready!"

# 2. Start Meteor backend on port 3100 using the pre-built bundle.
# Running `node main.js` instead of `meteor run` — no compilation, starts in seconds,
# and does not require HOME to be set (plain Node.js process).
echo "Starting Meteor backend on port 3100..."
cd /app/meteor-bundle/bundle
MONGO_URL="${MONGO_URL:-mongodb://localhost:27017/timehuddle?directConnection=true}" \
  MONGO_OPLOG_URL="${MONGO_OPLOG_URL:-mongodb://localhost:27017/local?directConnection=true}" \
  METEOR_AGENDA_ENABLED="${METEOR_AGENDA_ENABLED:-true}" \
  APP_URL="${APP_URL:-http://localhost:3000}" \
  ROOT_URL="${ROOT_URL:-http://localhost:3100}" \
  CORS_ORIGINS="${CORS_ORIGINS:-http://localhost:3000}" \
  PORT=3100 \
  node main.js &

METEOR_PID=$!
echo "Meteor backend started (PID: $METEOR_PID)"

# Wait for backend to be ready
echo "Waiting for backend on port 3100..."
for i in {1..60}; do
  if curl -sf --max-time 3 http://localhost:3100/ > /dev/null 2>&1; then
    echo "Backend is ready!"
    break
  fi
  echo "  Backend not ready yet (attempt $i/60)..."
  sleep 2
done

# 3. Start frontend static server on port 3000 (bind to 0.0.0.0 so Proxmox reverse proxy can reach it)
echo "Starting frontend on port 3000..."
cd /app
npx serve -s dist -l tcp:0.0.0.0:3000 &

FRONTEND_PID=$!
echo "Frontend started (PID: $FRONTEND_PID)"

# Wait for frontend to be ready
echo "Waiting for frontend on port 3000..."
for i in {1..30}; do
  if curl -sf --max-time 3 http://localhost:3000/ > /dev/null 2>&1; then
    echo "Frontend is ready!"
    break
  fi
  echo "  Frontend not ready yet (attempt $i/30)..."
  sleep 1
done

echo "=================================================="
echo "✅ All services started successfully!"
echo "   - MongoDB:  localhost:27017"
echo "   - Backend:  http://localhost:3100"
echo "   - Frontend: http://localhost:3000"
echo "=================================================="

# Keep script running and monitor processes
while true; do
  # Check if Meteor is still running
  if ! kill -0 $METEOR_PID 2>/dev/null; then
    echo "ERROR: Meteor backend died!"
    exit 1
  fi
  
  # Check if frontend is still running
  if ! kill -0 $FRONTEND_PID 2>/dev/null; then
    echo "ERROR: Frontend server died!"
    exit 1
  fi
  
  sleep 10
done
