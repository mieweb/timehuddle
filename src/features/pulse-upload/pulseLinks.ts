/**
 * Pulse pairing links, built client-side in @mieweb/pulsevault's https form
 * (PROTOCOL.md §3, `buildUploadLink({ form: 'https' })`): a Universal Link /
 * App Link on the link host the Pulse app claims. A phone camera or a tap opens
 * Pulse straight away when it's installed; when it isn't, Pulse's page there
 * sends the person to the App Store or Google Play and keeps the link for after
 * the install. TimeHuddle doesn't decide any of that itself.
 *
 * Built here rather than with the package's `buildUploadLink`, which is only
 * exported from its server entry points; pulseLinks.test.ts checks the two
 * agree.
 */
import { TIMECORE_BASE_URL } from '../../lib/api';

/**
 * The page Pulse claims as its link host (@mieweb/pulsevault's
 * `PULSE_OPEN_URL`). Fixed: an app can only claim domains it was built with.
 */
export const PULSE_OPEN_URL = 'https://mieweb.github.io/pulse/open';

/**
 * The server Pulse uploads to — the backend origin plus the `/pulsevault`
 * mount prefix, per `buildUploadLink`'s `server` contract (the app builds every
 * request as `${server}/<path>`, with no prefix of its own).
 */
export function pulseServerBase(): string {
  return `${TIMECORE_BASE_URL.replace(/\/$/, '')}/pulsevault`;
}

/**
 * The pairing link for one reserved upload: `v=1`, `artifactId`, `server` and
 * the capability `token`, in the fragment — browsers never send a fragment, so
 * the link host never receives the token.
 */
export function buildPulseLink(videoid: string, uploadToken: string): string {
  const params = new URLSearchParams({
    v: '1',
    artifactId: videoid,
    server: pulseServerBase(),
    token: uploadToken,
  });
  return `${PULSE_OPEN_URL}#${params.toString()}`;
}
