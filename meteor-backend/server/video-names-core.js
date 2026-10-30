/**
 * The rules for a video's name, with no Meteor or database (see video-names.js
 * for where names are kept and looked up): which URLs are videos, how a name
 * is cleaned before it's stored, that the old `Video 1a2b3c4d` titles (the
 * start of the video's own id) are placeholders, not names, who may rename a
 * video, and what its public page may show.
 */

/** A Pulse video's playback path. */
const ARTIFACT_PATH = /^\/pulsevault\/artifacts\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
/** Longest name kept. */
export const VIDEO_NAME_MAX = 120;

/**
 * Which media item is a video's where old data has more than one (the unique
 * index can't be built over them): the oldest, the same one for every read,
 * ownership check and write. Spread into a find's options.
 */
export const CANONICAL_ITEM = { sort: { _id: 1 } };

/**
 * The video id in a `/pulsevault/artifacts/<id>` path, else null. A full URL
 * counts only on one of `trustedOrigins` (this backend's own): a video on
 * another site is not this backend's video.
 */
export function videoIdOf(url, trustedOrigins = []) {
  if (typeof url !== 'string') return null;
  let path = url;
  if (/^https?:\/\//i.test(url)) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    if (!trustedOrigins.includes(parsed.origin)) return null;
    path = parsed.pathname;
  }
  const match = path.match(ARTIFACT_PATH);
  return match ? match[1].toLowerCase() : null;
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
