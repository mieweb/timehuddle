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
import { MEDIA_DIR, storeMedia } from './uploads';
import { isInsideMeteorBuild } from './storage-paths';

// Same raster set MarkdownContent renders inline (SVG excluded: it can carry markup).
const INLINE_IMAGE = /data:(image\/(?:png|jpe?g|gif|webp|avif));base64,([A-Za-z0-9+/=]+)/gi;

/** True when `text` still carries an inline base64 image. */
export function hasInlineImages(text) {
  return typeof text === 'string' && text.includes('data:image/');
}

/** `text` with every inline base64 image stored as media and linked by path. */
export async function externalizeInlineImages(text, userId) {
  if (!hasInlineImages(text)) return text;
  const replacements = new Map();
  for (const [dataUrl, rawMime, base64] of text.matchAll(INLINE_IMAGE)) {
    if (replacements.has(dataUrl)) continue; // the same image pasted twice → one file
    const mimeType = rawMime.toLowerCase() === 'image/jpg' ? 'image/jpeg' : rawMime.toLowerCase();
    const buffer = Buffer.from(base64, 'base64');
    const doc = await storeMedia({ userId, mimeType, size: buffer.length }, (dest) =>
      fsp.writeFile(dest, buffer),
    );
    replacements.set(dataUrl, doc.url);
  }
  return text.replace(INLINE_IMAGE, (dataUrl) => replacements.get(dataUrl) ?? dataUrl);
}

/**
 * One pass over existing posts. Idempotent: a migrated post no longer matches,
 * so later startups find nothing to do. `updatedAt` is left alone — the post's
 * content didn't change for its readers, only where its image lives.
 *
 * The base64 in the post is the image's only copy, so: never write into a
 * directory a rebuild wipes, and keep each post's original text in
 * `inlineImageBackups` (restorable with a $set of `content.text`).
 */
export async function migrateInlinePostImages() {
  if (isInsideMeteorBuild(MEDIA_DIR)) {
    console.error(`[inline-images] not migrating: ${MEDIA_DIR} is inside Meteor's build output`);
    return;
  }
  const backups = rawDb().collection('inlineImageBackups');
  const posts = rawDb().collection('huddlePosts');
  const cursor = posts.find(
    { 'content.text': { $regex: 'data:image/' } },
    { projection: { userId: 1, 'content.text': 1 } },
  );
  let migrated = 0;
  for await (const post of cursor) {
    try {
      await backups.updateOne(
        { _id: post._id },
        { $setOnInsert: { text: post.content.text, backedUpAt: new Date() } },
        { upsert: true },
      );
      const text = await externalizeInlineImages(post.content.text, post.userId);
      await posts.updateOne({ _id: post._id }, { $set: { 'content.text': text } });
      migrated++;
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
