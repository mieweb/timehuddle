#!/bin/bash
set -e
set -x

echo "=================================================="
echo "TimeHuddle PR Preview - FRONTEND ONLY"
echo "=================================================="
echo "Starting frontend on port 3000..."
echo "=================================================="

cd /app
exec npm run preview -- --host 0.0.0.0 --port 3000
