// Verify the inline-image migration (meteor-backend/server/inline-images.js)
// against a LOCAL database: snapshot, let the backend restart and migrate,
// snapshot again, and check nothing but inline images changed.
//
//   node scripts/perf/verify-inline-image-migration.mjs snapshot before.json
//   pm2 restart timehuddle-meteor        # migration runs on startup
//   node scripts/perf/verify-inline-image-migration.mjs check before.json
//
// Never point MONGO_URL at production.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from '../../meteor-backend/node_modules/mongodb/lib/index.js';

const MONGO_URL = process.env.MONGO_URL ?? 'mongodb://127.0.0.1:27017/timehuddle?replicaSet=rs0';
const BACKEND = process.env.BACKEND_URL ?? 'http://localhost:3100';
const UPLOADS_DIR = process.env.UPLOADS_DIR ?? path.resolve('uploads');
const INLINE = /data:(image\/(?:png|jpe?g|gif|webp|avif));base64,([A-Za-z0-9+/=]+)/gi;
const [mode, file] = process.argv.slice(2);

const sha = (v) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const withoutText = (p) => ({ ...p, content: { ...p.content, text: undefined } });

const client = await MongoClient.connect(MONGO_URL);
const db = client.db();
const posts = await db.collection('huddlePosts').find().toArray();

if (mode === 'snapshot') {
  const snap = posts.map((p) => ({
    id: String(p._id),
    rest: sha(withoutText(p)),
    text: p.content?.text ?? null,
  }));
  fs.writeFileSync(file, JSON.stringify({
    posts: snap,
    media: await db.collection('mediaitems').countDocuments(),
  }));
  console.log(`snapshot: ${snap.length} posts, ${snap.filter((p) => p.text?.includes('data:image/')).length} with inline images`);
} else if (mode === 'check') {
  const before = JSON.parse(fs.readFileSync(file, 'utf8'));
  const now = new Map(posts.map((p) => [String(p._id), p]));
  const backups = new Map(
    (await db.collection('inlineImageBackups').find().toArray()).map((b) => [String(b._id), b]),
  );
  const failures = [];
  let untouched = 0, migrated = 0, images = 0;
  for (const old of before.posts) {
    const cur = now.get(old.id);
    if (!cur) { failures.push(`${old.id}: post missing after migration`); continue; }
    if (sha(withoutText(cur)) !== old.rest) failures.push(`${old.id}: a field other than content.text changed`);
    const hadInline = old.text?.includes('data:image/');
    if (!hadInline) {
      if (cur.content?.text !== old.text) failures.push(`${old.id}: text changed on a post with no inline image`);
      else untouched++;
      continue;
    }
    migrated++;
    if (cur.content.text.includes('data:image/')) failures.push(`${old.id}: still has an inline image`);
    if (backups.get(old.id)?.text !== old.text) failures.push(`${old.id}: backup missing or differs from original`);
    // Swap each file path back for its original data URL: must give the original text.
    const originals = [...old.text.matchAll(INLINE)];
    const urls = cur.content.text.match(/\/uploads\/media\/[A-Za-z0-9._-]+/g) ?? [];
    const uniqueOriginals = [...new Set(originals.map((m) => m[0]))];
    let rebuilt = cur.content.text;
    for (const [i, dataUrl] of uniqueOriginals.entries()) {
      const url = [...new Set(urls)][i];
      if (!url) { failures.push(`${old.id}: image ${i} has no file path`); continue; }
      rebuilt = rebuilt.split(url).join(dataUrl);
      const onDisk = fs.readFileSync(path.join(UPLOADS_DIR, 'media', path.basename(url)));
      const original = Buffer.from(dataUrl.split(',')[1], 'base64');
      if (!onDisk.equals(original)) failures.push(`${old.id}: ${url} differs from the original image bytes`);
      const res = await fetch(`${BACKEND}${url}`);
      if (res.status !== 200) failures.push(`${old.id}: ${url} served ${res.status}`);
      else if (!res.headers.get('content-type')?.startsWith('image/')) failures.push(`${old.id}: ${url} served as ${res.headers.get('content-type')}`);
      images++;
    }
    if (rebuilt !== old.text) failures.push(`${old.id}: text changed beyond the image swap`);
  }
  const media = await db.collection('mediaitems').countDocuments();
  console.log(JSON.stringify({
    postsChecked: before.posts.length, untouched, migrated, imagesVerified: images,
    newMediaItems: media - before.media, failures: failures.length,
  }));
  for (const f of failures.slice(0, 20)) console.log('FAIL', f);
  process.exitCode = failures.length ? 1 : 0;
} else {
  console.log('usage: verify-inline-image-migration.mjs snapshot|check <file>');
  process.exitCode = 2;
}
await client.close();
