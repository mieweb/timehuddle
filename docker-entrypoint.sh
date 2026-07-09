#!/bin/bash
set -e
set -x

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

echo "Starting Vite preview server on port 3000..."
exec npm run preview -- --host 0.0.0.0 --port 3000
