import { WebApp } from 'meteor/webapp';
import { MongoInternals } from 'meteor/mongo';
import { rawDb, isValidId } from './collections';
import { resolveToken, requireIdentity } from './auth-bridge';
import { requireProfileAccess } from './profile-access';
import { artifactIsEvidenceUnderReview } from './timesheet-change-requests';
// The backend's videoIdOf: a legacy post's full URL counts, whatever its host.
import { CANONICAL_ITEM, cleanVideoName, listedVideoName, titleRowOf, videoIdOf, videoNamesFor } from './video-names.js';
import { excludingPostMedia, mediaRefsOf, uploadUrlsIn } from './media-library-core.js';
import { keepForReference } from './post-attachments-core.js';
import { randomBytes } from 'crypto';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import Busboy from 'busboy';
import { persistentDir, isInsideMeteorBuild } from './storage-paths';

const { ObjectId } = MongoInternals.NpmModules.mongodb.module;

// Outside Meteor's build output, which a rebuild wipes — see storage-paths.js.
const UPLOADS_DIR = persistentDir(process.env.UPLOADS_DIR, 'uploads');
const PROFILE_DIR = path.join(UPLOADS_DIR, 'profile');
export const MEDIA_DIR = path.join(UPLOADS_DIR, 'media');
const THUMBNAILS_DIR = path.join(UPLOADS_DIR, 'thumbnails');
const VIDEOS_DIR = persistentDir(process.env.VIDEOS_DIR, 'data/videos');
if (isInsideMeteorBuild(UPLOADS_DIR)) {
  console.warn(`[uploads] UPLOADS_DIR ${UPLOADS_DIR} is inside Meteor's build output — a rebuild deletes it`);
}

// Incoming files land here first, then get renamed into place. Same volume as
// the destinations, so the rename is atomic and free. Never served: the
// /uploads handler refuses this prefix.
const TMP_DIR = path.join(UPLOADS_DIR, 'tmp');

// Uploads stream straight to disk, so peak memory is one chunk regardless of
// file size and this cap is about storage policy rather than heap safety.
// Videos recorded in-app bypass this entirely via PulseVault's TUS endpoint.
const MAX_FILE_MB = Number(process.env.MAX_UPLOAD_MB) || 100;
const MAX_FILE_SIZE = MAX_FILE_MB * 1024 * 1024;

const MIME_TO_EXT = {
  // Images
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
  // Videos
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'video/avi': 'avi',
  // Documents
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'text/plain': 'txt',
  'text/csv': 'csv',
};

const CORS_ORIGINS = (process.env.CORS_ORIGINS || 'http://localhost:3000').split(',').map((s) => s.trim());

// Native mobile app WebView origins (Capacitor iOS / Android, legacy Ionic).
// These are the app's own bundled WebView, so they are always safe to allow.
const NATIVE_APP_ORIGINS = new Set([
  'capacitor://localhost',
  'https://localhost',
  'ionic://localhost',
]);

