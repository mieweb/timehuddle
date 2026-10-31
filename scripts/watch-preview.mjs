/**
 * Link-preview tags for a video's page (`/watch/:videoId`, WatchPage).
 *
 * Chat apps (Slack, iMessage, WhatsApp, Teams, Discord…) build a link's
 * preview card from the Open Graph and Twitter tags in the HTML the link
 * answers with; they never run the app's JavaScript. So whatever serves the
 * frontend writes these into index.html for a watch path: serve-frontend.mjs
 * in a deployment, the Vite plugin (vite.config.ts) in development.
 *
 * The card shows what the page shows a signed-out visitor — the video's name,
 * never who added it, since a preview reaches people outside the team — and
 * the video's poster: the thumbnail chosen for it in Pulse, which PulseVault
 * serves at `/artifacts/:id/poster`.
 */

/** A PulseVault artifact id, as WatchPage reads one (a UUID). */
const WATCH_PATH = /^\/watch\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i;

/** How long a preview waits on the backend before serving the plain page. */
const BACKEND_TIMEOUT_MS = 3000;

/** The video id in a `/watch/:videoId` path, or null. */
export function watchVideoId(pathname) {
  const match = WATCH_PATH.exec(pathname);
  return match ? match[1].toLowerCase() : null;
}

/** `value` safe inside a double-quoted HTML attribute or element text. */
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * The content type `url` answers with, or null when it isn't there. A GET of
 * its first byte, not a HEAD: PulseVault's routes answer GET only, and a HEAD
 * falls through to the backend's own HTML page.
 */
async function contentTypeAt(url, fetchImpl) {
  const res = await fetchImpl(url, {
    headers: { Range: 'bytes=0-0' },
    signal: AbortSignal.timeout(BACKEND_TIMEOUT_MS),
  }).catch(() => null);
  await res?.body?.cancel().catch(() => {});
  return res?.ok ? (res.headers.get('content-type') ?? '').split(';')[0] || null : null;
}

/**
 * What a video's preview card shows, or null when the backend has no such
 * video (or can't be reached): the page then goes out without a card.
 *
 * @param {string} videoId
 * @param {{ backendUrl: string, fetchImpl?: typeof fetch }} options
 *   backendUrl: the backend's public address — the card's image and video
 *   are fetched from it by the chat app, not by this server.
 */
export async function watchPreview(videoId, { backendUrl, fetchImpl = fetch }) {
  const base = backendUrl.replace(/\/+$/, '');
  const res = await fetchImpl(`${base}/api/videos_publicInfo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ videoId }),
    signal: AbortSignal.timeout(BACKEND_TIMEOUT_MS),
  }).catch(() => null);
  if (!res?.ok) return null;
  const info = (await res.json().catch(() => null))?.result;
  if (!info) return null;

  const videoUrl = `${base}/pulsevault/artifacts/${videoId}`;
  const posterUrl = `${videoUrl}/poster`;
  const [posterType, videoType] = await Promise.all([
    contentTypeAt(posterUrl, fetchImpl),
    contentTypeAt(videoUrl, fetchImpl),
  ]);
  return {
    title: info.name || 'Video',
    description: info.addedAt
      ? `A video on TimeHuddle, added ${dateLabel(info.addedAt)}.`
      : 'A video on TimeHuddle.',
    image: posterType?.startsWith('image/') ? { url: posterUrl, type: posterType } : null,
    video: videoType?.startsWith('video/') ? { url: videoUrl, type: videoType } : null,
  };
}

/** `Oct 29, 2026` — the same for every reader of a card. */
function dateLabel(iso) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * The tags for a preview card, as HTML.
 *
 * @param {NonNullable<Awaited<ReturnType<typeof watchPreview>>>} preview
 * @param {string | null} pageUrl the watch page's own absolute address, when it's known
 */
export function previewTags(preview, pageUrl) {
  const meta = (attr, key, value) =>
    value ? `<meta ${attr}="${key}" content="${escapeHtml(value)}" />` : '';
  const secure = (url) => (url.startsWith('https:') ? url : null);
  return [
    `<title>${escapeHtml(preview.title)} · TimeHuddle</title>`,
    meta('name', 'description', preview.description),
    meta('property', 'og:site_name', 'TimeHuddle'),
    meta('property', 'og:type', preview.video ? 'video.other' : 'website'),
    meta('property', 'og:title', preview.title),
    meta('property', 'og:description', preview.description),
    meta('property', 'og:url', pageUrl),
    ...(preview.image
      ? [
          meta('property', 'og:image', preview.image.url),
          meta('property', 'og:image:secure_url', secure(preview.image.url)),
          meta('property', 'og:image:type', preview.image.type),
          meta('property', 'og:image:alt', preview.title),
        ]
      : []),
    ...(preview.video
      ? [
          meta('property', 'og:video', preview.video.url),
          meta('property', 'og:video:secure_url', secure(preview.video.url)),
          meta('property', 'og:video:type', preview.video.type),
        ]
      : []),
    meta('name', 'twitter:card', preview.image ? 'summary_large_image' : 'summary'),
    meta('name', 'twitter:title', preview.title),
    meta('name', 'twitter:description', preview.description),
    meta('name', 'twitter:image', preview.image?.url),
  ]
    .filter(Boolean)
    .join('\n    ');
}

/**
 * index.html with its `<title>` swapped for a video's preview tags. A function
 * replacement, so a `$` in a video's name is only text, never a pattern.
 */
export function withPreview(html, preview, pageUrl) {
  return html.replace(/<title>[\s\S]*?<\/title>/, () => previewTags(preview, pageUrl));
}
