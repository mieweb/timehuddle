/**
 * Inline images in post markdown → uploaded media.
 *
 * Before paste-to-upload (cca7b9da), the Kerebron editor saved a pasted image
 * as a base64 `data:` URL inside the post text. Each one made the post hundreds
 * of KB, and every feed read (REST and the live publication) shipped those
 * bytes for every post in the window — a 70-post team feed reached ~12 MB.
 *
 * `externalizeInlineImages` writes each inline image to /uploads/media (the
 * same store as /api/media/upload) and replaces the data URL with the file's
 * path, which MarkdownContent re-bases onto the backend. Posts are run through
 * it on create/update, and existing posts once at startup.
 */
import { Meteor } from 'meteor/meteor';
import fsp from 'fs/promises';
import { rawDb } from './collections';
import { MEDIA_DIR, discardMedia, storeMedia } from './uploads';
import { isInsideMeteorBuild } from './storage-paths';

// Same raster set MarkdownContent renders inline. Anything else (SVG, which can
// carry markup; HEIC, BMP, TIFF, which browsers don't show inline) is left as is.
const FORMATS = 'png|jpe?g|gif|webp|avif';
const HAS_INLINE_IMAGE = new RegExp(`data:image/(?:${FORMATS});base64,`, 'i');
// The base64 may be wrapped across lines. It ends where the markdown link or
// HTML attribute holding it does (or at the end of the text), so the words
// after an image are never taken for more base64.
const INLINE_IMAGE = new RegExp(
  `data:(image/(?:${FORMATS}));base64,([A-Za-z0-9+/=][A-Za-z0-9+/=\\s]*?)(?=\\s*(?:[)"']|$))`,
  'gi',
);

/** True when `text` carries an inline base64 image this module can store. */
export function hasInlineImages(text) {
  return typeof text === 'string' && HAS_INLINE_IMAGE.test(text);
}

/** The image bytes, or null when `base64` doesn't decode cleanly (left inline). */
function decode(base64) {
  const clean = base64.replace(/\s+/g, '');
  const buffer = Buffer.from(clean, 'base64');
  const roundTrip = buffer.toString('base64').replace(/=+$/, '');
  return buffer.length && roundTrip === clean.replace(/=+$/, '') ? buffer : null;
}

/** `text` with every inline base64 image stored as media and linked by path. */
export async function externalizeInlineImages(text, userId) {
  return (await externalize(text, userId)).text;
}

/** The rewritten text, and the media documents stored for it. */
async function externalize(text, userId) {
  if (!hasInlineImages(text)) return { text, media: [] };
  const replacements = new Map();
  const media = [];
  for (const [dataUrl, rawMime, base64] of text.matchAll(INLINE_IMAGE)) {
    if (replacements.has(dataUrl)) continue; // the same image pasted twice → one file
    const buffer = decode(base64);
    if (!buffer) continue;
    const mime = rawMime.toLowerCase();
    const mimeType = mime === 'image/jpg' ? 'image/jpeg' : mime;
    const doc = await storeMedia({ userId, mimeType, size: buffer.length }, (dest) =>
      fsp.writeFile(dest, buffer),
    );
    replacements.set(dataUrl, doc.url);
    media.push(doc);
  }
  return {
    text: text.replace(INLINE_IMAGE, (dataUrl) => replacements.get(dataUrl) ?? dataUrl),
    media,
  };
}

const MIGRATE_ATTEMPTS = 3;

/**
 * Migrate one post. The write is a compare-and-swap on the text it read: the
 * migration runs while the app is serving, and a plain write would overwrite
 * an edit saved in between with the older text. When the text has moved on,
 * the files made for the old text are discarded and the post is read again.
 * Returns true when the post was rewritten.
 */
async function migratePost(posts, backups, post) {
  let current = post;
  for (let attempt = 0; attempt < MIGRATE_ATTEMPTS && current; attempt++) {
    const original = current.content?.text;
    const { text, media } = await externalize(original, current.userId);
    // Nothing that could be stored (an image that doesn't decode stays inline).
    if (text === original) return false;
    // The text this write replaces — kept before the post changes.
    await backups.updateOne(
      { _id: current._id },
      { $set: { text: original, backedUpAt: new Date() } },
      { upsert: true },
    );
    const { matchedCount } = await posts.updateOne(
      { _id: current._id, 'content.text': original },
      { $set: { 'content.text': text } },
    );
    if (matchedCount) return true;
    await discardMedia(media);
    current = await posts.findOne(
      { _id: current._id },
      { projection: { userId: 1, 'content.text': 1 } },
    );
  }
  if (current) console.warn(`[inline-images] post ${post._id} kept changing; left for next start`);
  return false;
}

/**
 * One pass over existing posts. Idempotent: a migrated post no longer matches,
 * so later startups find nothing to do. `updatedAt` is left alone — the post's
 * content didn't change for its readers, only where its image lives.
 *
 * The base64 in the post is the image's only copy, so: never write into a
 * directory a rebuild wipes, keep the text each write replaced in
 * `inlineImageBackups` (restorable with a $set of `content.text`), and never
 * write over an edit made while the migration ran (see migratePost).
 */
export async function migrateInlinePostImages() {
  if (isInsideMeteorBuild(MEDIA_DIR)) {
    console.error(`[inline-images] not migrating: ${MEDIA_DIR} is inside Meteor's build output`);
    return;
  }
  const backups = rawDb().collection('inlineImageBackups');
  const posts = rawDb().collection('huddlePosts');
  const cursor = posts.find(
    { 'content.text': { $regex: HAS_INLINE_IMAGE.source, $options: 'i' } },
    { projection: { userId: 1, 'content.text': 1 } },
  );
  let migrated = 0;
  for await (const post of cursor) {
    try {
      if (await migratePost(posts, backups, post)) migrated++;
    } catch (err) {
      console.error(`[inline-images] post ${post._id} not migrated:`, err);
    }
  }
  if (migrated) console.log(`[inline-images] moved inline images out of ${migrated} posts`);
}

Meteor.startup(() => {
  // In the background: a large backlog must not hold up the server starting.
  migrateInlinePostImages().catch((err) => console.error('[inline-images] migration failed:', err));
});
