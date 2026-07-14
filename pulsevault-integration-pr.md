# Adopt @mieweb/pulsevault for Video Uploads

## Overview

Replaces the hand-rolled TUS upload server (`@tus/server` + `@tus/file-store`) backing PulseVault with the real `@mieweb/pulsevault` package, and updates the client deep-link protocol and upload endpoint to match its documented contract. This removes a maintenance burden (a bespoke TUS implementation) in favor of a shared, versioned package.

## Current State

- Video uploads (ticket attachments and media-library items) were served by a hand-rolled TUS server built directly on `@tus/server`/`@tus/file-store`.
- `videoApi.uploadEndpoint()` pointed at `/uploads/tus`.
- The `pulsecam://` deep link encoded `mode`, `videoid`, `server` — no capability token, so the link alone was the only credential.
- `pulseServerBase()` pointed straight at the API root.
- `attachments.add` inlined all attachment-creation logic; nothing else could create an attachment on behalf of another flow.

## Proposed Changes

### 1. Backend — swap in `@mieweb/pulsevault` (`meteor-backend/server/pulsevault.js`, new file)

- Mounts `@mieweb/pulsevault`'s core (`createPulseVaultCore`, `createLocalStorage`, `createMp4Sniffer`) on `WebApp.connectHandlers` at `/pulsevault`, replacing the old hand-rolled server.
- `pulsevault.reserve` / `pulsevault.reserveForLibrary` Meteor methods mint a short-lived HMAC capability token (`issueCapabilityToken`) per `artifactId`, scoped to either a ticket or the media library, tracked in an in-memory `reservationContext` map.
- `authorize` hook verifies the capability token on upload; `validatePayload` runs the package's MP4 sniffer.
- `onUploadComplete` looks up the reservation and either inserts a `mediaitems` doc (library target) or calls the new `createAttachment()` helper (ticket target).
- `main.js`: imports `./pulsevault`, and adds two new `Wormhole.expose` entries so both reservation methods are reachable over `meteor-wormhole`'s generated REST/OpenAPI/MCP surface, not just as internal Meteor method calls:
  - `pulsevault.reserve` — `{ ticketId, existingVideoid, target }`, described as "Reserve a videoid for TUS video upload"
  - `pulsevault.reserveForLibrary` — no params, described as "Reserve a videoid for media library TUS upload"
- `package.json`: removed `@tus/file-store` and `@tus/server`; added `@mieweb/pulsevault` (github dependency).

### 2. `attachments.js` — extract `createAttachment()`

- Pulled the document-building logic out of the `attachments.add` method into an exported `createAttachment({ url, type, title, thumbnail, attachedTo, addedBy })` helper.
- `attachments.add` now just resolves the caller's identity and delegates to it. `pulsevault.js`'s `onUploadComplete` calls the same helper directly with the reservation's `userId`, since it isn't running inside a Meteor method call and has no `this` identity to resolve.

### 3. Deep-link protocol update (`src/features/media/PulseUploadButton.tsx`)

- `buildUploadDeepLink(videoid, uploadToken)` now encodes `v=1`, `artifactId`, `server`, `token`, `uploadUnit=merged` — matching `@mieweb/pulsevault`'s documented `buildUploadLink` protocol — instead of the old `mode`/`videoid` params. The capability token is now part of the link.
- `pulseServerBase()` appends the `/pulsevault` mount prefix, since the package's client builds every request as `${server}/<path>` with no separate prefix concept.

### 4. `videoApi.uploadEndpoint()` (`src/lib/api.ts`)

- Now points at `/pulsevault/upload` instead of `/uploads/tus`.

### 5. Dev proxy (`vite.config.ts`)

- Added a `/pulsevault` proxy entry, deliberately **without** `changeOrigin: true`. `@mieweb/pulsevault`'s TUS layer builds its `Location` header from the request's `Host` header — with `changeOrigin: true` that header would read `localhost:3100`, sending the browser's follow-up PATCH/HEAD requests direct to the backend and hitting real cross-origin CORS instead of the proxied same-origin path.

### 6. Ignore/config cleanup

- `.gitignore` / `meteor-backend/.meteorignore`: `uploads/` (and `data/`) excluded from git tracking and from Meteor's file watcher — upload writes must never trigger hot reloads.
- `meteor-backend/uploads/.gitignore` removed (superseded by the root-level ignore rule).
- `ios/App/App/Info.plist`: added `NSAllowsLocalNetworking` so the iOS app can reach a local dev backend during device testing of the upload flow.
- Deleted `meteor-backend/server/pulsevault.js.bak` (backup of the old hand-rolled module, superseded by the new file).

### 7. Tests

- `src/features/media/PulseUploadButton.test.ts` (unit): asserts the deep-link protocol encodes the new params and that the legacy `mode`/`videoid` params are gone.
- `tests/e2e/tickets/pulsevault.spec.ts`: API-level contract (reserve auth, TUS upload creation/auth) plus the full ticket-upload flow (QR modal, deep link, device upload, resulting attachment).
- `tests/e2e/tickets/media-upload.spec.ts`: media-library upload button — MP4 upload through the PulseVault endpoint and image upload (non-TUS path).
- `tests/e2e/fixtures/test-video.mp4`: real MP4 fixture so the MP4 sniffer validation has real bytes to check.

## Acceptance Criteria

- [ ] Ticket video upload via QR/deep link completes and creates a ticket attachment
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
