# Timecore — Copilot Instructions

Timecore is a **backend API only**. No UI, no frontend code, no server-rendered HTML.

## Stack

- **Fastify v5** — HTTP framework
- **better-auth** — authentication (email/password, sessions, password reset)
- **MongoDB** (via Docker on `27017`) — database
- **TypeScript** — strict mode
- **tsx** — dev runner (`npm run dev`)
- **Vitest** — tests (`npm test`)
- API runs on **port 4000** in development

## Commands

```bash
npm run dev       # start dev server (tsx watch)
npm test          # run all tests
npm run format    # prettier check
npm run format:fix
```

## Code Quality

### 🎯 DRY — No duplication. Extract shared logic into `src/lib/`.
### 💋 KISS — Simplest solution that works. No over-engineering.
### 🚫 No spaghetti — Every file has one clear responsibility.

## Project Structure

```
src/
  server.ts          # Fastify app bootstrap only
  lib/               # Shared utilities (auth, db, email)
  routes/            # Route registration (thin — no business logic)
  controllers/       # Request handlers (call services, return responses)
  services/          # Business logic (pure functions where possible)
  middleware/        # Fastify hooks (auth checks, etc.)
  models/            # MongoDB collection definitions
```

**Rule**: Routes register. Controllers handle requests. Services contain logic. Never put business logic in routes or controllers.

## API Conventions

- All routes prefixed: `/v1/` (app) or `/api/auth/` (better-auth)
- JSON in, JSON out
- Auth-protected routes use the `requireAuth` middleware hook
- HTTP status codes must be semantically correct (401 vs 403, 404 vs 400, etc.)
- Never expose internal error details to the client

## Security

- All mutation endpoints require authentication
- Validate and sanitize all user input at the controller boundary
- Never trust `req.body` without schema validation
- Follow OWASP Top 10
