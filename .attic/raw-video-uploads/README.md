# Archived Raw Video Uploads

**Archived on**: 2026-09-30

**Reason**: Videos now come into TimeHuddle through the Pulse app only.
PulseVault (`@mieweb/pulsevault`, vendored at `vendor/pulsevault`) is built for
Pulse's pairing-link upload protocol, not as a general file-upload endpoint, and
the web app's own "pick a video file" paths were borrowing it. A proper video
upload API will be designed separately. Until then there is no browser-side
video upload anywhere in the app. See release note `release-notes/1.0.5.md`.

## What Was Here

- `videoThumbnail.ts`: grabbed a poster frame from a picked video file in the
  browser (`<video>` + `<canvas>`), used by the profile feed's video upload.
  Pulse uploads its own thumbnail now, which the backend links to the video.
- `media-thumbnail-route.js`: the backend `POST /api/media-thumbnail/:id` route
  (from `meteor-backend/server/uploads.js`) that stored that browser-made
  poster frame. Not runnable on its own, because it used `uploads.js`'s
  module-level helpers.

## Removed Outright (Small, Nothing Worth Keeping)

- The TUS upload blocks in the Huddle composer (`uploadMedia`'s video branch),
  both Pulse buttons' "Upload from this device", the profile feed and the
  timesheet justification field, plus `videoApi`'s shared TUS settings and the
  `tus-js-client` dependency.
- The ticket Pulse button's per-ticket `videoid` reuse
  (`pulsevault:ticket:<id>` in localStorage) and `pulsevault.reserve`'s
  `existingVideoid`: Pulse treats one pairing link as one upload, so an old id
  is only ever a spent link.
- The timesheet rule that adding past time needs a video. The walkthrough is
  now optional and recorded with Pulse (the Huddle composer's Pulse button);
  the backend still checks the video belongs to the requester.
