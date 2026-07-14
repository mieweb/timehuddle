# TimeHuddle PR Preview Container
# Runs frontend (Vite static), Fastify backend, and Meteor backend with MongoDB.
#
# Builder stage:  installs Meteor, compiles the Meteor bundle, builds frontend.
# Production stage: Node + MongoDB only — no Meteor, no build tools, no source.

# ── Builder stage ─────────────────────────────────────────────────────────────
FROM node:22-slim AS builder

# Meteor requires curl + ca-certificates at install time
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    git \
    python3 \
    g++ \
    make \
    && rm -rf /var/lib/apt/lists/*

# Install Meteor (build-time only — NOT in the final image)
ENV METEOR_ALLOW_SUPERUSER=true
RUN curl -fsSL "https://install.meteor.com/?release=3.4.1" | sh

WORKDIR /app

# Copy package manifests first for layer caching
COPY package.json package-lock.json ./
COPY packages/youtube/package.json ./packages/youtube/
COPY packages/README.md ./packages/
COPY meteor-backend/package.json meteor-backend/package-lock.json ./meteor-backend/
COPY scripts ./scripts

# Install all dependencies (dev included — needed for Vite build + Meteor)
RUN npm install
RUN cd meteor-backend && npm install

# Copy full source
COPY . .

# Build Vite frontend (VITE_* vars are baked in at build time)
ARG VITE_TIMECORE_URL
ENV VITE_TIMECORE_URL=${VITE_TIMECORE_URL}
RUN npm run build

# Compile Meteor bundle — runs once here so the container starts in seconds
WORKDIR /app/meteor-backend
RUN HOME=/root \
    METEOR_ALLOW_SUPERUSER=true \
    METEOR_PACKAGE_DIRS=/app/vendor/meteor-wormhole/packages \
    meteor build --server-only --directory /app/meteor-bundle && \
    cd /app/meteor-bundle/bundle/programs/server && \
    npm install --production

# ── Production stage ──────────────────────────────────────────────────────────
# Only Node.js + MongoDB + pre-built artifacts. No Meteor, no build tools.
FROM node:22-slim

# MongoDB + minimal runtime deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    gnupg \
    ca-certificates \
    procps \
    && curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc \
       | gpg --dearmor -o /usr/share/keyrings/mongodb-server-7.0.gpg \
    && echo "deb [ signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] http://repo.mongodb.org/apt/debian bookworm/mongodb-org/7.0 main" \
       | tee /etc/apt/sources.list.d/mongodb-org-7.0.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends mongodb-org \
    && mkdir -p /data/db \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Root production deps (serve, etc.)
COPY package.json package-lock.json ./
COPY scripts ./scripts
RUN npm install --production

# Copy pre-built artifacts from builder — no source, no Meteor, no vendor
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/meteor-bundle ./meteor-bundle

# Entrypoint script
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# systemd service for auto-start in Proxmox LXC
RUN apt-get update && apt-get install -y --no-install-recommends systemd \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /etc/systemd/system/multi-user.target.wants \
    && printf '[Unit]\nDescription=TimeHuddle PR Preview\nAfter=network.target\n\n[Service]\nType=simple\nExecStart=/usr/local/bin/docker-entrypoint.sh\nRestart=always\nRestartSec=10\nStandardOutput=journal\nStandardError=journal\n\n[Install]\nWantedBy=multi-user.target\n' \
         > /etc/systemd/system/timehuddle.service \
    && chmod 644 /etc/systemd/system/timehuddle.service \
    && ln -sf /etc/systemd/system/timehuddle.service \
              /etc/systemd/system/multi-user.target.wants/timehuddle.service

# rc.local fallback for minimal LXC setups without full systemd
RUN printf '#!/bin/sh -e\n/usr/local/bin/docker-entrypoint.sh >> /var/log/timehuddle.log 2>&1 &\nexit 0\n' \
      > /etc/rc.local && chmod +x /etc/rc.local

EXPOSE 3000 3100

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:3000/ || exit 1

LABEL org.mieweb.opensource-server.services.http.default-port=3000

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
