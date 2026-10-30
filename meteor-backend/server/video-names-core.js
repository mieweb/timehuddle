/**
 * The rules for a video's name, with no Meteor or database (see video-names.js
 * for where names are kept and looked up): which URLs are videos, how a name
 * is cleaned before it's stored, and that the old `Video 1a2b3c4d` titles are
 * placeholders, not names.
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
