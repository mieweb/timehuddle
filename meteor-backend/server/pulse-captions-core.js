/**
 * A Pulse video's captions, with no Meteor or database (pulse-captions.js
 * mounts the route and runs the backfill; pulsevault.js looks captions up at
 * delivery): which id is an artifact's, which of a pulse's files are its
 * captions, the URL a client plays them from, and what
 * `GET /pulse/captions/:videoId` answers.
 *
 * Pulse uploads a video's captions as a `.vtt` artifact `relatedTo` the video,
 * before the video itself, so they are there when the video's upload
 * completes. A media item keeps the captions artifact's id (`captionsId`:
 * the id, or null once looked up and none found; absent until looked up).
 *
 * The route redirects to the captions artifact instead of proxying it:
 * PulseVault serves a `.vtt` artifact with `Content-Type: text/vtt`, which a
 * `<track>` needs (Safari won't parse captions served as anything else). See
 * CAPTIONS_CONTENT_TYPE.
 */

/** An artifact id as PulseVault takes one (its `isUuid`): a UUID, any case. */
export const ARTIFACT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The only captions format a `<track>` plays. PulseVault also accepts `.srt`, which it can't. */
export const CAPTIONS_EXT = '.vtt';

/**
 * What PulseVault serves a `.vtt` artifact as (@mieweb/pulsevault 0.9.0:
 * `extToContentType` in dist/storage/local.js and dist/storage/s3.js, applied
 * over the guessed type by `serveResolution` in dist/core.js). It is already
 * what a `<track>` needs, so the route redirects rather than proxies.
 */
export const CAPTIONS_CONTENT_TYPE = 'text/vtt';

/** How many media items one backfill pass looks up at a time. */
export const BACKFILL_BATCH = 100;

export function isArtifactId(id) {
  return typeof id === 'string' && ARTIFACT_ID.test(id);
}

/** Where an artifact is played from: path-only, as every stored URL is (see pulsevault.js). */
export function artifactPathOf(artifactId) {
  return `/pulsevault/artifacts/${artifactId}`;
}

/**
 * The captions artifact's id in a pulse (PulseVault's `getPulse`), or null:
 * only a video's, only finished ones, and only WebVTT, which a `<track>` can
 * play.
 */
export function captionsIdOf(pulse) {
  if (pulse?.video?.kind !== 'video') return null;
  const captions = pulse.captions;
  if (!captions || captions.kind !== 'captions' || captions.ready === false) return null;
  if (String(captions.ext ?? '').toLowerCase() !== CAPTIONS_EXT) return null;
  return isArtifactId(captions.artifactId) ? captions.artifactId : null;
}

/** The URL a media item's captions play from, or null when it has none (or none known yet). */
export function captionsUrlOf(item) {
  return isArtifactId(item?.captionsId) ? artifactPathOf(item.captionsId) : null;
}

/**
 * What `GET /pulse/captions/:videoId` answers: 400 for an id that isn't an
 * artifact's, 404 when the video has no captions (or isn't a video), else a
 * 302 to the captions artifact. `lookup(videoId)` resolves the captions id or
 * null (captionsIdFor); a lookup that throws is the caller's 500.
 */
export async function routeDecision(id, lookup) {
  if (!isArtifactId(id)) return { status: 400, error: '`videoId` must be a valid UUID' };
  const captionsId = await lookup(id);
  if (!isArtifactId(captionsId)) return { status: 404, error: 'No captions for this video' };
  return { status: 302, location: artifactPathOf(captionsId) };
}

/**
 * The video id in the route's path (what's after `/pulse/captions`, which the
 * mount strips): `/<id>`, with or without a trailing slash or query. Null for
 * anything else, which the route answers as a bad id.
 */
export function videoIdFromPath(url) {
  if (typeof url !== 'string') return null;
  const path = url.replace(/[?#].*$/s, '');
  const match = path.match(/^\/([^/]+)\/?$/);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}
