#!/bin/bash
set -e
set -x

echo "=================================================="
echo "TimeHuddle PR Preview - TEST MODE"
echo "=================================================="
echo "Container is alive!"
echo "Node version: $(node --version)"
echo "NPM version: $(npm --version)"
echo "Working directory: $(pwd)"
echo "Contents of /app:"
ls -la /app
echo "Contents of /app/dist:"
ls -la /app/dist 2>&1 || echo "No dist directory"
echo "=================================================="
echo "Sleeping forever to keep container alive..."
exec tail -f /dev/null
