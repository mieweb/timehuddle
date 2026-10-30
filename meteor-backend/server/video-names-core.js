/**
 * The rules for a video's name, with no Meteor or database (see video-names.js
 * for where names are kept and looked up): which URLs are videos, how a name
 * is cleaned before it's stored, that the old `Video 1a2b3c4d` titles are
 * placeholders, not names, who may rename a video, and what its public page
 * may show.
 */

/** A Pulse video's playback path, the only URL a video is stored under. */
const ARTIFACT_PATH = /^\/pulsevault\/artifacts\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
/** What every video was titled before videos kept a name: a placeholder, not a name. */
const PLACEHOLDER = /^Video [0-9a-f]{8}$/i;
/** Longest name kept. */
export const VIDEO_NAME_MAX = 120;

/** The video id in a `/pulsevault/artifacts/<id>` path, else null. */
export function videoIdOf(url) {
  const match = typeof url === 'string' ? url.match(ARTIFACT_PATH) : null;
  return match ? match[1].toLowerCase() : null;
}

/** A name as stored: trimmed, one line, at most VIDEO_NAME_MAX characters; null for none. */
export function cleanVideoName(name) {
  if (typeof name !== 'string') return null;
  const clean = name.replace(/\s+/g, ' ').trim().slice(0, VIDEO_NAME_MAX).trim();
  return clean || null;
}

/** A stored title as a name: null for none, and for the old placeholder. */
export function videoNameOf(title) {
  const name = cleanVideoName(title);
  return name && !PLACEHOLDER.test(name) ? name : null;
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
    name: videoNameOf(item?.title),
    addedAt: item?.uploadedAt ?? null,
    author: signedIn && owner ? { name: owner.profile?.name ?? null, image: owner.image ?? null } : null,
    canRename: signedIn && canRename === true,
  };
}
