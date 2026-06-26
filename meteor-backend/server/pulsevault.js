/**
 * PulseVault — full TUS video upload + serving implementation for Meteor.
 *
 * Ports Fastify video-reserve.service.ts and pulsevault.ts to Meteor.
 *
 * IMPORTANT: TUS handler mounts on rawConnectHandlers BEFORE CORS middleware,
 * since TUS needs to handle its own OPTIONS requests with protocol-specific headers.
 */
import { WebApp } from 'meteor/webapp';
import { Meteor } from 'meteor/meteor';
import { MongoInternals } from 'meteor/mongo';
import { Server as TusServer } from '@tus/server';
import { FileStore } from '@tus/file-store';
import { rawDb } from './collections.js';
import { requireIdentity, resolveToken } from './auth-bridge.js';
import { randomUUID } from 'crypto';
import path from 'path';

const { ObjectId } = MongoInternals.NpmModules.mongodb.module;

const UPLOAD_DIR = process.env.PULSEVAULT_UPLOAD_DIR ?? path.resolve(process.cwd(), '../backend/data/videos');
const METEOR_ROOT_URL = process.env.ROOT_URL?.replace(/\/$/, '') ?? 'https://timecore-dev.os.mieweb.org';

// ── Reservation store (port of video-reserve.service.ts) ──────────────────
// In-memory store — same as Fastify; reservations are short-lived.

const reservationStore = new Map();

function reserveVideo(videoid, ticketId, userId) {
  const token = randomUUID();
  reservationStore.set(videoid, {
    context: { kind: 'ticket', ticketId },
    userId,
    token,
    createdAt: Date.now(),
  });
  return token;
}

function reserveVideoForLibrary(videoid, userId) {
  const token = randomUUID();
  reservationStore.set(videoid, {
    context: { kind: 'library' },
    userId,
    token,
    createdAt: Date.now(),
  });
  return token;
}

function verifyReservationToken(videoid, token) {
  const entry = reservationStore.get(videoid);
  return entry?.token === token;
}

function getReservation(videoid) {
  const entry = reservationStore.get(videoid);
  return entry ? { context: entry.context, userId: entry.userId } : undefined;
}

function consumeReservation(videoid) {
  const entry = reservationStore.get(videoid);
  reservationStore.delete(videoid);
  return entry ? { context: entry.context, userId: entry.userId } : undefined;
}

// ── Authorization handler ──────────────────────────────────────────────────

async function authorizeHandler(req, ctx) {
  // Playback (resolve phase) — check ownership
  if (ctx.phase === 'resolve') {
    const authHeader = req.headers?.authorization;
    const rawToken = authHeader?.replace(/^bearer /i, '');
    if (!rawToken) return; // public playback allowed
    const identity = await resolveToken(rawToken);
    if (!identity) throw Object.assign(new Error('Unauthorized'), { statusCode: 401 });
    return;
  }

  // Upload phases — check reservation token first
  const authHeader = req.headers?.authorization;
  const rawToken = authHeader?.replace(/^bearer /i, '');

  // Try reservation token (from videoApi.reserve)
  if (rawToken && verifyReservationToken(ctx.videoid, rawToken)) {
    return; // valid reservation token
  }

  // Try Meteor resume token (from logged-in user)
  if (rawToken) {
    const identity = await resolveToken(rawToken);
    if (identity) {
      const reservation = getReservation(ctx.videoid);
      if (reservation && reservation.userId === identity.userId) return;
    }
  }

  throw Object.assign(new Error('Unauthorized'), { statusCode: 401 });
}

// ── Upload complete handler ────────────────────────────────────────────────

async function onUploadCompleteHandler(req, res, upload) {
  const videoid = upload.id;
  const reservation = consumeReservation(videoid);
  if (!reservation) {
    console.warn('[pulsevault] onUploadComplete: no reservation for', videoid);
    return res;
  }

  // Determine filename from upload metadata
  const metaFilename = upload.metadata?.filename;
  const filename = metaFilename ? path.basename(metaFilename) : `${videoid}.mp4`;
  const title = path.parse(filename).name
    .replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim() || `Video ${videoid.slice(0, 8)}`;

  const videoUrl = `${METEOR_ROOT_URL}/v1/video/${videoid}`;

  if (reservation.context.kind === 'library') {
    // Create media item
    await rawDb().collection('mediaitems').insertOne({
      _id: new ObjectId(),
      userId: reservation.userId,
      type: 'video',
      mimeType: 'video/mp4',
      url: videoUrl,
      videoid,
      filename,
      size: upload.size ?? 0,
      title,
      caption: null,
      altText: null,
      thumbnail: null,
      uploadedAt: new Date(),
    });
    console.log('[pulsevault] Created media item for library upload:', videoid);
  } else {
    // Create attachment for ticket
    const ticketId = reservation.context.ticketId;
    await rawDb().collection('attachments').insertOne({
      _id: new ObjectId(),
      userId: reservation.userId,
      url: videoUrl,
      type: 'video',
      title,
      thumbnail: null,
      attachedTo: { kind: 'ticket', id: ticketId },
      addedBy: reservation.userId,
      addedAt: new Date(),
    });
    console.log('[pulsevault] Created attachment for ticket:', ticketId, 'video:', videoid);
  }

  return res;
}

// ── TUS server setup ───────────────────────────────────────────────────────

const tusServer = new TusServer({
  path: '/uploads/tus',
  datastore: new FileStore({ directory: UPLOAD_DIR }),
  respectForwardedHeaders: true,
  onUploadFinish: onUploadCompleteHandler,
});

