/**
 * Pulse pairing links, built client-side per @mieweb/pulsevault's PROTOCOL.md
 * §3 — the `pulsecam://` deep link a phone opens, and the https scan link the
 * QR code encodes.
 */
import { TIMECORE_BASE_URL } from '../../lib/api';

/**
 * The Pulse Cam server base for deep links — origin plus the `/pulsevault`
 * mount prefix, per @mieweb/pulsevault's `buildUploadLink` `server` contract
 * (the client builds every request as `${server}/<path>` with no separate
 * prefix concept of its own).
 */
export function pulseServerBase(): string {
  return `${TIMECORE_BASE_URL.replace(/\/$/, '')}/pulsevault`;
}

/**
 * Build the pulsecam:// deep link entirely client-side. Mirrors
 * @mieweb/pulsevault's `buildUploadLink` protocol (PROTOCOL.md §3): `v=1`,
 * `artifactId`, `server`, and `token` (the capability token authorizing the
 * upload).
 */
export function buildUploadDeepLink(videoid: string, uploadToken: string): string {
  return `pulsecam://?${uploadParams(videoid, uploadToken).toString()}`;
}

/**
 * Build the https URL to encode in the QR code. Phone camera apps ignore a raw
 * `pulsecam://` QR when Pulse Cam isn't installed — the scan simply does
 * nothing. Pointing the QR at the backend's `/pulse/open` interstitial instead
 * means the phone lands on a page that opens Pulse Cam when it is installed and
 * offers the App Store / Play Store listing when it isn't.
 */
export function buildScanLink(videoid: string, uploadToken: string): string {
  const base = TIMECORE_BASE_URL.replace(/\/$/, '');
  return `${base}/pulse/open?${uploadParams(videoid, uploadToken).toString()}`;
}

function uploadParams(videoid: string, uploadToken: string): URLSearchParams {
  return new URLSearchParams({
    v: '1',
    artifactId: videoid,
    server: pulseServerBase(),
    token: uploadToken,
  });
}
