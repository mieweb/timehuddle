#!/bin/bash
# Wait for MongoDB to accept connections, then initiate the rs0 replica set.
# Called by timehuddle-mongodb-init.service (Type=oneshot).
set -e

echo "[mongodb-init] Waiting for MongoDB..."
until mongosh --eval 'db.adminCommand("ping")' > /dev/null 2>&1; do
  sleep 1
done

echo "[mongodb-init] Initiating replica set rs0..."
# rs.initiate() returns AlreadyInitialized if already done — safe to ignore
mongosh --eval 'rs.initiate({_id:"rs0",members:[{_id:0,host:"127.0.0.1:27017"}]})' > /dev/null 2>&1 || true

echo "[mongodb-init] Waiting for PRIMARY election..."
until mongosh --eval 'rs.isMaster().ismaster' 2>/dev/null | grep -q true; do
  sleep 1
done

echo "[mongodb-init] Replica set PRIMARY ready."
