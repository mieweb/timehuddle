# TimeHuddle PR Preview Container
# Runs both frontend (Vite) and backend (Fastify) with MongoDB support

# Build stage - includes devDependencies for building
FROM node:22-slim AS builder

WORKDIR /app

# Copy root package files and workspace configuration
COPY package.json package-lock.json ./

# Copy workspace packages (packages/youtube etc.)
COPY packages/youtube/package.json ./packages/youtube/
COPY packages/README.md ./packages/

# Copy meteor-backend package files
COPY meteor-backend/package.json meteor-backend/package-lock.json ./meteor-backend/

# Copy scripts directory (needed for prepare hook)
COPY scripts ./scripts

# Install ALL dependencies (including dev) for building
RUN npm install
RUN cd meteor-backend && npm install

# Copy source code
COPY . .

# Build frontend against this preview's own backend hostname (Vite bakes
# VITE_* vars in at build time, so this must be passed as a build arg —
# a runtime env var on the container has no effect on the static bundle).
ARG VITE_TIMECORE_URL
ENV VITE_TIMECORE_URL=${VITE_TIMECORE_URL}
RUN npm run build

# Production stage - runtime only
FROM node:22-slim

# Install required system packages including MongoDB and Meteor dependencies
# Runtime deps only — curl + mongod. Meteor is NOT installed here because the
# bundle was already compiled in the builder stage; only `node main.js` runs.
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    gnupg \
    ca-certificates \
    procps \
    && curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc | gpg --dearmor -o /usr/share/keyrings/mongodb-server-7.0.gpg \
    && echo "deb [ signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] http://repo.mongodb.org/apt/debian bookworm/mongodb-org/7.0 main" | tee /etc/apt/sources.list.d/mongodb-org-7.0.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends mongodb-org \
    && mkdir -p /data/db \
    && chown -R node:node /data/db \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy root package files
COPY package.json package-lock.json ./

# Copy workspace packages structure
COPY packages/youtube/package.json ./packages/youtube/
COPY packages/README.md ./packages/

# Copy meteor-backend package files
COPY meteor-backend/package.json meteor-backend/package-lock.json ./meteor-backend/

# Copy scripts (needed for prepare hook)
COPY scripts ./scripts

# Install production dependencies only
RUN npm install --production

# Copy workspace packages source (needed for imports)
COPY packages/youtube ./packages/youtube

# Copy vendor packages first — needed by Meteor at build time (METEOR_PACKAGE_DIRS)
COPY vendor ./vendor

# Copy meteor-backend source and install its production dependencies
COPY meteor-backend ./meteor-backend
RUN cd meteor-backend && npm install --production

# Pre-build the Meteor bundle at image build time so the container starts in
# seconds (plain `node main.js`) without any runtime compilation or HOME env var.
WORKDIR /app/meteor-backend
RUN HOME=/root \
    METEOR_ALLOW_SUPERUSER=true \
    METEOR_PACKAGE_DIRS=/app/vendor/meteor-wormhole/packages \
    meteor build --server-only --directory /app/meteor-bundle && \
    cd /app/meteor-bundle/bundle/programs/server && \
    npm install --production
WORKDIR /app

# Copy built frontend from builder stage
COPY --from=builder /app/dist ./dist

# Copy entrypoint script
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Install systemd for auto-start in Proxmox LXC containers
# (Docker ENTRYPOINT is not executed by LXC — systemd is needed)
RUN apt-get update && apt-get install -y --no-install-recommends systemd && rm -rf /var/lib/apt/lists/*

# Create systemd service so the app starts automatically on LXC boot.
# Using RUN printf instead of heredoc COPY (no syntax=1.4 header required).
RUN mkdir -p /etc/systemd/system/multi-user.target.wants && \
    printf '[Unit]\nDescription=TimeHuddle PR Preview\nAfter=network.target\n\n[Service]\nType=simple\nExecStart=/usr/local/bin/docker-entrypoint.sh\nRestart=always\nRestartSec=10\nStandardOutput=journal\nStandardError=journal\n\n[Install]\nWantedBy=multi-user.target\n' \
      > /etc/systemd/system/timehuddle.service && \
    chmod 644 /etc/systemd/system/timehuddle.service && \
    ln -sf /etc/systemd/system/timehuddle.service \
           /etc/systemd/system/multi-user.target.wants/timehuddle.service

# rc.local fallback — runs on boot even in minimal LXC setups without full systemd
RUN printf '#!/bin/sh -e\n/usr/local/bin/docker-entrypoint.sh >> /var/log/timehuddle.log 2>&1 &\nexit 0\n' \
      > /etc/rc.local && \
    chmod +x /etc/rc.local

# Expose ports (3000=frontend, 3100=meteor backend)
EXPOSE 3000 3100

# Health check on frontend
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:3000/ || exit 1

# Set labels for Proxmox Launchpad
LABEL org.mieweb.opensource-server.services.http.default-port=3000

# Entrypoint (used when run as a plain Docker container; LXC uses systemd instead)
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
