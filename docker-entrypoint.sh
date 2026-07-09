#!/bin/bash
# Don't use set -e - we want to start the frontend even if backend setup fails
set -x  # Enable debug output

echo "=================================================="
echo "TimeHuddle PR Preview Environment"
echo "=================================================="
echo "Frontend: http://localhost:3000"
echo "Backend: http://localhost:3100 (Meteor)"
echo "MongoDB:  localhost:27017"
echo "=================================================="

# Start MongoDB as a replica set (required for Meteor's oplog tailing)
echo "Starting MongoDB..."
mongod --fork --logpath /var/log/mongodb.log --dbpath /data/db --bind_ip_all --replSet rs0

echo "Waiting for MongoDB and initializing replica set..."
sleep 5  # Give MongoDB time to start
mongosh --quiet --eval "try { rs.status(); print('Replica set already initialized'); } catch (e) { rs.initiate({ _id: 'rs0', members: [{ _id: 0, host: 'localhost:27017' }] }); print('Replica set initialized'); }" 2>&1 || echo "⚠ MongoDB initialization may have failed, continuing..."

# Start Meteor backend in background
echo "Starting Meteor backend..."
cd /app/meteor-backend
meteor run --allow-superuser --port 3100 &
BACKEND_PID=$!

# Don't wait for Meteor - it takes 2-3 minutes and will start in background
echo "Meteor backend starting in background (will be ready in 2-3 minutes)"

# Start frontend in foreground (keeps container alive)
echo "Starting frontend..."
cd /app
exec npm run preview -- --host 0.0.0.0 --port 3000
