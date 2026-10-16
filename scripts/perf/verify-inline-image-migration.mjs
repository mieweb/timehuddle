// Verify the inline-image migration (meteor-backend/server/inline-images.js)
// against a LOCAL database: snapshot, let the backend restart and migrate,
// snapshot again, and check nothing but inline images changed.
//
//   node scripts/perf/verify-inline-image-migration.mjs snapshot before.json
//   pm2 restart timehuddle-meteor        # migration runs on startup
//   node scripts/perf/verify-inline-image-migration.mjs check before.json
//
// Never point MONGO_URL at production. Images are compared as BACKEND_URL serves them.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { MongoClient } from '../../meteor-backend/node_modules/mongodb/lib/index.js';

const MONGO_URL = process.env.MONGO_URL ?? 'mongodb://127.0.0.1:27017/timehuddle?replicaSet=rs0';
const BACKEND = process.env.BACKEND_URL ?? 'http://localhost:3100';
// Mirrors meteor-backend/server/inline-images.js: the formats it stores, base64
// possibly wrapped across lines, ending where the link or attribute does, and
// only inside a markdown destination or `src` attribute.
const FORMATS = 'png|jpe?g|gif|webp|avif';
const HAS_INLINE = new RegExp(`data:image/(?:${FORMATS});base64,`, 'i');
const INLINE = new RegExp(
  `(?<=\\]\\(\\s*|\\bsrc\\s*=\\s*["'])data:(image/(?:${FORMATS}));base64,([A-Za-z0-9+/=][A-Za-z0-9+/=\\s]*?)(?=\\s*(?:[)"']|$))`,
  'gi',
);
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
  fs.writeFileSync(
    file,
    JSON.stringify({
      posts: snap,
      media: await db.collection('mediaitems').countDocuments(),
    }),
  );
  console.log(
    `snapshot: ${snap.length} posts, ${snap.filter((p) => HAS_INLINE.test(p.text ?? '')).length} with inline images`,
  );
} else if (mode === 'check') {
  const before = JSON.parse(fs.readFileSync(file, 'utf8'));
  const now = new Map(posts.map((p) => [String(p._id), p]));
  const backups = new Map(
    (await db.collection('inlineImageBackups').find().toArray()).map((b) => [String(b._id), b]),
  );
  const failures = [];
  let untouched = 0,
    leftInline = 0,
    migrated = 0,
    images = 0;
  for (const old of before.posts) {
    const cur = now.get(old.id);
    if (!cur) {
      failures.push(`${old.id}: post missing after migration`);
      continue;
    }
    if (sha(withoutText(cur)) !== old.rest)
      failures.push(`${old.id}: a field other than content.text changed`);
    // The rule: a post either keeps its exact text, or only swaps inline images
    // for files. An image the server can't parse safely (malformed base64, a
    // data URL outside any link) stays inline — that is a pass, not a failure.
    if (cur.content?.text === old.text) {
      if (HAS_INLINE.test(old.text ?? '')) leftInline++;
      else untouched++;
      continue;
    }
    if (!HAS_INLINE.test(old.text ?? '')) {
      failures.push(`${old.id}: text changed on a post with no inline image`);
      continue;
    }
    migrated++;
    if (backups.get(old.id)?.text !== old.text)
      failures.push(`${old.id}: backup missing or differs from original`);
    // Swap each file path back for the data URL it replaced (in order of first
    // appearance, skipping ones that stayed inline): must give the original text.
    const stored = [...new Set([...old.text.matchAll(INLINE)].map((m) => m[0]))].filter(
      (dataUrl) => !cur.content.text.includes(dataUrl),
    );
    const urls = [
      ...new Set(cur.content.text.match(/\/uploads\/media\/[A-Za-z0-9._-]+/g) ?? []),
    ].filter((url) => !old.text.includes(url));
    if (stored.length !== urls.length)
      failures.push(`${old.id}: ${stored.length} images replaced but ${urls.length} file paths`);
    let rebuilt = cur.content.text;
    for (const [i, url] of urls.entries()) {
      const dataUrl = stored[i];
      if (!dataUrl) continue;
      rebuilt = rebuilt.split(url).join(dataUrl);
      // Compare what the backend serves, so this holds wherever its UPLOADS_DIR is.
      const original = Buffer.from(dataUrl.split(',')[1].replace(/\s+/g, ''), 'base64');
      const res = await fetch(`${BACKEND}${url}`);
      const served = Buffer.from(await res.arrayBuffer());
      if (res.status !== 200) failures.push(`${old.id}: ${url} served ${res.status}`);
      else if (!res.headers.get('content-type')?.startsWith('image/'))
        failures.push(`${old.id}: ${url} served as ${res.headers.get('content-type')}`);
      else if (!served.equals(original))
        failures.push(`${old.id}: ${url} differs from the original image bytes`);
      images++;
    }
    if (rebuilt !== old.text) failures.push(`${old.id}: text changed beyond the image swap`);
  }
  const media = await db.collection('mediaitems').countDocuments();
  console.log(
    JSON.stringify({
      postsChecked: before.posts.length,
      untouched,
      leftInline,
      migrated,
      imagesVerified: images,
      newMediaItems: media - before.media,
      failures: failures.length,
    }),
  );
  for (const f of failures.slice(0, 20)) console.log('FAIL', f);
  process.exitCode = failures.length ? 1 : 0;
} else {
  console.log('usage: verify-inline-image-migration.mjs snapshot|check <file>');
  process.exitCode = 2;
}
await client.close();
