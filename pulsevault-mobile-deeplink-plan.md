# PulseVault Mobile Deep-Link Plan

Make the "Upload video with Pulse" flow open the **Pulse Cam** app directly on
mobile browsers (instead of showing a QR code), and fall back to the App
Store / Play Store when Pulse Cam isn't installed.

## Background

Today device detection is only `Capacitor.isNativePlatform()`:

- **Native app** → opens `pulsecam://…` directly (`window.open(link, '_system')`).
- **Everything else** (including a phone's Safari/Chrome) → shows the QR modal.

So a mobile browser user gets a QR code they can't scan with the same phone.

## Store Links (verified)

- iOS: `https://apps.apple.com/us/app/pulse-cam/id6748621024` (bundle `com.mieweb.pulse`)
- Android: `https://play.google.com/store/apps/details?id=com.mieweb.pulse`

## Target Behavior

| Context        | Action                                                        |
| -------------- | ------------------------------------------------------------- |
| Native app     | Open `pulsecam://` via `window.open(link, '_system')` (unchanged) |
| Mobile browser | Set `location.href = pulsecam://` → app opens; if not installed after ~1.5s, redirect to App Store / Play Store |
| Desktop        | Show QR modal + "Upload from this device" (unchanged)         |

## Milestones

- [x] **M1 — Device helper** (`src/lib/device.ts`): `isNativeApp()`,
      `getMobileOS()`, `isMobileBrowser()`, `PULSE_STORE_URLS`, and
      `openPulseAppOrStore(deepLink, os)` with the install-fallback timer.
- [ ] **M2 — Ticket button** (`PulseUploadButton.tsx`): branch mobile-browser →
      `openPulseAppOrStore`, keep native + desktop paths.
- [ ] **M3 — Huddle button** (`PulseAttachButton.tsx`): same branch.
- [ ] **M4 — Tests**: `src/lib/device.test.ts` for detection + store selection;
      extend `PulseUploadButton.test.ts` as needed.
- [ ] **M5 — Validation**: `npm run lint`, `npm run typecheck`, `npm test` green.
