/**
 * Which attachments a Huddle post may carry, with no Meteor or database (see
 * huddle.js for where it applies). A post takes the poster's own uploads and
 * Pulse videos (whose playback is public, and a post may carry a ticket's), or
 * one it already carries — never just any URL a client sends, which would let
 * a post show someone else's file as the poster's. Each is stored from what
 * the server knows about it, its size included, rather than from the client.
 */

const ATTACHMENT_TYPES = new Set(['image', 'video', 'file']);

/** The path of a media URL (absolute or not), to compare two of them. */
function pathOf(url) {
  if (typeof url !== 'string' || !url) return null;
  try {
    return new URL(url, 'http://placeholder.invalid').pathname;
  } catch {
    return null;
  }
}

/** What kind of attachment a stored media item is, from its MIME type. */
function typeOf(item) {
  const mime = typeof item.mimeType === 'string' ? item.mimeType : '';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  return 'file';
}

/**
 * An image's size as the client measured it before upload, kept as given: a
 * display hint (its tile keeps its space before it loads), so only checked to
 * be sane, positive whole pixels.
 */
function sizeOf(att) {
  const ok = (n) => Number.isInteger(n) && n > 0 && n <= 100_000;
  return ok(att.width) && ok(att.height) ? { width: att.width, height: att.height } : {};
}

/** A refused attachment list; huddle.js reports it as a bad request. */
export class AttachmentError extends Error {}

/**
 * `attachments` as a post stores them, each checked (`null` is none: an edit
 * that clears the list, which then cleans up after it as `[]` does):
 * - one the post already carries (`existing`, kept as it is by an edit);
 * - a Pulse video (`pulseVideoOf(url)` is its id);
 * - else the poster's (`userId`) own upload: its media item (`mediaById`, by
 *   id) belongs to them and is at that URL. It's stored with the item's URL,
 *   type, name and size.
 * Throws an AttachmentError for anything else.
 */
export function cleanPostAttachments({ attachments, userId, mediaById, pulseVideoOf, existing = [] }) {
  if (attachments === null) return [];
  if (!Array.isArray(attachments)) throw new AttachmentError('attachments must be a list');
  const kept = new Map(existing.map((att) => [pathOf(att.url), att]));
  return attachments.map((att) => {
    const path = pathOf(att?.url);
    if (!path || !ATTACHMENT_TYPES.has(att.type)) throw new AttachmentError('Invalid attachment');
    if (kept.has(path)) return kept.get(path);
    const video = pulseVideoOf(att.url);
    if (video) {
      return {
        mediaId: String(att.mediaId ?? video),
        type: 'video',
        url: `/pulsevault/artifacts/${video}`,
        ...(typeof att.filename === 'string' ? { filename: att.filename } : {}),
      };
    }
    const item = mediaById.get(String(att.mediaId));
    if (!item || item.userId !== userId || pathOf(item.url) !== path) {
      throw new AttachmentError('Attachments must be your own uploads');
    }
    const filename = item.title ?? item.filename;
    return {
      mediaId: String(att.mediaId),
      type: typeOf(item),
      url: item.url,
      ...(filename ? { filename } : {}),
      ...(typeof item.size === 'number' ? { size: item.size } : {}),
      ...sizeOf(att),
    };
  });
}
