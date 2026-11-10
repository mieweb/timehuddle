/**
 * Pulse pairing links, built client-side in @mieweb/pulsevault's https form
 * (PROTOCOL.md §3, `buildUploadLink({ form: 'https' })`): a Universal Link /
 * App Link on the link host the Pulse app claims. A phone camera or a tap opens
 * Pulse straight away when it's installed; when it isn't, Pulse's page there
 * sends the person to the App Store or Google Play and keeps the link for after
 * the install. TimeHuddle doesn't decide any of that itself.
 *
 * Built here rather than with the package's `buildUploadLink`, which is only
 * exported from its server entry points; pulseLinks.test.ts holds the two to
 * the same link, with and without the hints and the way back.
 */
import { TIMECORE_BASE_URL, type PulseReservation } from '../../lib/api';

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

/** Who sends Pulse there, on a link opened on the phone itself (Pulse shows "label · app"). */
export const PULSE_LINK_APP = 'TimeHuddle';

/**
 * Caps on what a link carries besides the upload (PROTOCOL.md §3.1), in
 * characters (Unicode code points).
 */
const MAX_LABEL_LENGTH = 60;
const MAX_NAME_LENGTH = 80;
const MAX_APP_LENGTH = 30;
const MAX_RETURN_URL_LENGTH = 512;

/**
 * A display hint as the link carries it, exactly as the package's
 * `buildUploadLink` cleans one: a single line of plain text, at most `max`
 * characters. Control characters and line breaks become a space,
 * bidirectional-formatting characters (which can reorder the text shown around
 * them) are dropped, and a longer text is cut at a whole user-perceived
 * character, never through an emoji sequence or an accent. Blank or invisible:
 * none.
 */
function displayText(value: string | undefined, max: number): string {
  if (typeof value !== 'string') return '';
  const text = value
    .replace(/[\p{Cc}\u2028\u2029]+/gu, ' ')
    .replace(/\p{Bidi_Control}/gu, '')
    .trim();
  if (/^[\s\p{Cf}]*$/u.test(text)) return '';
  if (Array.from(text).length <= max) return text;
  let cut = '';
  let length = 0;
  for (const { segment } of new Intl.Segmenter().segment(text)) {
    length += Array.from(segment).length;
    if (length > max) break;
    cut += segment;
  }
  return cut.trim();
}

/** Plain http is for development only: localhost or a private address, as Pulse itself checks. */
function isPrivateDevOrigin(url: URL): boolean {
  if (url.protocol !== 'http:') return false;
  const host = url.hostname;
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    /^10\.\d+\.\d+\.\d+$/.test(host) ||
    /^192\.168\.\d+\.\d+$/.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(host) ||
    /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+$/.test(host) ||
    /^169\.254\.\d+\.\d+$/.test(host)
  );
}

/**
 * The link's `return` param: `url` as the URL parser reads it (`href`), when
 * Pulse may offer it as the way back — https (or plain http in development),
 * no username or password, at most 512 characters. Otherwise none: no "Back to
 * TimeHuddle" beats a link Pulse refuses. (The package's builder throws for
 * these; a page has nobody to throw to.)
 */
function returnParam(url: string | undefined): string {
  if (!url?.trim()) return '';
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return '';
  }
  if (parsed.protocol !== 'https:' && !isPrivateDevOrigin(parsed)) return '';
  if (parsed.username !== '' || parsed.password !== '') return '';
  return parsed.href.length > MAX_RETURN_URL_LENGTH ? '' : parsed.href;
}

/**
 * The page a link opened on this phone says to come back to: where the person
 * is, and the team it is scoped to (`?team=`, see src/ui/ROUTING.md). Every
 * other query param is view state (a search, a filter) and stays here: the
 * link travels in clear.
 */
export function pulseReturnPath({ pathname, search }: { pathname: string; search: string }) {
  const team = new URLSearchParams(search).get('team');
  // One leading slash: `//host/…` would name another site once made absolute.
  return `${pathname.replace(/^\/+/, '/')}${team ? `?${new URLSearchParams({ team })}` : ''}`;
}

/**
 * The pairing link for one reserved upload: `v=1`, `artifactId`, `server` and
 * the capability `token`, in the fragment — browsers never send a fragment, so
 * the link host never receives the token.
 *
 * It is one upload, as ever. For a place Pulse keeps a draft for, it also
 * carries the reservation's hints (PROTOCOL.md §3.1), which an older Pulse
 * ignores: `label`, what the place is called, and `name`, what a new
 * recording made from the link is called. Which place it is, Pulse reads from
 * the token (its signed `ref`), so the link stays short enough for a QR.
 *
 * `returnUrl`, the page the person is on, is for a link opened on the phone
 * itself (a tap, or the TimeHuddle app): that link also says who sent it
 * (`app`) and where to go back to once the video is up (`return`). A QR is
 * scanned from another screen, where neither means anything, so it has none.
 */
export function buildPulseLink(reservation: PulseReservation, returnUrl?: string): string {
  const params = new URLSearchParams({
    v: '1',
    artifactId: reservation.videoid,
    server: pulseServerBase(),
    token: reservation.uploadToken,
  });
  const hints = {
    label: displayText(reservation.label, MAX_LABEL_LENGTH),
    name: displayText(reservation.name, MAX_NAME_LENGTH),
    app: returnUrl === undefined ? '' : displayText(PULSE_LINK_APP, MAX_APP_LENGTH),
    return: returnParam(returnUrl),
  };
  for (const [key, value] of Object.entries(hints)) if (value) params.set(key, value);
  return `${PULSE_OPEN_URL}#${params.toString()}`;
}
