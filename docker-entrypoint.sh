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
until mongosh --eval "db.adminCommand('ping')" > /dev/null 2>&1; do
  echo "  MongoDB not ready yet, waiting..."
  sleep 2
done
echo "✓ MongoDB is ready"

# Start backend in background
echo "Starting backend..."
cd /app/meteor-backend
npm start &
BACKEND_PID=$!

# Wait for backend to be ready
echo "Waiting for backend to start..."
for i in {1..30}; do
    if curl -sf http://localhost:4000/health > /dev/null 2>&1; then
        echo "✓ Backend is ready"
        break
    fi
    if [ $i -eq 30 ]; then
        echo "✗ Backend failed to start"
        exit 1
    fi
    sleep 2
done

# Start frontend in foreground (keeps container alive)
echo "Starting frontend..."
cd /app
exec npm run preview -- --host 0.0.0.0 --port 3000