function setCors(req, res) {
  const origin = req.headers.origin;
  if (origin && (CORS_ORIGINS.includes(origin) || NATIVE_APP_ORIGINS.has(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }
}

async function authenticateRequest(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  return resolveToken(token);
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

/**
 * Stream the request's single multipart file to a temp file.
 *
 * Streaming rather than collecting chunks into a Buffer is what makes a large
 * MAX_FILE_SIZE safe — a 100 MB upload costs one chunk of heap, not 100 MB,
 * and concurrent uploads no longer multiply that.
 *
 * Resolves with `{ path, size, filename, mimeType }`; the caller owns the temp
 * file and is expected to rename it into place. On any failure the temp file is
 * removed before rejecting.
 */
async function parseMultipart(req, allowedMimes) {
  await fsp.mkdir(TMP_DIR, { recursive: true });
  const tmpPath = path.join(TMP_DIR, `${randomBytes(12).toString('hex')}.part`);

  return new Promise((resolve, reject) => {
    // Browsers send the file's name as UTF-8; Busboy reads it as Latin-1
    // unless told, which turns "—" or "é" in a document's name into "â€”".
    const busboy = Busboy({
      headers: req.headers,
      defParamCharset: 'utf8',
      limits: { fileSize: MAX_FILE_SIZE, files: 1 },
    });

    let fileInfo = null;
    let size = 0;
    let error = null;
    let written = Promise.resolve();

    const fail = (message, status = 400) => {
      if (error) return;
      error = new Error(message);
      error.statusCode = status;
    };

    busboy.on('file', (_fieldname, stream, info) => {
      if (!allowedMimes.includes(info.mimeType)) {
        stream.resume();
        fail('Unsupported file type');
        return;
      }
      fileInfo = info;

      const out = fs.createWriteStream(tmpPath);
      written = new Promise((done) => {
        out.on('close', done);
        out.on('error', (err) => {
          fail(err.message);
          done();
        });
      });

      stream.on('data', (chunk) => {
        size += chunk.length;
      });
      // Busboy truncates at the size limit rather than failing, so without this
      // an oversized upload is stored silently corrupt. Tearing the write
      // stream down by hand matters too: a truncated file stream never ends on
      // its own, so the pipe — and the request with it — would hang forever.
      stream.on('limit', () => {
        fail(`File is larger than ${MAX_FILE_MB} MB`, 413);
        stream.unpipe(out);
        out.destroy();
        stream.resume();
      });
      stream.on('error', (err) => fail(err.message));
      stream.pipe(out);
    });

    busboy.on('error', (err) => fail(err.message));

    busboy.on('close', async () => {
      await written;
      if (!fileInfo) fail('No file uploaded');
      if (error) {
        unlinkSafe(tmpPath);
        reject(error);
        return;
      }
      resolve({ path: tmpPath, size, filename: fileInfo.filename, mimeType: fileInfo.mimeType });
    });

    req.pipe(busboy);
  });
}

function unlinkSafe(filePath) {
  if (filePath) fs.unlink(filePath, () => {});
}

function resolveUploadPath(url, prefix, baseDir) {
  if (!url || !url.startsWith(prefix)) return null;
  const safeName = path.basename(url.slice(prefix.length));
  if (!safeName) return null;
  return path.join(baseDir, safeName);
}

// ── Static file serving (/uploads/*) ──────────────────────────────────────────

WebApp.connectHandlers.use('/uploads', (req, res, next) => {
  setCors(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (req.method !== 'GET' && req.method !== 'HEAD') { next(); return; }

  const safePath = path.normalize(req.url).replace(/^(\.\.(\/|\\|$))+/, '');
  const filePath = path.join(UPLOADS_DIR, safePath);

  // In-flight uploads live under tmp/ until they're renamed into place.
  if (!filePath.startsWith(UPLOADS_DIR) || filePath.startsWith(TMP_DIR)) {
    res.writeHead(403);
    res.end();
    return;
  }

  // Check if file exists and get stats
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch (err) {
    res.writeHead(404);
    res.end();
    return;
  }

  const fileSize = stat.size;
  const range = req.headers['range'];

  // Determine content type
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
    '.avi': 'video/x-msvideo', '.png': 'image/png', '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
    '.avif': 'image/avif', '.pdf': 'application/pdf',
  };
  const contentType = mimeTypes[ext] || 'application/octet-stream';
  // Links are unguessable (a random name) but not signed, so nothing shared
  // may keep a copy: browsers only. A picture or clip may stay a day in the
  // viewer's own cache; a document isn't kept at all.
  const media = contentType.startsWith('image/') || contentType.startsWith('video/');
  const headers = {
    'Accept-Ranges': 'bytes',
    'Content-Type': contentType,
    'Cache-Control': media ? 'private, max-age=86400' : 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  };

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunkSize = (end - start) + 1;
    res.writeHead(206, {
      ...headers,
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Content-Length': chunkSize,
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { ...headers, 'Content-Length': fileSize });
    fs.createReadStream(filePath).pipe(res);
  }
});

// ── Avatar upload/delete (/api/me/avatar) ─────────────────────────────────────

// ── Account deletion (/api/me/account) ───────────────────────────────────────

WebApp.connectHandlers.use('/api/me/account', async (req, res, next) => {
  setCors(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const identity = await authenticateRequest(req);
  if (!identity) return sendJson(res, 401, { error: 'Unauthorized' });

  if (req.method === 'DELETE') {
    const db = rawDb();
    const userId = identity.userId;
    // Remove user from teams, orgs, and profiles, then delete the account.
    await db.collection('team_members').deleteMany({ userId });
    await db.collection('org_members').deleteMany({ userId });
    await db.collection('profiles').deleteMany({ userId, app: 'timeharbor' });
    await Meteor.users.removeAsync({ _id: userId });
    return sendJson(res, 200, { ok: true });
  }

  next();
});

WebApp.connectHandlers.use('/api/me/avatar', async (req, res, next) => {
  setCors(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const identity = await authenticateRequest(req);
  if (!identity) return sendJson(res, 401, { error: 'Unauthorized' });

  if (req.method === 'POST') {
    let file;
    try {
      file = await parseMultipart(req, ['image/png', 'image/jpeg']);
      if (file.size === 0) throw new Error('Empty file');

      await fsp.mkdir(PROFILE_DIR, { recursive: true });
      const ext = file.mimeType === 'image/png' ? 'png' : 'jpg';
      const hex = randomBytes(8).toString('hex');
      const filename = `${identity.userId}-${hex}_avatar.${ext}`;
      const filepath = path.join(PROFILE_DIR, filename);

      const db = rawDb();
      const existing = await db.collection('profiles').findOne({ userId: identity.userId, app: 'timeharbor' });
      unlinkSafe(resolveUploadPath(existing?.avatarUrl, '/uploads/profile/', PROFILE_DIR));

      await fsp.rename(file.path, filepath);
      const avatarUrl = `/uploads/profile/${filename}`;

      await db.collection('profiles').updateOne(
        { userId: identity.userId, app: 'timeharbor' },
        { $set: { avatarUrl, updatedAt: new Date() }, $setOnInsert: { userId: identity.userId, app: 'timeharbor', displayName: identity.name, status: 'online', createdAt: new Date() } },
        { upsert: true },
      );
      return sendJson(res, 200, { avatarUrl });
    } catch (err) {
      unlinkSafe(file?.path);
      return sendJson(res, err.statusCode ?? 400, { error: err.message });
    }
  }

  if (req.method === 'DELETE') {
    const db = rawDb();
    const existing = await db.collection('profiles').findOne({ userId: identity.userId, app: 'timeharbor' });
    unlinkSafe(resolveUploadPath(existing?.avatarUrl, '/uploads/profile/', PROFILE_DIR));
    await db.collection('profiles').updateOne(
      { userId: identity.userId, app: 'timeharbor' },
      { $unset: { avatarUrl: '' }, $set: { updatedAt: new Date() } },
    );
    return sendJson(res, 200, { ok: true });
  }

  next();
});

// ── Background upload/delete (/api/me/background) ─────────────────────────────

WebApp.connectHandlers.use('/api/me/background', async (req, res, next) => {
  setCors(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const identity = await authenticateRequest(req);
  if (!identity) return sendJson(res, 401, { error: 'Unauthorized' });

  if (req.method === 'POST') {
    let file;
    try {
      file = await parseMultipart(req, ['image/png', 'image/jpeg']);
      if (file.size === 0) throw new Error('Empty file');

      await fsp.mkdir(PROFILE_DIR, { recursive: true });
      const ext = file.mimeType === 'image/png' ? 'png' : 'jpg';
      const hex = randomBytes(8).toString('hex');
      const filename = `${identity.userId}-${hex}_background.${ext}`;
      const filepath = path.join(PROFILE_DIR, filename);

      const db = rawDb();
      const existing = await db.collection('profiles').findOne({ userId: identity.userId, app: 'timeharbor' });
      unlinkSafe(resolveUploadPath(existing?.backgroundUrl, '/uploads/profile/', PROFILE_DIR));

      await fsp.rename(file.path, filepath);
      const backgroundUrl = `/uploads/profile/${filename}`;

      await db.collection('profiles').updateOne(
        { userId: identity.userId, app: 'timeharbor' },
        { $set: { backgroundUrl, updatedAt: new Date() }, $setOnInsert: { userId: identity.userId, app: 'timeharbor', displayName: identity.name, status: 'online', createdAt: new Date() } },
        { upsert: true },
      );
      return sendJson(res, 200, { backgroundUrl });
    } catch (err) {
      unlinkSafe(file?.path);
      return sendJson(res, err.statusCode ?? 400, { error: err.message });
    }
  }

  if (req.method === 'DELETE') {
    const db = rawDb();
    const existing = await db.collection('profiles').findOne({ userId: identity.userId, app: 'timeharbor' });
    unlinkSafe(resolveUploadPath(existing?.backgroundUrl, '/uploads/profile/', PROFILE_DIR));
    await db.collection('profiles').updateOne(
      { userId: identity.userId, app: 'timeharbor' },
      { $unset: { backgroundUrl: '' }, $set: { updatedAt: new Date() } },
    );
    return sendJson(res, 200, { ok: true });
  }

  next();
});

// ── Media storage ─────────────────────────────────────────────────────────────

/**
 * Store one media file under /uploads/media and record it in `mediaitems`.
 * `write(dest)` puts the bytes at `dest` (a rename for multipart uploads, a
 * writeFile for decoded inline images). `embedded` marks media that only a
 * post's text references, so it stays out of the library and profile Feed.
 * Returns the inserted document.
 */
export async function storeMedia({ userId, mimeType, size, title, embedded }, write) {
  const ext = MIME_TO_EXT[mimeType];
  if (!ext) throw new Error(`Unsupported media type ${mimeType}`);
  await fsp.mkdir(MEDIA_DIR, { recursive: true });
  const filename = `${userId}-${randomBytes(8).toString('hex')}.${ext}`;
  const dest = path.join(MEDIA_DIR, filename);
  const type = mimeType.startsWith('video/')
    ? 'video'
    : mimeType.startsWith('image/')
      ? 'image'
      : 'document';
  const doc = {
    _id: new ObjectId(),
    userId,
    type,
    mimeType,
    url: `/uploads/media/${filename}`,
    filename,
    size,
    ...(title ? { title } : {}),
    ...(embedded ? { embedded: true } : {}),
    uploadedAt: new Date(),
  };
  try {
    await write(dest);
    await rawDb().collection('mediaitems').insertOne(doc);
    return doc;
  } catch (err) {
    unlinkSafe(dest);
    try {
      await rawDb().collection('mediaitems').deleteOne({ _id: doc._id });
    } catch (cleanupError) {
      console.error('[uploads] failed to clean up media record after store error:', cleanupError);
    }
    throw err;
  }
}

/** Remove a media document's file; its row is the caller's to delete. */
export function removeMediaFile(doc) {
  unlinkSafe(path.join(MEDIA_DIR, doc.filename));
}

/**
 * Run before saving a reference to uploads outside a post (an attachment's
 * URL, a ticket's description; `texts` as keepForReference takes them): their
 * discard marks go, so the sweep (huddle.js sweepUnusedUploads) keeps them.
 * One the sweep already deleted stays gone; the reference is saved as one to
 * any missing file is, since neither checks that what it points at exists.
 */
export async function keepReferencedUploads(texts) {
  const kept = keepForReference(texts);
  if (kept) await rawDb().collection('mediaitems').updateMany(kept.filter, kept.update);
}

/** Undo storeMedia for documents nothing ended up referencing. */
export async function discardMedia(docs) {
  if (!docs.length) return;
  for (const doc of docs) removeMediaFile(doc);
  await rawDb()
    .collection('mediaitems')
    .deleteMany({ _id: { $in: docs.map((doc) => doc._id) } });
}

/**
 * The media `userId`'s Huddle posts carry or show, scheduled or sent, and
 * their uploads others' posts carry: a post's photos, files and videos belong
 * to the post and its team, not to everyone who may view the uploader's
 * profile, so library and profile listings leave them out (excludingPostMedia). `mediaIds`: images/documents reference the
 * library row's own `_id`; a composer-staged video's `mediaId` is Pulse's
 * `videoid` instead (src/features/huddle/api.ts uploadMedia), and a Pulse
 * video is matched by its URL's video id too, whatever its `mediaId`. `urls`:
 * uploads a post's text shows, which needn't be among its attachments (a
 * plan's pasted screenshot stays in the text when the wrap-up's attachments
 * replace the plan's).
 */
async function postMedia(userId) {
  const db = rawDb();
  const posts = db.collection('huddlePosts');
  // Their uploads on someone else's post: an admin's edit checks the uploads
  // it adds against the editor, not the post's author.
  const own = await db
    .collection('mediaitems')
    .find({ userId, embedded: { $ne: true } }, { projection: { _id: 1, videoid: 1 } })
    .toArray();
  const [mediaIds, urls, texts, onOthersPosts] = await Promise.all([
    posts.distinct('attachments.mediaId', { userId }),
    posts.distinct('attachments.url', { userId }),
    posts
      .find({ userId, 'content.text': { $regex: '/uploads/media/' } }, { projection: { 'content.text': 1 } })
      .toArray(),
    own.length
      ? posts.distinct('attachments.mediaId', {
          userId: { $ne: userId },
          'attachments.mediaId': { $in: mediaRefsOf(own) },
        })
      : [],
  ]);
  const ids = new Set([...mediaIds, ...onOthersPosts].filter((id) => typeof id === 'string' && id));
  for (const url of urls) {
    const video = videoIdOf(url);
    if (video) ids.add(video);
  }
  return { mediaIds: ids, urls: new Set(texts.flatMap((post) => uploadUrlsIn(post.content?.text))) };
}

/**
 * Library and profile listings (and pulsevault.listVideos, its videos) show
 * only what someone put there themselves:
 * not media embedded in a post's text, nor anything their Huddle posts carry
 * or show (scheduled or sent), nor an upload waiting to be deleted, filtered at read time against `huddlePosts`
 * rather than a flag written onto the media document, so older posts follow too.
 */
export async function libraryItemsFilter(userId) {
  return {
    embedded: { $ne: true },
    // An upload a post dropped that nothing else uses, waiting out its grace
    // period before it's deleted (huddle.js discardUnusedUploads).
    discardAt: { $exists: false },
    ...excludingPostMedia(await postMedia(userId), (id) => new ObjectId(id)),
  };
}

// ── Media upload (/api/media/upload) ──────────────────────────────────────────

WebApp.connectHandlers.use('/api/media/upload', async (req, res, next) => {
  setCors(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (req.method !== 'POST') return next();

  const identity = await authenticateRequest(req);
  if (!identity) return sendJson(res, 401, { error: 'Unauthorized' });

  let file;
  try {
    const allowedMimes = Object.keys(MIME_TO_EXT);
    file = await parseMultipart(req, allowedMimes);
    if (file.size === 0) throw new Error('Empty file');

    const doc = await storeMedia(
      { userId: identity.userId, mimeType: file.mimeType, size: file.size, title: file.filename },
      (dest) => fsp.rename(file.path, dest),
    );

    return sendJson(res, 200, {
      item: {
        id: doc._id.toHexString(),
        userId: doc.userId,
        type: doc.type,
        mimeType: doc.mimeType,
        url: doc.url,
        videoid: null,
        filename: doc.filename,
        size: doc.size,
        title: doc.title ?? null,
        caption: null,
        altText: null,
        thumbnail: null,
        uploadedAt: doc.uploadedAt.toISOString(),
      },
    });
  } catch (err) {
    unlinkSafe(file?.path);
    return sendJson(res, err.statusCode ?? 400, { error: err.message });
  }
});

// ── Media thumbnail upload (/api/media-thumbnail/:id) ─────────────────────────

WebApp.connectHandlers.use('/api/media-thumbnail/', async (req, res, next) => {
  setCors(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const match = req.url.match(/^\/?([0-9a-f]{24})$/);
  if (!match || req.method !== 'POST') return next();

  const mediaId = match[1];
  const identity = await authenticateRequest(req);
  if (!identity) return sendJson(res, 401, { error: 'Unauthorized' });

  const db = rawDb();
  const item = await db.collection('mediaitems').findOne({ _id: new ObjectId(mediaId) });
  if (!item) return sendJson(res, 404, { error: 'Not found' });
  if (item.userId !== identity.userId) return sendJson(res, 403, { error: 'Forbidden' });

  let file;
  try {
    file = await parseMultipart(req, ['image/jpeg', 'image/png', 'image/webp']);
    if (file.size === 0) throw new Error('Empty file');

    await fsp.mkdir(THUMBNAILS_DIR, { recursive: true });
    const hex = randomBytes(8).toString('hex');
    const filename = `${identity.userId}-${hex}.jpg`;
    await fsp.rename(file.path, path.join(THUMBNAILS_DIR, filename));

    const previousPath = resolveUploadPath(item.thumbnail, '/uploads/thumbnails/', THUMBNAILS_DIR);
    const thumbnailUrl = `/uploads/thumbnails/${filename}`;

    const updated = await db.collection('mediaitems').findOneAndUpdate(
      { _id: new ObjectId(mediaId) },
      { $set: { thumbnail: thumbnailUrl } },
      { returnDocument: 'after' },
    );

    if (previousPath && previousPath !== path.join(THUMBNAILS_DIR, filename)) {
      unlinkSafe(previousPath);
    }

    return sendJson(res, 200, {
      item: {
        id: updated._id.toHexString(),
        userId: updated.userId,
        type: updated.type,
        mimeType: updated.mimeType,
        url: updated.url,
        videoid: updated.videoid ?? null,
        filename: updated.filename,
        size: updated.size,
        title: updated.title ?? null,
        caption: updated.caption ?? null,
        altText: updated.altText ?? null,
        thumbnail: updated.thumbnail ?? null,
        uploadedAt: updated.uploadedAt instanceof Date ? updated.uploadedAt.toISOString() : String(updated.uploadedAt),
      },
    });
  } catch (err) {
    unlinkSafe(file?.path);
    return sendJson(res, err.statusCode ?? 400, { error: err.message });
  }
});

// ── Media CRUD methods (wormhole) ─────────────────────────────────────────────

import { Meteor } from 'meteor/meteor';

/** Listed media items as the API returns them, each video under its one name. */
async function toPublicMediaItems(docs) {
  const names = await videoNamesFor(docs.map((m) => (m.type === 'video' ? m.videoid : null)));
  return docs.map((m) => toPublicMediaItem(m, names));
}

/**
 * A media item as the API returns it. `names` (videoNamesFor) holds its
 * video's one name, where old data has more than one row for that video.
 */
function toPublicMediaItem(m, names = new Map()) {
  return {
    id: m._id.toHexString ? m._id.toHexString() : String(m._id),
    userId: m.userId,
    type: m.type,
    mimeType: m.mimeType,
    url: m.url,
    videoid: m.videoid ?? null,
    filename: m.filename,
    size: m.size,
    // A video's title is its name (video-names.js): the old placeholder reads as none.
    title: m.type === 'video' ? listedVideoName(m, names) : (m.title ?? null),
    caption: m.caption ?? null,
    altText: m.altText ?? null,
    thumbnail: m.thumbnail ?? null,
    // A video named before it had a media item has no known upload time.
    uploadedAt:
      m.uploadedAt instanceof Date ? m.uploadedAt.toISOString() : m.uploadedAt ? String(m.uploadedAt) : null,
  };
}

Meteor.methods({
  async 'media.list'({ limit } = {}) {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    const safeLimit = Math.min(Math.max(1, limit ?? 50), 100);
    const docs = await rawDb().collection('mediaitems')
      .find({ userId, ...(await libraryItemsFilter(userId)) })
      .sort({ uploadedAt: -1 })
      .limit(safeLimit)
      .toArray();
    return { items: await toPublicMediaItems(docs) };
  },

  async 'media.listForUser'({ userId: targetUserId, limit } = {}) {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    if (!isValidId(targetUserId)) throw new Meteor.Error('bad-request', 'Invalid userId');
    // Same rule as `users.get`: this is the profile's Feed, so disagreeing
    // would leave an authorized profile with an empty one.
    await requireProfileAccess(userId, targetUserId, 'Not a teammate');
    const safeLimit = Math.min(Math.max(1, limit ?? 50), 100);
    const docs = await rawDb().collection('mediaitems')
      .find({ userId: targetUserId, ...(await libraryItemsFilter(targetUserId)) })
      .sort({ uploadedAt: -1 })
      .limit(safeLimit)
      .toArray();
    return { items: await toPublicMediaItems(docs) };
  },

  async 'media.update'({ mediaId, title, caption, altText } = {}) {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    if (!isValidId(mediaId)) throw new Meteor.Error('not-found', 'Invalid media id');
    const db = rawDb();
    const doc = await db.collection('mediaitems').findOne({ _id: new ObjectId(mediaId) });
    if (!doc) throw new Meteor.Error('not-found', 'Not found');
    if (doc.userId !== userId) throw new Meteor.Error('forbidden', 'Not the owner');
    const items = db.collection('mediaitems');
    if (title !== undefined) {
      // A video's name lives on its canonical row (titleRowOf), which old data
      // with duplicates may not be this one; its owner must be the caller too.
      const canonical =
        doc.type === 'video' && doc.videoid
          ? await items.findOne({ videoid: doc.videoid }, CANONICAL_ITEM)
          : null;
      const row = titleRowOf(doc, canonical);
      if (row.userId !== userId) throw new Meteor.Error('forbidden', 'Not the owner');
      // A video's rename: one line, at most VIDEO_NAME_MAX characters, empty is no name.
      await items.updateOne(
        { _id: row._id },
        { $set: { title: doc.type === 'video' ? cleanVideoName(title) : title } },
      );
    }
    const $set = {};
    if (caption !== undefined) $set.caption = caption;
    if (altText !== undefined) $set.altText = altText;
    if (Object.keys($set).length) await items.updateOne({ _id: doc._id }, { $set });
    const updated = await items.findOne({ _id: doc._id });
    return { item: (await toPublicMediaItems([updated]))[0] };
  },

  async 'media.remove'({ mediaId } = {}) {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    if (!isValidId(mediaId)) throw new Meteor.Error('not-found', 'Invalid media id');
    const db = rawDb();
    const doc = await db.collection('mediaitems').findOne({ _id: new ObjectId(mediaId) });
    if (!doc) throw new Meteor.Error('not-found', 'Not found');
    if (doc.userId !== userId) throw new Meteor.Error('forbidden', 'Not the owner');
    if (await artifactIsEvidenceUnderReview(doc.videoid)) {
      throw new Meteor.Error(
        'evidence-in-review',
        'This video backs a timesheet change awaiting review. Withdraw that request first.'
      );
    }
    await db.collection('mediaitems').deleteOne({ _id: doc._id });

    unlinkSafe(resolveUploadPath(doc.url, '/uploads/media/', MEDIA_DIR));
    unlinkSafe(resolveUploadPath(doc.thumbnail, '/uploads/thumbnails/', THUMBNAILS_DIR));
    if (doc.videoid) {
      fsp.rm(path.join(VIDEOS_DIR, doc.videoid), { recursive: true, force: true }).catch(() => {});
    }
    return { ok: true };
  },
});
