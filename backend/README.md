# TimeHuddle Backend

Backend monorepo for [TimeHuddle](../README.md) — a Fastify API server with a shared time calculation engine.

## Tech Stack

| Layer     | Technology                                   |
| --------- | -------------------------------------------- |
| Framework | Fastify v5                                   |
| Database  | MongoDB (native driver + Mongoose pilot)     |
| Auth      | Better Auth with MongoDB adapter             |
| Real-time | Server-Sent Events (SSE) for live streams    |
| API docs  | @fastify/swagger (auto-generated at `/docs`) |

## Getting Started

```bash
npm install
```

Create a `.env` file:

```env
PORT=4000
NODE_ENV=development
MONGODB_URI=mongodb://localhost:27017/timeharbor
BETTER_AUTH_SECRET=your-secret
BETTER_AUTH_URL=http://localhost:4000
TRUSTED_ORIGINS=http://localhost:3000
APP_URL=http://localhost:3000
DEFAULT_ORG_KEY=default
DEFAULT_ORG_NAME=Default Organization

# GitHub OAuth — required for "Continue with GitHub" sign-in.
# Create an OAuth App at https://github.com/settings/developers
# Set the Authorization callback URL to: {BETTER_AUTH_URL}/api/auth/callback/github
# e.g. http://localhost:8080/api/auth/callback/github (when using the dev proxy)
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=

# Google OAuth — callback URL: {BETTER_AUTH_URL}/api/auth/callback/google
# Create credentials at https://console.cloud.google.com/apis/credentials
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# Apple Sign-In — callback URL: {BETTER_AUTH_URL}/api/auth/callback/apple
# clientId = Services ID; clientSecret = the generated client-secret JWT.
# APPLE_APP_BUNDLE_IDENTIFIER is only needed for native (Capacitor) sign-in.
APPLE_CLIENT_ID=
APPLE_CLIENT_SECRET=
APPLE_APP_BUNDLE_IDENTIFIER=

# Authentik (or any OIDC IdP) via the genericOAuth plugin. Registered as
# providerId "authentik"; callback URL: {BETTER_AUTH_URL}/api/auth/oauth2/callback/authentik
# AUTHENTIK_DISCOVERY_URL points at the provider's .well-known/openid-configuration.
AUTHENTIK_CLIENT_ID=
AUTHENTIK_CLIENT_SECRET=
AUTHENTIK_DISCOVERY_URL=
```

A social provider only registers when its `*_CLIENT_ID` is set, and the matching
button only appears in the frontend when its id is listed in the frontend's
`VITE_SOCIAL_PROVIDERS` env var (comma-separated, e.g.
`github,google,apple,authentik`; defaults to `github`).

`DEFAULT_ORG_KEY` and `DEFAULT_ORG_NAME` are optional and let you change which organization is treated as the default admin scope without code changes.

```bash
npm run dev
```

API available at `http://localhost:4000`.

## Build

```bash
npm run build    # Compiles to dist/
node dist/server.js
```

## Migrations

Use migrate-mongo to manage database migrations stored in `backend/migrations/`:

```bash
npm run migrate          # Run pending migrations
npm run migrate:status   # Check applied vs pending
npm run migrate:down     # Undo last migration
```

Create a new migration with auto-generated timestamp:

```bash
npx migrate-mongo create -f migrate-mongo-config.cjs "add-users-index"
```

## Mongoose Pilot

- Phase-in approach: adopt Mongoose one collection at a time.
- Current pilot target: `clockevents` read paths.
- Core route -> controller -> service boundaries remain unchanged.