// Mount on rawConnectHandlers BEFORE CORS to handle TUS OPTIONS.
// The rawHeaders mutation + res patches are critical for correct protocol
// behaviour behind a reverse proxy — do not simplify.
WebApp.rawConnectHandlers.use('/uploads/tus', (req, res, next) => {
  // Step 1: Normalize x-forwarded-proto header (split comma-separated values)
  const rawProto = req.headers['x-forwarded-proto'];
  const forwardedProto = rawProto && typeof rawProto === 'string'
    ? rawProto.split(',')[0]?.trim()
    : rawProto;

  // Step 2: Mutate BOTH req.headers AND req.rawHeaders (srvx reads from rawHeaders!)
  if (forwardedProto) {
    req.headers['x-forwarded-proto'] = forwardedProto;

    // rawHeaders is a flat array: [name, value, name, value, ...]
    // Find and replace x-forwarded-proto value in the array
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      if (req.rawHeaders[i].toLowerCase() === 'x-forwarded-proto') {
        req.rawHeaders[i + 1] = forwardedProto;
        break;
      }
    }
  }

  // Step 3: Wrap res.setHeader to rewrite Location: http:// → https://
  const originalSetHeader = res.setHeader.bind(res);
  res.setHeader = function(name, value) {
    if (name.toLowerCase() === 'location' && typeof value === 'string') {
      if (value.startsWith('http://') && forwardedProto === 'https') {
        return originalSetHeader(name, value.replace(/^http:\/\//, 'https://'));
      }
    }
    return originalSetHeader(name, value);
  };

  // Step 4: Wrap res.writeHead to rewrite Location in both object and array forms
  const originalWriteHead = res.writeHead.bind(res);
  res.writeHead = function(status, ...args) {
    // Handle writeHead(status, headers) where headers is an object
    if (args.length === 1 && typeof args[0] === 'object' && !Array.isArray(args[0])) {
      const headers = args[0];
      if (headers.Location && typeof headers.Location === 'string') {
        if (headers.Location.startsWith('http://') && forwardedProto === 'https') {
          headers.Location = headers.Location.replace(/^http:\/\//, 'https://');
        }
      }
    }
    // Handle writeHead(status, [name, value, name, value, ...]) flat array form (used by srvx)
    else if (args.length === 1 && Array.isArray(args[0])) {
      const headers = args[0];
      for (let i = 0; i < headers.length; i += 2) {
        if (headers[i].toLowerCase() === 'location' && typeof headers[i + 1] === 'string') {
          if (headers[i + 1].startsWith('http://') && forwardedProto === 'https') {
            headers[i + 1] = headers[i + 1].replace(/^http:\/\//, 'https://');
          }
        }
      }
    }
    return originalWriteHead(status, ...args);
  };

  tusServer.handle(req, res).catch((err) => {
    console.error('[pulsevault] TUS error:', err.message);
    next(err);
  });
});

// ── Video serving endpoint ─────────────────────────────────────────────────
// Serve TUS-uploaded videos at /v1/video/:videoid
// Files stored at: UPLOAD_DIR/{videoid}/{videoid}

WebApp.connectHandlers.use('/v1/video', async (req, res, next) => {
  const match = req.url.match(/^\/([0-9a-f-]{36})(\/.*)?$/);
  if (!match) return next();

  const videoid = match[1];
  const videoFile = path.join(UPLOAD_DIR, videoid, 'video', `${videoid}.mp4`);

  // Auth check
  const authHeader = req.headers.authorization;
  const rawToken = authHeader?.replace(/^bearer /i, '');
  if (rawToken) {
    const identity = await resolveToken(rawToken);
    if (!identity) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }
  }

  // Serve file with range support
  let stat;
  try {
    const fs = await import('fs');
    stat = fs.default.statSync(videoFile);
  } catch {
    res.writeHead(404);
    res.end();
    return;
  }

  const fs = await import('fs');
  const fileSize = stat.size;
  const range = req.headers['range'];

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunkSize = (end - start) + 1;
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': 'video/mp4',
      'Cache-Control': 'public, max-age=86400',
    });
    fs.default.createReadStream(videoFile, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Accept-Ranges': 'bytes',
      'Content-Type': 'video/mp4',
      'Cache-Control': 'public, max-age=86400',
    });
    fs.default.createReadStream(videoFile).pipe(res);
  }
});

// ── Meteor methods ─────────────────────────────────────────────────────────

Meteor.methods({
  async 'pulsevault.reserve'({ ticketId, existingVideoid, target } = {}) {
    const identity = await requireIdentity(this);
    const userId = identity.userId;

    if (target === 'library' || !ticketId) {
      const videoid = randomUUID();
      const uploadToken = reserveVideoForLibrary(videoid, userId);
      const uploadLink = `${METEOR_ROOT_URL}/uploads/tus`;
      return { videoid, uploadToken, uploadLink };
    }

    // Ticket upload
    const ticket = await rawDb().collection('tickets').findOne({
      _id: new ObjectId(ticketId)
    });
    if (!ticket) throw new Meteor.Error('not-found', 'Ticket not found');

    const videoid = existingVideoid ?? randomUUID();
    const uploadToken = reserveVideo(videoid, ticketId, userId);
    const uploadLink = `${METEOR_ROOT_URL}/uploads/tus`;
    return { videoid, uploadToken, uploadLink };
  },

  async 'pulsevault.reserveForLibrary'() {
    const identity = await requireIdentity(this);
    const videoid = randomUUID();
    const uploadToken = reserveVideoForLibrary(videoid, identity.userId);
    return { videoid, uploadToken, uploadLink: `${METEOR_ROOT_URL}/uploads/tus` };
  },
});

console.log('[pulsevault] TUS server mounted at /uploads/tus');
console.log('[pulsevault] Video serving at /v1/video/:videoid');
console.log('[pulsevault] Upload directory:', UPLOAD_DIR);
