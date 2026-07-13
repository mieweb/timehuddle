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
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    gnupg \
    ca-certificates \
    python3 \
    g++ \
    make \
    git \
    procps \
    && curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc | gpg --dearmor -o /usr/share/keyrings/mongodb-server-7.0.gpg \
    && echo "deb [ signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] http://repo.mongodb.org/apt/debian bookworm/mongodb-org/7.0 main" | tee /etc/apt/sources.list.d/mongodb-org-7.0.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends mongodb-org \
    && mkdir -p /data/db \
    && chown -R node:node /data/db \
    && rm -rf /var/lib/apt/lists/*

# Install Meteor
ENV METEOR_ALLOW_SUPERUSER=true
RUN curl -fsSL "https://install.meteor.com/?release=3.4.1" | sh

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

# Copy meteor-backend source and install its production dependencies
COPY meteor-backend ./meteor-backend
RUN cd meteor-backend && npm install --production

# Copy built frontend from builder stage
COPY --from=builder /app/dist ./dist

# Copy vendor packages and entrypoint script
COPY vendor ./vendor
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Install systemd for auto-start in Proxmox LXC containers
# (Docker ENTRYPOINT is not executed by LXC — systemd is needed)
RUN apt-get update && apt-get install -y --no-install-recommends systemd && rm -rf /var/lib/apt/lists/*

# Create systemd service so the app starts automatically on LXC boot
RUN mkdir -p /etc/systemd/system /etc/systemd/system/multi-user.target.wants
COPY --chmod=644 <<'EOF' /etc/systemd/system/timehuddle.service
[Unit]
Description=TimeHuddle PR Preview
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/docker-entrypoint.sh
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
RUN ln -sf /etc/systemd/system/timehuddle.service \
        /etc/systemd/system/multi-user.target.wants/timehuddle.service

# Expose ports (3000=frontend, 3100=meteor backend)
EXPOSE 3000 3100

# Health check on frontend
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:3000/ || exit 1

# Set labels for Proxmox Launchpad
LABEL org.mieweb.opensource-server.services.http.default-port=3000

# Entrypoint (used when run as a plain Docker container; LXC uses systemd instead)
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
