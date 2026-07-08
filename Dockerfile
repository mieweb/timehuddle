# TimeHuddle PR Preview Container
# Runs both frontend (Vite) and backend (Fastify) with MongoDB support

FROM node:22-slim

# Install required system packages
RUN apt-get update && apt-get install -y \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files first for better layer caching
COPY package*.json ./
COPY meteor-backend/package*.json ./meteor-backend/

# Install dependencies (skip scripts - no git hooks needed in container)
RUN npm ci --omit=dev --ignore-scripts
RUN cd meteor-backend && npm ci --omit=dev --ignore-scripts

# Copy application code
COPY . .

# Build frontend
RUN npm run build

# Expose ports
EXPOSE 3000 4000

# Health check on frontend
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:3000/ || exit 1

# Set labels for Proxmox Launchpad
LABEL org.mieweb.opensource-server.services.http.default-port=3000

# Copy entrypoint script
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENTRYPOINT ["docker-entrypoint.sh"]
