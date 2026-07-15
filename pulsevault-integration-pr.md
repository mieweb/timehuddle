# Adopt @mieweb/pulsevault for Video Uploads

## Summary

- Replaces the hand-rolled TUS upload server (`@tus/server` + `@tus/file-store`) with the real `@mieweb/pulsevault` package, and updates the client deep-link protocol and upload endpoint to match its documented contract.
- Registers the `/pulsevault` mount as a `meteor-wormhole` plugin (`Wormhole.use()`) instead of a bare `WebApp.connectHandlers.use()` call, so it's tracked in Wormhole's plugin registry instead of being a disconnected side-channel endpoint.
- Documents PulseVault's 7 raw TUS/artifact routes at a standalone Swagger page, `GET /pulsevault/docs` — Wormhole's own `/api/docs` only auto-documents JSON Meteor methods, with no extension point for hand-written binary routes.

## Swagger UIs

| What                                                                               | URL (relative to the Meteor backend, port 3100 in dev) |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Main API — JSON methods (`reserve`, `getVideo`, `listVideos`, `reserveForLibrary`) | `/api/docs`                                            |
| PulseVault raw routes — TUS upload, artifact serving                               | `/pulsevault/docs`                                     |

## What Changed

**Backend (`meteor-backend/server/pulsevault.js`)**

- Mounts `@mieweb/pulsevault`'s core (`createPulseVaultCore`, `createLocalStorage`, `createMp4Sniffer`) via `Wormhole.use({ name: 'pulsevault', start(api) { api.mount('/pulsevault', ...) } })`.
- `pulsevault.reserve` / `pulsevault.reserveForLibrary` mint short-lived HMAC capability tokens (`issueCapabilityToken`) per `artifactId`, scoped to a ticket or the media library.
- `pulsevault.getVideo` / `pulsevault.listVideos` read back media-library entries for playback URLs and listings.
- All four methods are registered with `Wormhole.expose` (full input/output schemas) in `main.js`, giving them REST + OpenAPI + MCP surface automatically.
- `authorize` hook verifies the capability token on upload; `validatePayload` runs the package's MP4 sniffer; `onUploadComplete` creates a `mediaitems` doc or ticket attachment via the extracted `createAttachment()` helper.

**Swagger docs (`meteor-backend/server/pulsevault-docs.js`, new)**

- Hand-written OpenAPI 3.1 spec for `GET /capabilities`, `POST /upload`, `PATCH|HEAD|DELETE /upload/{id}`, `GET|DELETE /artifacts/{artifactId}` — route shapes and response contracts taken directly from `@mieweb/pulsevault`'s own `PROTOCOL.md`.
- Served at `GET /pulsevault/docs` (Swagger UI) and `GET /pulsevault/openapi.json`, handled inside the same plugin's mount callback alongside the existing TUS request handling. Kept as a separate page rather than merging into `/api/docs`, since merging would require patching the vendored `meteor-wormhole` package — out of scope here.

**Frontend**

- `PulseUploadButton.tsx`: `buildUploadDeepLink()` now encodes `v=1`, `artifactId`, `server`, `token`, `uploadUnit=merged` (matching `@mieweb/pulsevault`'s `buildUploadLink` protocol) instead of the old `mode`/`videoid` params. `pulseServerBase()` appends the `/pulsevault` prefix.
- `api.ts`: `videoApi.uploadEndpoint()` now points at `/pulsevault/upload` instead of `/uploads/tus`.
- `vite.config.ts`: added a `/pulsevault` proxy entry **without** `changeOrigin: true`, so the TUS `Location` header (built from the request's `Host`) resolves to the proxied same-origin path instead of leaking the raw backend port.

**Config/cleanup**

- `package.json`: removed `@tus/file-store`/`@tus/server`, added `@mieweb/pulsevault`.
- `.gitignore` / `.meteorignore`: excluded `uploads/`/`data/` from git and Meteor's file watcher.
- `ios/App/App/Info.plist`: added `NSAllowsLocalNetworking` for local device testing.
- Deleted `meteor-backend/server/pulsevault.js.bak` (superseded).

## Test Plan

- [x] `GET /pulsevault/capabilities` returns the correct protocol payload
- [x] `GET /pulsevault/docs` and `GET /pulsevault/openapi.json` serve a standalone Swagger page listing all 7 raw routes
- [x] `GET /api/docs` / `GET /api/openapi.json` unaffected — still lists only the 4 JSON methods
- [x] Upload rejected without a capability token (`401`), unauthenticated method calls rejected (not `404`)
- [ ] Ticket video upload via QR/deep link completes and creates a ticket attachment (in progress — LAN connectivity issue for device testing found and fixed, full flow not yet confirmed end-to-end)
- [ ] Media-library video upload via the web upload button completes and appears in the grid
- [ ] Media-library image upload still works (non-TUS path unaffected)
- [ ] `PulseUploadButton.test.ts`, `tests/e2e/tickets/pulsevault.spec.ts`, `tests/e2e/tickets/media-upload.spec.ts` pass
- [ ] `npm run lint && npm run typecheck && npm run format` pass

## Out of Scope

- Merging `/pulsevault/docs` into `/api/docs` (would require patching the vendored `meteor-wormhole` package).
- Trimming verbose `console.log` debug instrumentation in `pulsevault.js`.
- Production secrets-rotation story for `PULSEVAULT_SECRET`.
- Persisting upload reservations outside the in-memory map.
- Adding `pulsevault_getVideo` / `pulsevault_listVideos` to the frontend media library UI.
