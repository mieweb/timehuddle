#!/bin/bash
set -e

echo "=================================================="
echo "TimeHuddle PR Preview Environment"
echo "=================================================="
echo "Frontend: http://localhost:3000"
echo "Backend:  http://localhost:4000"
echo "MongoDB:  ${MONGODB_URI}"
echo "=================================================="

# Start MongoDB as a replica set (required for Meteor's oplog tailing)
echo "Starting MongoDB..."
mongod --fork --logpath /var/log/mongodb.log --dbpath /data/db --bind_ip_all --replSet rs0

echo "Waiting for MongoDB to be ready and initializing replica set..."
for i in {1..30}; do
  # Try to initialize replica set (idempotent - will fail if already initialized)
  if mongosh --quiet --eval "try { rs.status().ok } catch (e) { rs.initiate({ _id: 'rs0', members: [{ _id: 0, host: 'localhost:27017' }] }).ok }" > /dev/null 2>&1 ||  mongo --quiet --eval "try { rs.status().ok } catch (e) { rs.initiate({ _id: 'rs0', members: [{ _id: 0, host: 'localhost:27017' }] }).ok }" > /dev/null 2>&1; then
    echo "✓ MongoDB replica set is ready"
    break
  fi
  if [ $i -eq 30 ]; then
    echo "⚠ MongoDB may not be ready, continuing anyway..."
    break
  fi
  sleep 2
done

# Start Meteor backend in background
echo "Starting Meteor backend..."
cd /app/meteor-backend
meteor run --allow-superuser --port 3100 &
BACKEND_PID=$!

# Wait for backend to be ready (Meteor takes ~2-3 min to start)
echo "Waiting for Meteor backend to start (this can take 2-3 minutes)..."
for i in {1..90}; do
    if curl -sf http://localhost:3100/ > /dev/null 2>&1; then
        echo "✓ Meteor backend is ready"
        break
    fi
    if [ $i -eq 90 ]; then
        echo "⚠ Meteor backend may not be ready, continuing anyway..."
        break
    fi
    sleep 3
done

# Start frontend in foreground (keeps container alive)
echo "Starting frontend..."
cd /app
exec npm run preview -- --host 0.0.0.0 --port 3000
