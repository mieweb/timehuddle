# Adopt @mieweb/pulsevault for Video Uploads

## Overview

Replaces the hand-rolled TUS upload server (`@tus/server` + `@tus/file-store`) backing PulseVault with the real `@mieweb/pulsevault` package, registers its endpoints through `meteor-wormhole` instead of as a disconnected side-channel mount, and documents its raw HTTP surface in the same Swagger UI as the rest of the API.

## Current State

- Video uploads (ticket attachments and media-library items) are served by `@mieweb/pulsevault`'s TUS core (`createPulseVaultCore`), replacing the old hand-rolled `@tus/server` implementation.
- `pulsevault.reserve` / `pulsevault.reserveForLibrary` mint short-lived HMAC capability tokens per `artifactId`; `pulsevault.getVideo` / `pulsevault.listVideos` read back media-library entries. All four are exposed as Meteor methods and registered with `meteor-wormhole` (`Wormhole.expose`), giving them REST endpoints, OpenAPI schemas, and MCP tool bindings for free.
- The `/pulsevault` mount itself (TUS upload + artifact serving — `POST/PATCH /pulsevault/upload`, `GET/DELETE /pulsevault/artifacts/:id`, etc.) is registered as a `Wormhole.use()` plugin rather than a bare `WebApp.connectHandlers.use()` call, and its raw routes are documented in the same `/api/docs` Swagger UI as the JSON methods.

## Proposed Changes

### 1. Backend — swap in `@mieweb/pulsevault` (`meteor-backend/server/pulsevault.js`)

- Mounts `@mieweb/pulsevault`'s core (`createPulseVaultCore`, `createLocalStorage`, `createMp4Sniffer`) via a `Wormhole.use({ name: 'pulsevault', start(api) { api.mount('/pulsevault', ...) } })` plugin — see "Wormhole integration" below for why this replaced a direct `WebApp.connectHandlers.use()` call.
- `pulsevault.reserve` / `pulsevault.reserveForLibrary` Meteor methods mint a short-lived HMAC capability token (`issueCapabilityToken`) per `artifactId`, scoped to either a ticket or the media library, tracked in an in-memory `reservationContext` map.
- `pulsevault.getVideo({ artifactId })` / `pulsevault.listVideos({ limit? })` read back `mediaitems` entries for playback URLs and library listings.
- `authorize` hook verifies the capability token on upload; `validatePayload` runs the package's MP4 sniffer.
- `onUploadComplete` looks up the reservation and either inserts a `mediaitems` doc (library target) or calls the `createAttachment()` helper (ticket target).
- `main.js`: imports `./pulsevault`, and registers all four methods with `Wormhole.expose` (full input/output JSON schemas) so they're reachable over `meteor-wormhole`'s REST/OpenAPI/MCP surface, not just as internal Meteor method calls.
- `package.json`: removed `@tus/file-store` and `@tus/server`; added `@mieweb/pulsevault` (github dependency).

### 2. Wormhole integration — plugin registration + Swagger docs for raw routes

The `/pulsevault` mount carries binary TUS/video bytes, which can't go through `meteor-wormhole`'s JSON-only REST bridge (1 MB body cap, `application/json`-only Content-Type, no streaming/custom-header support) — so it can never become a Meteor method like the four above. It was previously mounted directly on `WebApp.connectHandlers`, invisible to Wormhole and undocumented in Swagger.

Two changes close that gap:

