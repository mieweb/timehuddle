/**
 * Which attachments a Huddle post may carry, with no Meteor or database (see
 * huddle.js for where it applies). A post takes the poster's own uploads and
 * Pulse videos (whose playback is public, and a post may carry a ticket's), or
 * one it already carries — never just any URL a client sends, which would let
 * a post show someone else's file as the poster's. Each is stored from what
 * the server knows about it, its size included, rather than from the client.
 * Also where an upload a post drops may still be in use, and how it goes once
 * nothing uses it.
 */

import { uploadUrlsIn } from './media-library-core.js';

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
 * - a Pulse video (`pulseVideoOf(url)` is its id, and its `mediaId`);
 * - else the poster's (`userId`) own upload: its media item (`mediaById`, by
 *   id) belongs to them and is at that URL. It's stored with the item's URL,
 *   type, name and size.
 * Throws an AttachmentError for anything else.
 * @param {{
 *   attachments: any,
 *   userId: any,
 *   mediaById: any,
 *   pulseVideoOf: any,
 *   existing?: any[],
 * }} params
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
        // Its own id, never the client's: another user's item id here would
        // read as that item carried by a post, hiding it from its owner.
        mediaId: video,
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

/** `text` as a regular expression matching it literally. */
const literally = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Where an upload (`mediaId`, at `url`) may still be in use, as `{ collection,
 * filter }` queries; any match keeps its file. A Huddle post carrying it or
 * showing it in its text; an attachment (a ticket's, a session's) at its URL;
 * a ticket description linking or embedding it, which is Markdown kept apart
 * from the attachments.
 */
export function uploadUseQueries({ mediaId, url }) {
  // A query or fragment (`#page=2`) is the same upload.
  const atUrl = new RegExp(`${literally(url)}(?:[?#].*)?$`);
  return [
    {
      collection: 'huddlePosts',
      filter: {
        $or: [
          { 'attachments.mediaId': mediaId },
          { 'attachments.url': atUrl },
          { 'content.text': { $regex: literally(url) } },
        ],
      },
    },
    { collection: 'attachments', filter: { url: atUrl } },
    { collection: 'tickets', filter: { description: { $regex: literally(url) } } },
  ];
}

/**
 * How long an upload a post dropped waits before the sweep may delete it. A
 * post that checked it just before it was dropped has long been written by
 * then, so the sweep's own look at what uses it (uploadUseQueries) sees that post.
 */
export const DISCARD_GRACE_MS = 5 * 60_000;

/** The update marking dropped uploads nothing uses to go once the grace period is over. */
export function discardMark(now) {
  return { $set: { discardAt: new Date(now.getTime() + DISCARD_GRACE_MS) } };
}

/**
 * Mark the `items` nothing uses (`isUsed(item)` runs uploadUseQueries) to go
 * once the grace period from `now` is over: `mark(ids, update)` applies
 * discardMark to their ids. Deletes nothing itself; sweepDiscardedUploads
 * does, once they're due and still unused.
 */
export async function markUnusedUploads(items, now, { isUsed, mark }) {
  const unused = [];
  for (const item of items) if (!(await isUsed(item))) unused.push(item._id);
  if (unused.length) await mark(unused, discardMark(now));
}

/** The uploads whose grace period is over, for the sweep. */
export function dueDiscards(now) {
  return { discardAt: { $lte: now } };
}

/**
 * The update a post runs on the poster's own items (`objectIds`) before it
 * checks them, so a discard can't take one it is about to carry: with the mark
 * gone first, the sweep's conditional delete leaves the item alone, and an
 * item the sweep already deleted fails the check.
 */
export function keepForPost({ objectIds, userId }) {
  return {
    filter: { _id: { $in: objectIds }, userId, discardAt: { $exists: true } },
    update: { $unset: { discardAt: '' } },
  };
}

/**
 * The update a ticket's or session's attachment, or a ticket's description,
 * runs before it is saved, on the uploads it references (`texts`: URLs, full
 * or not, or Markdown; uploadUrlsIn reads their paths, which is how a media
 * item stores its `url`): as keepForPost does for a post, the mark goes first,
 * so the sweep's conditional delete leaves them alone. Anyone's uploads, as
 * uploadUseQueries counts anyone's reference. Null when none is an upload.
 */
export function keepForReference(texts) {
  const urls = [...new Set(texts.flatMap(uploadUrlsIn))];
  if (!urls.length) return null;
  return {
    filter: { url: { $in: urls }, discardAt: { $exists: true } },
    update: { $unset: { discardAt: '' } },
  };
}

/**
 * One pass over `due` items (dueDiscards at `now`), with the database and
 * files passed in: `isUsed(item)` runs uploadUseQueries; `keep(filter)`
 * clears the mark of an item in use after all, only the mark it was read with
 * (a later drop's mark stays); `deleteRow(filter)` deletes one row and
 * resolves to how many it deleted; `removeFile(item)` removes its file. The
 * delete holds only while the item is still marked and due, so a post that
 * took it meanwhile keeps it, and a file goes only with its row.
 */
export async function sweepDiscardedUploads(due, now, { isUsed, keep, deleteRow, removeFile }) {
  for (const item of due) {
    if (await isUsed(item)) {
      await keep({ _id: item._id, discardAt: item.discardAt });
      continue;
    }
    if (await deleteRow({ _id: item._id, discardAt: { $lte: now } })) await removeFile(item);
  }
}
