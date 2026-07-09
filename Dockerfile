# TimeHuddle PR Preview Container
# Runs both frontend (Vite) and backend (Fastify) with MongoDB support

# Build stage - includes devDependencies for building
FROM node:22-slim AS builder

WORKDIR /app

# Copy package files (including workspace packages)
COPY package*.json ./
COPY packages ./packages
COPY meteor-backend/package*.json ./meteor-backend/

# Install ALL dependencies (including dev) for building
RUN npm ci --ignore-scripts
RUN cd meteor-backend && npm ci --ignore-scripts

# Copy source code
COPY . .

# Build frontend
# Note: VITE_METEOR_URL needs to be configured at runtime based on the preview hostname
# For now, we'll inject it via a script in the entrypoint
RUN npm run build

# Production stage - runtime only
FROM node:22-slim

# Install required system packages including MongoDB and Meteor dependencies
RUN apt-get update && apt-get install -y \
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
    && apt-get install -y mongodb-org \
    && mkdir -p /data/db \
    && chown -R node:node /data/db \
    && rm -rf /var/lib/apt/lists/*

# Install Meteor
ENV METEOR_ALLOW_SUPERUSER=true
RUN curl -fsSL "https://install.meteor.com/?release=3.4.1" | sh

WORKDIR /app

# Copy package files and workspace packages
COPY package*.json ./
COPY packages ./packages
COPY meteor-backend/package*.json ./meteor-backend/

# Install production dependencies only
RUN npm ci --omit=dev --ignore-scripts
RUN cd meteor-backend && npm ci --omit=dev --ignore-scripts

# Copy built frontend from builder stage
COPY --from=builder /app/dist ./dist

# Copy backend source, vendor packages, and entrypoint script
COPY meteor-backend ./meteor-backend
COPY vendor ./vendor
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Expose ports (3000=frontend, 3100=meteor backend)
EXPOSE 3000 3100

# Health check on frontend
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:3000/ || exit 1

# Set labels for Proxmox Launchpad
LABEL org.mieweb.opensource-server.services.http.default-port=3000

# Entrypoint
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
