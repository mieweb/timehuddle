# TimeHuddle PR Preview Container
#
# Builder stage:  Meteor bundle compilation + Vite frontend build.
# Production stage: MIEWeb nodejs base image (systemd PID 1, Node.js 24, SSH,
#   LDAP) + MongoDB — per sr dev recommendation to use MIEWeb base images with
#   SystemD services instead of a custom Docker entrypoint.

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
# MIEWeb nodejs base: systemd as PID 1, Node.js 24, SSH server, LDAP auth.
# Env vars injected by Launchpad land in /etc/environment (read by systemd units).
# Do NOT set ENTRYPOINT or CMD — systemd is PID 1 and manages all services.
FROM ghcr.io/mieweb/opensource-server/nodejs:latest

# Install MongoDB 7.0 (not included in the nodejs base image)
RUN apt-get update && apt-get install -y --no-install-recommends \
    gnupg ca-certificates curl procps \
    && curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc \
       | gpg --dearmor -o /usr/share/keyrings/mongodb-server-7.0.gpg \
    && echo "deb [ signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] http://repo.mongodb.org/apt/debian bookworm/mongodb-org/7.0 main" \
       | tee /etc/apt/sources.list.d/mongodb-org-7.0.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends mongodb-org \
    && mkdir -p /data/db \
    && rm -rf /var/lib/apt/lists/*

# Install serve globally for the frontend static server
RUN npm install -g serve

# Copy pre-built artifacts from builder — no source, no Meteor tooling
COPY --from=builder /app/dist /app/dist
COPY --from=builder /app/meteor-bundle /app/meteor-bundle

# Install systemd service units + helper scripts
COPY systemd/timehuddle-mongodb.service      /etc/systemd/system/
COPY systemd/timehuddle-mongodb-init.service /etc/systemd/system/
COPY systemd/timehuddle-meteor.service       /etc/systemd/system/
COPY systemd/timehuddle-frontend.service     /etc/systemd/system/
COPY systemd/mongodb-init.sh                 /usr/local/bin/
COPY systemd/start-meteor.sh                 /usr/local/bin/
RUN chmod +x /usr/local/bin/mongodb-init.sh /usr/local/bin/start-meteor.sh \
    && systemctl enable \
         timehuddle-mongodb.service \
         timehuddle-mongodb-init.service \
         timehuddle-meteor.service \
         timehuddle-frontend.service

EXPOSE 3000 3100

LABEL org.mieweb.opensource-server.services.http.default-port=3000