- **Registration**: `pulsevault.js` now registers the mount through `Wormhole.use()` instead of `WebApp.connectHandlers.use()` directly. `api.mount()` is a thin wrapper around the same underlying call — request handling is unchanged — but the endpoint is now tracked in Wormhole's plugin registry instead of being a disconnected side-channel.
- **Documentation**: `pulsevault-docs.js` (new file) hand-writes OpenAPI 3.1 Path Item Objects for all 7 raw operations (`GET /pulsevault/capabilities`, `POST /pulsevault/upload`, `PATCH|HEAD|DELETE /pulsevault/upload/{id}`, `GET|DELETE /pulsevault/artifacts/{artifactId}`) per `@mieweb/pulsevault`'s own `PROTOCOL.md`. These are contributed via a new `api.addOpenApiPaths()` call in the plugin's `start()` and merged into the *same* spec served at `/api/docs` — no separate Swagger page.

  This required a small patch to the vendored `wreiske:meteor-wormhole` package (`vendor/meteor-wormhole`, a git submodule pointing at the `mieweb/meteor-wormhole` fork — **currently uncommitted in the submodule**, backed up as a plain diff at `vendor-patches/meteor-wormhole-openapi-extra-paths.patch` since we're intentionally not committing inside the submodule yet):
  - `plugins.js`: `PluginHost` gains `addOpenApiPaths(paths)` (on the plugin `api`) and `getOpenApiPaths()`.
  - `wormhole.js`: passes a lazy `getExtraOpenApiPaths` getter into `RestBridge` so late-registered plugins are still picked up.
  - `rest-bridge.js` / `openapi.js`: `generateOpenApiSpec()` accepts an `extraPaths` option and merges it into `spec.paths`, throwing on any key collision with a method-derived path.

  This patch is fully generic — no PulseVault-specific code anywhere in the 4 changed vendor files — so it's a candidate for an upstream PR against `mieweb/meteor-wormhole` (tracked separately, not part of this change).

### 3. `attachments.js` — extract `createAttachment()`

- Pulled the document-building logic out of the `attachments.add` method into an exported `createAttachment({ url, type, title, thumbnail, attachedTo, addedBy })` helper.
- `attachments.add` now just resolves the caller's identity and delegates to it. `pulsevault.js`'s `onUploadComplete` calls the same helper directly with the reservation's `userId`, since it isn't running inside a Meteor method call and has no `this` identity to resolve.

### 4. Deep-link protocol update (`src/features/media/PulseUploadButton.tsx`)

- `buildUploadDeepLink(videoid, uploadToken)` now encodes `v=1`, `artifactId`, `server`, `token`, `uploadUnit=merged` — matching `@mieweb/pulsevault`'s documented `buildUploadLink` protocol — instead of the old `mode`/`videoid` params. The capability token is now part of the link.
- `pulseServerBase()` appends the `/pulsevault` mount prefix, since the package's client builds every request as `${server}/<path>` with no separate prefix concept.

### 5. `videoApi.uploadEndpoint()` (`src/lib/api.ts`)

- Now points at `/pulsevault/upload` instead of `/uploads/tus`.

### 6. Dev proxy (`vite.config.ts`)

- Added a `/pulsevault` proxy entry, deliberately **without** `changeOrigin: true`. `@mieweb/pulsevault`'s TUS layer builds its `Location` header from the request's `Host` header — with `changeOrigin: true` that header would read `localhost:3100`, sending the browser's follow-up PATCH/HEAD requests direct to the backend and hitting real cross-origin CORS instead of the proxied same-origin path.

### 7. Local device testing (`ecosystem.config.cjs`, gitignored — not part of this PR)

- Real-device testing (scanning the upload QR with an iPhone) requires the Meteor backend's `ROOT_URL`/`APP_URL` and the frontend's `VITE_TIMECORE_URL` to point at the dev machine's LAN IP, not `127.0.0.1`/`localhost` — otherwise the Pulse Cam app tries to reach itself. `ecosystem.config.cjs` centralizes this behind one `IP_ADDRESS` constant; noting here since it's easy to lose track of when debugging "can't reach server" on-device.

### 8. Ignore/config cleanup

- `.gitignore` / `meteor-backend/.meteorignore`: `uploads/` (and `data/`) excluded from git tracking and from Meteor's file watcher — upload writes must never trigger hot reloads.
- `meteor-backend/uploads/.gitignore` removed (superseded by the root-level ignore rule).
- `ios/App/App/Info.plist`: added `NSAllowsLocalNetworking` so the iOS app can reach a local dev backend during device testing of the upload flow.
- Deleted `meteor-backend/server/pulsevault.js.bak` (backup of the old hand-rolled module, superseded by the new file).

### 9. Tests

- `src/features/media/PulseUploadButton.test.ts` (unit): asserts the deep-link protocol encodes the new params and that the legacy `mode`/`videoid` params are gone.
- `tests/e2e/tickets/pulsevault.spec.ts`: API-level contract (reserve auth, TUS upload creation/auth) plus the full ticket-upload flow (QR modal, deep link, device upload, resulting attachment).
- `tests/e2e/tickets/media-upload.spec.ts`: media-library upload button — MP4 upload through the PulseVault endpoint and image upload (non-TUS path).
- `tests/e2e/fixtures/test-video.mp4`: real MP4 fixture so the MP4 sniffer validation has real bytes to check.

## Acceptance Criteria

- [x] REST API + Swagger UI enabled via `meteor-wormhole` (`/api/docs`, `/api/openapi.json`)
- [x] All 4 PulseVault methods registered as MCP tools and REST endpoints with full schemas
- [x] `/pulsevault` mount registered through `Wormhole.use()` (plugin registry), not a bare `WebApp.connectHandlers.use()` call
- [x] All 7 raw `/pulsevault/*` routes documented in the same `/api/docs` Swagger page (verified: `GET /api/openapi.json` lists all 8 `pulsevault*` paths)
- [x] TUS auth still enforced after the plugin conversion (verified: missing-token upload → `401`, unauthenticated method call → rejected, not `404`)
- [ ] Ticket video upload via QR/deep link completes and creates a ticket attachment (in progress — device-testing LAN connectivity issue found and fixed; full flow not yet confirmed end-to-end)
- [ ] Media-library video upload via the web upload button completes and appears in the grid
- [ ] Media-library image upload still works (non-TUS path unaffected)
- [ ] `PulseUploadButton.test.ts` passes
- [ ] `tests/e2e/tickets/pulsevault.spec.ts` and `tests/e2e/tickets/media-upload.spec.ts` pass
- [ ] `npm run lint && npm run typecheck` pass
- [ ] Dev proxy correctly forwards `/pulsevault/*` without breaking TUS `Location` headers

## Out of Scope (for Now)

- Trimming the verbose `console.log`/`console.error` debug instrumentation added throughout `pulsevault.js` while integrating the new package — useful during rollout, candidate for a follow-up cleanup pass.
- Broader Fastify-era dead code cleanup (tracked separately in `fastify-cleanup.md`).
- Production rotation/secrets-management story for `PULSEVAULT_SECRET` (currently a single env var with a dev-only fallback).
- Persisting reservations outside the in-memory `reservationContext` map (a server restart mid-upload currently just requires re-scanning the QR code).
- Committing the `vendor/meteor-wormhole` submodule patch, or upstreaming it as a PR against `mieweb/meteor-wormhole` — tracked separately; currently backed up only as `vendor-patches/meteor-wormhole-openapi-extra-paths.patch`.
- Adding `pulsevault_getVideo` / `pulsevault_listVideos` to the frontend media library UI (currently backend-only).
