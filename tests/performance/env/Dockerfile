# Before/after performance comparison image — see README.md.
#
# Layers the old frontend onto the PR-preview image (BASE_IMAGE, built from the
# repo-root Dockerfile at the new commit), so one container serves:
#   3000  old frontend (OLD_REF)          → huddle-perf-old
#   3001  new frontend (the base image's)  → huddle-perf-new
#   3100  one Meteor backend + MongoDB     → huddle-perf-api
# Both frontends call API_URL, and the perf fixture is re-seeded on every start.
ARG BASE_IMAGE

# ── Old frontend ──────────────────────────────────────────────────────────────
FROM node:22-slim AS old-frontend
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    git \
    python3 \
    g++ \
    make \
    && rm -rf /var/lib/apt/lists/*

ARG OLD_REF
ARG API_URL
WORKDIR /old
RUN git clone https://github.com/mieweb/timehuddle.git . && git checkout --detach "${OLD_REF}"
RUN npm install
RUN VITE_TIMECORE_URL="${API_URL}" VITE_DEV_QUICK_LOGIN=true npm run build

# ── Comparison image ──────────────────────────────────────────────────────────
FROM ${BASE_IMAGE}
SHELL ["/bin/bash", "-c"]

# The base entrypoint serves /app/dist on 3000, so the old build takes that
# spot and the new one moves aside for start.sh to serve on 3001.
RUN mv /app/dist /app/dist-new
COPY --from=old-frontend /old/dist /app/dist

COPY tests/performance/env/seed-perf-fixture.mjs tests/performance/env/start.sh /app/perf/
RUN chmod +x /app/perf/start.sh

# Written to a file rather than ENV: under Proxmox LXC the systemd unit starts
# the container, and it does not see image ENV.
ARG API_URL
ARG NEW_URL
ARG PERF_EMAIL=perf-bot@test.local
ARG PERF_PASSWORD
RUN test -n "${PERF_PASSWORD}" || (echo "PERF_PASSWORD build arg is required" && exit 1) \
    && { printf 'DEV_QUICK_LOGIN_ENABLED=true\n'; \
         printf 'ROOT_URL=%q\n' "${API_URL}"; \
         printf 'APP_URL=%q\n' "${NEW_URL}"; \
         printf 'PERF_EMAIL=%q\n' "${PERF_EMAIL}"; \
         printf 'PERF_PASSWORD=%q\n' "${PERF_PASSWORD}"; } > /app/perf/perf.env

# Point both start paths (Docker ENTRYPOINT and the LXC systemd/rc.local hooks
# the base image installs) at the wrapper.
RUN sed -i 's#/usr/local/bin/docker-entrypoint.sh#/app/perf/start.sh#' \
      /etc/systemd/system/timehuddle.service /etc/rc.local

EXPOSE 3000 3001 3100
LABEL org.mieweb.opensource-server.services.http.default-port=3000

ENTRYPOINT ["/app/perf/start.sh"]
