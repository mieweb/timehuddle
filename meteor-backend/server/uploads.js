import { WebApp } from 'meteor/webapp';
import { MongoInternals } from 'meteor/mongo';
import { rawDb, isValidId } from './collections';
import { Teams } from './collections';
import { resolveToken } from './auth-bridge';
import { randomBytes } from 'crypto';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import Busboy from 'busboy';

const { ObjectId } = MongoInternals.NpmModules.mongodb.module;

const UPLOADS_DIR = process.env.UPLOADS_DIR || path.resolve(process.cwd(), '../backend/uploads');
const PROFILE_DIR = path.join(UPLOADS_DIR, 'profile');
const MEDIA_DIR = path.join(UPLOADS_DIR, 'media');
const THUMBNAILS_DIR = path.join(UPLOADS_DIR, 'thumbnails');
const VIDEOS_DIR = process.env.VIDEOS_DIR || path.resolve(process.cwd(), '../backend/data/videos');

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

const MIME_TO_EXT = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
};

const CORS_ORIGINS = (process.env.CORS_ORIGINS || 'http://localhost:3000').split(',').map((s) => s.trim());

function setCors(req, res) {
  const origin = req.headers.origin;
  if (origin && CORS_ORIGINS.includes(origin)) {
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

function parseMultipart(req, allowedMimes) {
  return new Promise((resolve, reject) => {
    const busboy = Busboy({ headers: req.headers, limits: { fileSize: MAX_FILE_SIZE, files: 1 } });
    let fileData = null;

    busboy.on('file', (fieldname, stream, info) => {
      const { filename, mimeType } = info;
      if (!allowedMimes.includes(mimeType)) {
        stream.resume();
        fileData = { error: 'Unsupported file type' };
        return;
      }
      const chunks = [];
      stream.on('data', (chunk) => chunks.push(chunk));
      stream.on('end', () => {
        fileData = { buffer: Buffer.concat(chunks), filename, mimeType };
      });
    });

    busboy.on('finish', () => {
      if (!fileData) return reject(new Error('No file uploaded'));
      if (fileData.error) return reject(new Error(fileData.error));
      resolve(fileData);
    });

    busboy.on('error', reject);
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
  if (req.method !== 'GET') { next(); return; }

  const safePath = path.normalize(req.url).replace(/^(\.\.(\/|\\|$))+/, '');
  const filePath = path.join(UPLOADS_DIR, safePath);

  if (!filePath.startsWith(UPLOADS_DIR)) {
    res.writeHead(403);
    res.end();
    return;
  }

  const stream = fs.createReadStream(filePath);
  stream.on('error', () => {
    res.writeHead(404);
    res.end();
  });
  stream.on('open', () => {
    const ext = path.extname(filePath).toLowerCase();
    const mimeMap = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime' };
    res.writeHead(200, { 'Content-Type': mimeMap[ext] || 'application/octet-stream', 'Cache-Control': 'public, max-age=86400' });
  });
  stream.pipe(res);
});

// ── Avatar upload/delete (/api/me/avatar) ─────────────────────────────────────

WebApp.connectHandlers.use('/api/me/avatar', async (req, res, next) => {
  setCors(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const identity = await authenticateRequest(req);
  if (!identity) return sendJson(res, 401, { error: 'Unauthorized' });

  if (req.method === 'POST') {
    try {
      const file = await parseMultipart(req, ['image/png', 'image/jpeg']);
      if (file.buffer.length === 0) return sendJson(res, 400, { error: 'Empty file' });

      await fsp.mkdir(PROFILE_DIR, { recursive: true });
      const ext = file.mimeType === 'image/png' ? 'png' : 'jpg';
      const hex = randomBytes(8).toString('hex');
      const filename = `${identity.userId}-${hex}_avatar.${ext}`;
      const filepath = path.join(PROFILE_DIR, filename);

      const db = rawDb();
      const existing = await db.collection('profiles').findOne({ userId: identity.userId, app: 'timeharbor' });
      unlinkSafe(resolveUploadPath(existing?.avatarUrl, '/uploads/profile/', PROFILE_DIR));

      await fsp.writeFile(filepath, file.buffer);
      const avatarUrl = `/uploads/profile/${filename}`;

      await db.collection('profiles').updateOne(
        { userId: identity.userId, app: 'timeharbor' },
        { $set: { avatarUrl, updatedAt: new Date() }, $setOnInsert: { userId: identity.userId, app: 'timeharbor', displayName: identity.name, status: 'online', createdAt: new Date() } },
        { upsert: true },
      );
      return sendJson(res, 200, { avatarUrl });
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
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
    try {
      const file = await parseMultipart(req, ['image/png', 'image/jpeg']);
      if (file.buffer.length === 0) return sendJson(res, 400, { error: 'Empty file' });

      await fsp.mkdir(PROFILE_DIR, { recursive: true });
      const ext = file.mimeType === 'image/png' ? 'png' : 'jpg';
      const hex = randomBytes(8).toString('hex');
      const filename = `${identity.userId}-${hex}_background.${ext}`;
      const filepath = path.join(PROFILE_DIR, filename);

      const db = rawDb();
      const existing = await db.collection('profiles').findOne({ userId: identity.userId, app: 'timeharbor' });
      unlinkSafe(resolveUploadPath(existing?.backgroundUrl, '/uploads/profile/', PROFILE_DIR));

      await fsp.writeFile(filepath, file.buffer);
      const backgroundUrl = `/uploads/profile/${filename}`;

      await db.collection('profiles').updateOne(
        { userId: identity.userId, app: 'timeharbor' },
        { $set: { backgroundUrl, updatedAt: new Date() }, $setOnInsert: { userId: identity.userId, app: 'timeharbor', displayName: identity.name, status: 'online', createdAt: new Date() } },
        { upsert: true },
      );
      return sendJson(res, 200, { backgroundUrl });
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
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

  try {
    const allowedMimes = Object.keys(MIME_TO_EXT);
    const file = await parseMultipart(req, allowedMimes);
    if (file.buffer.length === 0) return sendJson(res, 400, { error: 'Empty file' });

    const ext = MIME_TO_EXT[file.mimeType];
    await fsp.mkdir(MEDIA_DIR, { recursive: true });
    const hex = randomBytes(8).toString('hex');
    const filename = `${identity.userId}-${hex}.${ext}`;
    await fsp.writeFile(path.join(MEDIA_DIR, filename), file.buffer);

    const url = `/uploads/media/${filename}`;
    const doc = {
      _id: new ObjectId(),
      userId: identity.userId,
      type: 'image',
      mimeType: file.mimeType,
      url,
      filename,
      size: file.buffer.length,
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
    return sendJson(res, 400, { error: err.message });
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

  try {
    const file = await parseMultipart(req, ['image/jpeg', 'image/png', 'image/webp']);
    if (file.buffer.length === 0) return sendJson(res, 400, { error: 'Empty file' });

    await fsp.mkdir(THUMBNAILS_DIR, { recursive: true });
    const hex = randomBytes(8).toString('hex');
    const filename = `${identity.userId}-${hex}.jpg`;
    await fsp.writeFile(path.join(THUMBNAILS_DIR, filename), file.buffer);

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
    return sendJson(res, 400, { error: err.message });
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
    const identity = await (await import('./auth-bridge')).requireIdentity(this);
    const safeLimit = Math.min(Math.max(1, limit ?? 50), 100);
    const docs = await rawDb().collection('mediaitems')
      .find({ userId: identity.userId })
      .sort({ uploadedAt: -1 })
      .limit(safeLimit)
      .toArray();
    return { items: docs.map(toPublicMediaItem) };
  },

  async 'media.listForUser'({ userId, limit } = {}) {
    const identity = await (await import('./auth-bridge')).requireIdentity(this);
    if (!isValidId(userId)) throw new Meteor.Error('bad-request', 'Invalid userId');
    if (identity.userId !== userId) {
      const sharedTeam = await Teams.rawCollection().findOne({
        members: { $all: [identity.userId, userId] },
        isPersonal: { $ne: true },
      });
      if (!sharedTeam) throw new Meteor.Error('forbidden', 'Not a teammate');
    }
    const safeLimit = Math.min(Math.max(1, limit ?? 50), 100);
    const docs = await rawDb().collection('mediaitems')
      .find({ userId })
      .sort({ uploadedAt: -1 })
      .limit(safeLimit)
      .toArray();
    return { items: docs.map(toPublicMediaItem) };
  },

  async 'media.update'({ mediaId, title, caption, altText } = {}) {
    const identity = await (await import('./auth-bridge')).requireIdentity(this);
    if (!isValidId(mediaId)) throw new Meteor.Error('not-found', 'Invalid media id');
    const db = rawDb();
    const doc = await db.collection('mediaitems').findOne({ _id: new ObjectId(mediaId) });
    if (!doc) throw new Meteor.Error('not-found', 'Not found');
    if (doc.userId !== identity.userId) throw new Meteor.Error('forbidden', 'Not the owner');
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
    const identity = await (await import('./auth-bridge')).requireIdentity(this);
    if (!isValidId(mediaId)) throw new Meteor.Error('not-found', 'Invalid media id');
    const db = rawDb();
    const doc = await db.collection('mediaitems').findOne({ _id: new ObjectId(mediaId) });
    if (!doc) throw new Meteor.Error('not-found', 'Not found');
    if (doc.userId !== identity.userId) throw new Meteor.Error('forbidden', 'Not the owner');
    await db.collection('mediaitems').deleteOne({ _id: doc._id });

    unlinkSafe(resolveUploadPath(doc.url, '/uploads/media/', MEDIA_DIR));
    unlinkSafe(resolveUploadPath(doc.thumbnail, '/uploads/thumbnails/', THUMBNAILS_DIR));
    if (doc.videoid) {
      fsp.rm(path.join(VIDEOS_DIR, doc.videoid), { recursive: true, force: true }).catch(() => {});
    }
    return { ok: true };
  },
});
