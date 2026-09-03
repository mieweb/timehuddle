import { WebApp } from 'meteor/webapp';
import { MongoInternals } from 'meteor/mongo';
import { rawDb, isValidId } from './collections';
import { Teams } from './collections';
import { resolveToken, requireIdentity } from './auth-bridge';
import { randomBytes } from 'crypto';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import Busboy from 'busboy';

const { ObjectId } = MongoInternals.NpmModules.mongodb.module;

const UPLOADS_DIR = process.env.UPLOADS_DIR || path.resolve(process.cwd(), 'uploads');
const PROFILE_DIR = path.join(UPLOADS_DIR, 'profile');
const MEDIA_DIR = path.join(UPLOADS_DIR, 'media');
const THUMBNAILS_DIR = path.join(UPLOADS_DIR, 'thumbnails');
const VIDEOS_DIR = process.env.VIDEOS_DIR || path.resolve(process.cwd(), 'data/videos');

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
    const busboy = Busboy({ headers: req.headers, limits: { fileSize: MAX_FILE_SIZE, files: 1 } });

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

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunkSize = (end - start) + 1;
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=86400',
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Accept-Ranges': 'bytes',
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=86400',
    });
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

    const ext = MIME_TO_EXT[file.mimeType];
    await fsp.mkdir(MEDIA_DIR, { recursive: true });
    const hex = randomBytes(8).toString('hex');
    const filename = `${identity.userId}-${hex}.${ext}`;
    await fsp.rename(file.path, path.join(MEDIA_DIR, filename));

    const url = `/uploads/media/${filename}`;
    
    // Classify file type based on MIME type
    let type = 'image';
    if (file.mimeType.startsWith('video/')) {
      type = 'video';
    } else if (!file.mimeType.startsWith('image/')) {
      type = 'document';
    }
    
    const doc = {
      _id: new ObjectId(),
      userId: identity.userId,
      type,
      mimeType: file.mimeType,
      url,
      filename,
      size: file.size,
      ...(file.filename ? { title: file.filename } : {}),
      uploadedAt: new Date(),
    };
    await rawDb().collection('mediaitems').insertOne(doc);

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

function toPublicMediaItem(m) {
  return {
    id: m._id.toHexString ? m._id.toHexString() : String(m._id),
    userId: m.userId,
    type: m.type,
    mimeType: m.mimeType,
    url: m.url,
    videoid: m.videoid ?? null,
    filename: m.filename,
    size: m.size,
    title: m.title ?? null,
    caption: m.caption ?? null,
    altText: m.altText ?? null,
    thumbnail: m.thumbnail ?? null,
    uploadedAt: m.uploadedAt instanceof Date ? m.uploadedAt.toISOString() : String(m.uploadedAt),
  };
}

Meteor.methods({
  async 'media.list'({ limit } = {}) {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    const safeLimit = Math.min(Math.max(1, limit ?? 50), 100);
    const docs = await rawDb().collection('mediaitems')
      .find({ userId })
      .sort({ uploadedAt: -1 })
      .limit(safeLimit)
      .toArray();
    return { items: docs.map(toPublicMediaItem) };
  },

  async 'media.listForUser'({ userId: targetUserId, limit } = {}) {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    if (!isValidId(targetUserId)) throw new Meteor.Error('bad-request', 'Invalid userId');
    if (userId !== targetUserId) {
      const sharedTeam = await Teams.rawCollection().findOne({
        members: { $all: [userId, targetUserId] },
        isPersonal: { $ne: true },
      });
      if (!sharedTeam) throw new Meteor.Error('forbidden', 'Not a teammate');
    }
    const safeLimit = Math.min(Math.max(1, limit ?? 50), 100);
    const docs = await rawDb().collection('mediaitems')
      .find({ userId: targetUserId })
      .sort({ uploadedAt: -1 })
      .limit(safeLimit)
      .toArray();
    return { items: docs.map(toPublicMediaItem) };
  },

  async 'media.update'({ mediaId, title, caption, altText } = {}) {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    if (!isValidId(mediaId)) throw new Meteor.Error('not-found', 'Invalid media id');
    const db = rawDb();
    const doc = await db.collection('mediaitems').findOne({ _id: new ObjectId(mediaId) });
    if (!doc) throw new Meteor.Error('not-found', 'Not found');
    if (doc.userId !== userId) throw new Meteor.Error('forbidden', 'Not the owner');
    const $set = {};
    if (title !== undefined) $set.title = title;
    if (caption !== undefined) $set.caption = caption;
    if (altText !== undefined) $set.altText = altText;
    const updated = await db.collection('mediaitems').findOneAndUpdate(
      { _id: doc._id },
      { $set },
      { returnDocument: 'after' },
    );
    return { item: toPublicMediaItem(updated) };
  },

  async 'media.remove'({ mediaId } = {}) {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    if (!isValidId(mediaId)) throw new Meteor.Error('not-found', 'Invalid media id');
    const db = rawDb();
    const doc = await db.collection('mediaitems').findOne({ _id: new ObjectId(mediaId) });
    if (!doc) throw new Meteor.Error('not-found', 'Not found');
    if (doc.userId !== userId) throw new Meteor.Error('forbidden', 'Not the owner');
    await db.collection('mediaitems').deleteOne({ _id: doc._id });

    unlinkSafe(resolveUploadPath(doc.url, '/uploads/media/', MEDIA_DIR));
    unlinkSafe(resolveUploadPath(doc.thumbnail, '/uploads/thumbnails/', THUMBNAILS_DIR));
    if (doc.videoid) {
      fsp.rm(path.join(VIDEOS_DIR, doc.videoid), { recursive: true, force: true }).catch(() => {});
    }
    return { ok: true };
  },
});

// ─── Publications ─────────────────────────────────────────────────────────────

import { MediaItems } from './collections.js';

Meteor.publish('media.liveForUser', async function () {
  if (!this.userId) return this.ready();
  return MediaItems.find({ userId: this.userId });
});
