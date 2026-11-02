/**
 * The rules for a video's name, with no Meteor or database (see video-names.js
 * for where names are kept and looked up): which URLs are videos, how a name
 * is cleaned before it's stored, that the old `Video 1a2b3c4d` titles (the
 * start of the video's own id) are placeholders, not names, who may rename a
 * video, and what its public page may show.
 */

/** A Pulse video's playback path, with or without a trailing slash. */
const ARTIFACT_PATH = /^\/pulsevault\/artifacts\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i;
/** Longest name kept. */
export const VIDEO_NAME_MAX = 120;

/**
 * Which media item is a video's where old data has more than one (the unique
 * index can't be built over them): the oldest, the same one for every read,
 * ownership check and write. Spread into a find's options.
 */
export const CANONICAL_ITEM = { sort: { _id: 1 } };

/**
 * The video id in a `/pulsevault/artifacts/<id>` path, else null; a query or
 * fragment (`?t=1`) is the same video. A full URL counts only on one of
 * `trustedOrigins`, or on any host with {@link ANY_ORIGIN}.
 */
/** For `videoIdOf`: a full URL's host doesn't matter. */
export const ANY_ORIGIN = '*';

export function videoIdOf(url, trustedOrigins = []) {
  if (typeof url !== 'string') return null;
  let path = url.replace(/[?#].*$/s, '');
  if (/^https?:\/\//i.test(url)) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    if (!trustedOrigins.includes(ANY_ORIGIN) && !trustedOrigins.includes(parsed.origin)) return null;
    path = parsed.pathname;
  }
  const match = path.match(ARTIFACT_PATH);
  return match ? match[1].toLowerCase() : null;
}

/**
 * A video's size from PulseVault's status (videoArtifactStatus): the upload's
 * whole length, known from its start, or null — never the bytes received so
 * far, which a rename mid-upload would keep as the video's size.
 */
export function videoSizeOf(status) {
  return typeof status?.size === 'number' ? status.size : null;
}

/** A name as stored: trimmed, one line, at most VIDEO_NAME_MAX characters; null for none. */
export function cleanVideoName(name) {
  if (typeof name !== 'string') return null;
  const clean = name.replace(/\s+/g, ' ').trim().slice(0, VIDEO_NAME_MAX).trim();
  return clean || null;
}

/**
 * A stored title as a name: null for none, and for the placeholder every video
 * was titled before videos kept a name, `Video ` and the start of its own id.
 * Only that exact title is one: `Video 20261029` from a file is a real name.
 */
export function videoNameOf(title, videoId) {
  const name = cleanVideoName(title);
  if (!name) return null;
  const placeholder = typeof videoId === 'string' ? `Video ${videoId.slice(0, 8)}` : null;
  return placeholder && name.toLowerCase() === placeholder.toLowerCase() ? null : name;
}

/**
 * The name a listed media item shows for its video: the one in `names`
 * (videoNamesFor, the CANONICAL_ITEM's), so a duplicate row from old data
 * shows what a rename named the video, not its own stale title; else its own.
 */
export function listedVideoName(item, names) {
  return names.has(item.videoid) ? names.get(item.videoid).name : videoNameOf(item.title, item.videoid);
}

/**
 * Who uploaded a video by PulseVault's own record of it (its status, with the
 * capability token's context), or null: only a video's, and only once bytes
 * arrived — a reservation never used is no one's upload.
 */
export function uploaderOf(status) {
  if (status?.kind !== 'video' || typeof status.context?.userId !== 'string') return null;
  const arrived = status.state === 'ready' || status.state === 'processing' || (status.bytesReceived ?? 0) > 0;
  return arrived ? status.context.userId : null;
}

/**
 * Whether `userId` may name a video: its media item's owner, or — for a video
 * from before every video had a media item — whoever PulseVault's own record
 * says uploaded it (`uploadedByUser`), never someone who only attached it.
 */
export function mayRenameVideo({ item, userId, uploadedByUser = false }) {
  if (!userId) return false;
  return item ? item.userId === userId : uploadedByUser === true;
}

/**
 * What a video's public page (`videos.publicInfo`) may show: its name and when
 * it was added, to anyone with the link; who added it only to someone signed in
 * (`viewerId`), since a link can travel outside the team.
 */
export function publicVideoInfo({ id, item, viewerId, owner, canRename = false }) {
  const signedIn = Boolean(viewerId);
  return {
    videoId: id,
    name: videoNameOf(item?.title, id),
    addedAt: item?.uploadedAt ?? null,
    author: signedIn && owner ? { name: owner.profile?.name ?? null, image: owner.image ?? null } : null,
    canRename: signedIn && canRename === true,
  };
}
