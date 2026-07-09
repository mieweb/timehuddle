#!/bin/bash
set -e

echo "=================================================="
echo "TimeHuddle PR Preview Environment"
echo "=================================================="
echo "Frontend: http://localhost:3000"
echo "Backend:  http://localhost:4000"
echo "MongoDB:  ${MONGODB_URI}"
echo "=================================================="

# Start MongoDB
echo "Starting MongoDB..."
mongod --fork --logpath /var/log/mongodb.log --dbpath /data/db --bind_ip_all

echo "Waiting for MongoDB to be ready..."
for i in {1..30}; do
  if mongosh --eval "db.adminCommand('ping')" > /dev/null 2>&1 || mongo --eval "db.adminCommand('ping')" > /dev/null 2>&1; then
    echo "✓ MongoDB is ready"
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

# Wait for backend to be ready
echo "Waiting for Meteor backend to start..."
for i in {1..60}; do
    if curl -sf http://localhost:3100/ > /dev/null 2>&1; then
        echo "✓ Meteor backend is ready"
        break
    fi
    if [ $i -eq 60 ]; then
        echo "⚠ Meteor backend may not be ready, continuing anyway..."
        break
    fi
    sleep 3
done

# Start frontend in foreground (keeps container alive)
echo "Starting frontend..."
cd /app
exec npm run preview -- --host 0.0.0.0 --port 3000
