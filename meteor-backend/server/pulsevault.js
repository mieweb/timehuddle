/**
 * PulseVault — video upload + serving for Meteor, backed by the real
 * `@mieweb/pulsevault` package (framework-agnostic core) instead of a
 * hand-rolled TUS server. Registered as a Wormhole plugin (`Wormhole.use()`),
 * which mounts the handler on `WebApp.connectHandlers` under the hood — see
 * the package's documented Meteor integration pattern. Registering through
 * Wormhole (rather than a bare `WebApp.connectHandlers.use()` call) means
 * this endpoint is tracked in Wormhole's plugin registry instead of being an
 * untracked side-channel mount; the TUS request handling itself is
 * unchanged, since `api.mount()` is a thin wrapper around the same
 * `WebApp.connectHandlers.use()` call. Also serves a standalone Swagger page
 * at `/pulsevault/docs` for these binary routes (see `pulsevault-docs.js`) —
 * Wormhole's own `/api/docs` only documents Meteor methods, with no
 * extension point for hand-written paths.
 *
 * Reservation → capability-token → upload → attach flow:
 *  1. `pulsevault.reserve` (ticket) / `pulsevault.reserveForLibrary` mint an
 *     artifactId + a short-lived HMAC capability token, and record which
 *     ticket (or the media library) the eventual upload belongs to.
 *  2. The Pulse app or web fallback uploads bytes via TUS to
 *     `/pulsevault/upload`, authenticated by that capability token.
 *  3. `onUploadComplete` looks up the recorded context and creates the
 *     ticket attachment / media-library item.
 */
import { Meteor } from 'meteor/meteor';
import { MongoInternals } from 'meteor/mongo';
import { Wormhole } from 'meteor/wreiske:meteor-wormhole';
import {
  createPulseVaultCore,
  createLocalStorage,
  createMp4Sniffer,
  issueCapabilityToken,
  createCapabilityAuthorize,
} from '@mieweb/pulsevault/core';
import { rawDb } from './collections.js';
import { requireIdentity, resolveToken } from './auth-bridge.js';
import { createAttachment } from './attachments.js';
import { pulsevaultOpenApiSpec, pulsevaultSwaggerHtml } from './pulsevault-docs.js';
import { randomUUID } from 'crypto';
import path from 'path';
import { stat } from 'fs/promises';

const { ObjectId } = MongoInternals.NpmModules.mongodb.module;

// Reuse the same directory/env-var convention as uploads.js's `VIDEOS_DIR`
// (used there to clean up video files on `media.remove`).
const VIDEOS_DIR = process.env.VIDEOS_DIR || path.resolve(process.cwd(), 'data/videos');

const CAPABILITY_KEY_ID = 'v1';
const CAPABILITY_SECRET = process.env.PULSEVAULT_SECRET || 'dev-insecure-pulsevault-secret';
const ISSUER = process.env.ROOT_URL;

// `storage.resolve()` returning null is true both for a dead/aborted upload
// and for one that's actively streaming its PATCH. Only treat an unresolved
// artifact as stale (safe to clear) once its on-disk bytes have been idle
// for this long, so a genuinely in-flight transfer can't get swept by a
// retried create POST or a QR re-scan racing the original upload.
const STALE_UPLOAD_IDLE_MS = 5 * 60 * 1000;

/** artifactId -> Set<ServerResponse> — active SSE subscribers waiting for upload-complete. */
const sseClients = new Map();

function notifySseClients(artifactId, ready) {
  const clients = sseClients.get(artifactId);
  if (!clients?.size) return;
  const payload = JSON.stringify({
    artifactId,
    url: `${ISSUER}/pulsevault/artifacts/${artifactId}`,
    size: ready?.size ?? 0,
  });
  const event = `event: ready\ndata: ${payload}\n\n`;
  for (const res of clients) {
    try { res.write(event); } catch {}
    try { res.end(); } catch {}
  }
  sseClients.delete(artifactId);
}

function lookupCapabilitySecret(kid) {
  return kid === CAPABILITY_KEY_ID ? CAPABILITY_SECRET : null;
}

const verifyUploadToken = createCapabilityAuthorize(lookupCapabilitySecret, { issuer: ISSUER });

/**
 * artifactId -> { userId, ticketId } | { userId, target: 'library' }
 * Backed by a Mongo collection so reservations survive server restarts —
 * meteor hot-reloads on every server file change, and a restart between
 * upload-finish and `onUploadComplete` would otherwise wipe the context,
 * leaving the file on disk as `ready` but never attached to anything (and
 * the client retrying the same artifactId into permanent 409s). The
 * in-memory Map is kept as an L1 cache so sync `.has()` calls in logging
 * stay cheap; it is rehydrated from Mongo on startup.
 */
const reservationContext = new Map();
const RESERVATIONS_COLL = 'pulsevault_reservations';

async function persistReservation(videoid, reservation) {
  reservationContext.set(videoid, reservation);
  await rawDb().collection(RESERVATIONS_COLL).updateOne(
    { _id: videoid },
    { $set: { ...reservation, createdAt: new Date() } },
    { upsert: true },
  );
}

/** Fetch AND consume the reservation for an artifactId (Map first, Mongo fallback). */
async function takeReservation(artifactId) {
  let reservation = reservationContext.get(artifactId) ?? null;
  reservationContext.delete(artifactId);
  const coll = rawDb().collection(RESERVATIONS_COLL);
  if (!reservation) {
    const doc = await coll.findOne({ _id: artifactId });
    if (doc) {
      const { _id, createdAt, ...rest } = doc;
      reservation = rest;
    }
  }
  await coll.deleteOne({ _id: artifactId }).catch(() => {});
  return reservation;
}

/**
 * Look up the reservation for an artifactId WITHOUT consuming it (Map first,
 * Mongo fallback) — used to check ownership before letting a caller reuse an
 * `existingVideoid` they didn't originally reserve.
 */
async function peekReservation(artifactId) {
  const cached = reservationContext.get(artifactId);
  if (cached) return cached;
  const doc = await rawDb().collection(RESERVATIONS_COLL).findOne({ _id: artifactId });
  if (!doc) return null;
  const { _id, createdAt, ...rest } = doc;
  return rest;
}

Meteor.startup(async () => {
  const coll = rawDb().collection(RESERVATIONS_COLL);
  // Reservations are short-lived; TTL-expire leftovers after 24h.
  await coll.createIndex({ createdAt: 1 }, { expireAfterSeconds: 86400 }).catch((err) => {
    console.warn('[pulsevault] reservations TTL index failed:', err.message);
  });
  for await (const doc of coll.find({})) {
    const { _id, createdAt, ...rest } = doc;
    if (!reservationContext.has(_id)) reservationContext.set(_id, rest);
  }
  console.log('[pulsevault] rehydrated', reservationContext.size, 'reservation(s) from Mongo');
});

/** Create the mediaitems doc / ticket attachment for a finished upload. */
async function attachUploadedVideo(artifactId, reservation, size = 0) {
  const videoUrl = `${ISSUER}/pulsevault/artifacts/${artifactId}`;
  const title = `Video ${artifactId.slice(0, 8)}`;

  if (reservation.target === 'library') {
    await rawDb().collection('mediaitems').insertOne({
      _id: new ObjectId(),
      userId: reservation.userId,
      type: 'video',
      mimeType: 'video/mp4',
      url: videoUrl,
      videoid: artifactId,
      filename: `${artifactId}.mp4`,
      size,
      title,
      caption: null,
      altText: null,
      thumbnail: null,
      uploadedAt: new Date(),
    });
    console.log('[pulsevault] created media item for library upload:', artifactId);
  } else {
    await createAttachment({
      url: videoUrl,
      type: 'video',
      title,
      attachedTo: { kind: 'ticket', id: reservation.ticketId },
      addedBy: reservation.userId,
    });
    console.log('[pulsevault] created attachment for ticket:', reservation.ticketId, 'video:', artifactId);
  }
}

const storage = createLocalStorage({ workspaceDir: VIDEOS_DIR });

const core = createPulseVaultCore({
  storage,
  basePath: '/pulsevault',
  // WebApp.connectHandlers.use('/pulsevault', ...) already strips the mount
  // prefix before calling the handler — per the package's Meteor integration docs.
  stripBasePath: false,
  maxUploadSize: 500 * 1024 * 1024, // 500 MB
  // Pulse Cam and the web fallback both upload one pre-recorded MP4 per
  // session rather than per-clip "beats".
  uploadUnit: 'merged',
  allowedExtensions: { video: ['.mp4'], captions: ['.vtt', '.srt'] },
  authorize: async (request, ctx) => {
    console.log('[pulsevault][hook] authorize called', {
      phase: ctx.phase,
      artifactId: ctx.artifactId,
      kind: ctx.kind,
      relatedTo: ctx.relatedTo ?? null,
      hasToken: !!(ctx.token || request.headers.authorization),
      reservationExists: reservationContext.has(ctx.artifactId),
    });
    if (ctx.phase === 'resolve') {
      // Artifact playback is public — no auth required.
      return;
    }
    try {
      await verifyUploadToken(request, ctx);
      console.log('[pulsevault][hook] authorize PASSED', ctx.phase, ctx.artifactId);
    } catch (err) {
      console.error('[pulsevault][hook] authorize REJECTED', ctx.phase, ctx.artifactId, {
        error: err.message,
        statusCode: err.statusCode ?? err.status_code ?? 403,
      });
      throw err;
    }
  },
  validatePayload: async (request, ctx) => {
    console.log('[pulsevault][hook] validatePayload called', ctx.artifactId, 'kind:', ctx.kind);
    if (ctx.kind !== 'video') {
      console.log('[pulsevault][hook] validatePayload skipped (not video)', ctx.artifactId, ctx.kind);
      return;
    }
    const sniff = createMp4Sniffer(storage);
    try {
      await sniff(request, ctx);
      console.log('[pulsevault][hook] validatePayload passed', ctx.artifactId);
    } catch (err) {
      console.log('[pulsevault][hook] validatePayload REJECTED', ctx.artifactId, err.message);
      throw err;
    }
  },
  onUploadComplete: async (_request, ctx) => {
    console.log('[pulsevault][hook] onUploadComplete called', JSON.stringify(ctx));
    const reservation = await takeReservation(ctx.artifactId);
    if (!reservation) {
      console.log('[pulsevault][hook] onUploadComplete: NO reservation context for', ctx.artifactId);
      return;
    }
    console.log('[pulsevault][hook] onUploadComplete: found reservation', JSON.stringify(reservation));
    await attachUploadedVideo(ctx.artifactId, reservation, ctx.size ?? 0);
    notifySseClients(ctx.artifactId, ctx);
  },
});

/** Decode a TUS Upload-Metadata header into a plain object (values are base64). */
function decodeUploadMetadata(raw) {
  if (!raw) return {};
  return Object.fromEntries(
    raw.split(',').map((pair) => {
      const [key, b64] = pair.trim().split(/\s+/, 2);
      try {
        return [key, b64 ? Buffer.from(b64, 'base64').toString('utf8') : ''];
      } catch {
        return [key, b64 ?? ''];
      }
    })
  );
}

Wormhole.use({
  name: 'pulsevault',
  start(api) {
    api.mount('/pulsevault', async (req, res, next) => {
      // Serve a hand-written Swagger page for this mount's raw TUS/artifact
      // routes — Wormhole's own /api/openapi.json only documents Meteor
      // methods, so these routes need their own doc page (see pulsevault-docs.js).
      const docsUrl = req.url.split('?')[0];
      if (req.method === 'GET' && docsUrl === '/openapi.json') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(pulsevaultOpenApiSpec));
        return;
      }
      if (req.method === 'GET' && docsUrl === '/docs') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(pulsevaultSwaggerHtml('/pulsevault/openapi.json'));
        return;
      }

      const eventsMatch = req.url.match(/^\/events\/([^/?]+)/);
      if (req.method === 'GET' && eventsMatch) {
        const artifactId = eventsMatch[1];
        const token = new URL(req.url, 'http://x').searchParams.get('token') ?? '';
        try {
          await verifyUploadToken(req, { artifactId, phase: 'create', token });
        } catch {
          res.writeHead(403);
          res.end();
          return;
        }
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
        res.write(':ok\n\n');
        if (!sseClients.has(artifactId)) sseClients.set(artifactId, new Set());
        sseClients.get(artifactId).add(res);
        const heartbeat = setInterval(() => { try { res.write(':\n\n'); } catch {} }, 25_000);
        req.on('close', () => {
          clearInterval(heartbeat);
          sseClients.get(artifactId)?.delete(res);
        });
        return;
      }

      const logCtx = {
        'upload-offset': req.headers['upload-offset'],
        'upload-length': req.headers['upload-length'],
        'content-length': req.headers['content-length'],
        'tus-resumable': req.headers['tus-resumable'],
        authorization: req.headers.authorization ? 'present' : 'missing',
      };

      // Decode Upload-Metadata on POST (TUS upload creation) so we can see what
      // artifactId/kind/filename the client is sending and whether it was reserved.
      if (req.method === 'POST') {
        const meta = decodeUploadMetadata(req.headers['upload-metadata']);
        const artifactId = meta.artifactId ?? meta.videoid ?? meta.projectid ?? '(missing)';
        logCtx['meta.artifactId'] = artifactId;
        logCtx['meta.filename'] = meta.filename ?? '(missing)';
        logCtx['meta.kind'] = meta.kind ?? 'video (default)';
        logCtx['meta.relatedTo'] = meta.relatedTo ?? null;
        logCtx['reservationExists'] = reservationContext.has(artifactId);
        console.log('[pulsevault][POST] decoded Upload-Metadata:', logCtx);
      }

      // Log Upload-Offset on PATCH — a mismatch vs the server's tracked offset is
      // the direct cause of a TUS 409 Conflict.
      if (req.method === 'PATCH') {
        console.log('[pulsevault][PATCH] offset info:', {
          url: req.url,
          'upload-offset': req.headers['upload-offset'],
          'upload-length': req.headers['upload-length'],
          'content-length': req.headers['content-length'],
        });
      }

      console.log('[pulsevault][req]', req.method, req.url, logCtx);

      const originalWriteHead = res.writeHead.bind(res);
      res.writeHead = function (status, ...args) {
        console.log('[pulsevault][res]', req.method, req.url, 'status:', status);

        // Capture response body for 4xx responses so we can see the TUS error string
        // (e.g. the exact reason behind a 409 Conflict).
        if (status >= 400) {
          const chunks = [];
          const originalWrite = res.write.bind(res);
          const originalEnd = res.end.bind(res);
          res.write = function (chunk, ...rest) {
            if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            return originalWrite(chunk, ...rest);
          };
          res.end = function (chunk, ...rest) {
            if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            const body = Buffer.concat(chunks).toString('utf8');
            console.error('[pulsevault][res] error body', req.method, req.url, 'status:', status, 'body:', body);
            return originalEnd(chunk, ...rest);
          };
        }

        return originalWriteHead(status, ...args);
      };

      // A mobile client aborting mid-upload (backgrounded, network drop, user
      // cancel) fires an 'error' event on the request stream. With no listener,
      // Node treats that as unhandled and crashes the whole process — not just
      // this request. Attaching a listener (even a no-op) marks it handled.
      req.on('error', (err) => {
        console.warn('[pulsevault] request stream aborted:', err.code || err.message);
      });

      // A retried TUS create (POST) whose earlier attempt never finished (e.g.
      // the request stream aborted with ECONNRESET) leaves a stale "uploading"
      // sidecar behind. pulsevault's reserveUpload uses exclusive file create,
      // so every retry with the same artifactId would 409 forever. If the
      // artifact isn't `ready` (resolve() returns null), remove the stale state
      // so the retry can succeed. If it IS `ready` but still has an unconsumed
      // reservation, the upload finished but `onUploadComplete` never ran (e.g.
      // restart in between) — finalize the attachment now so the video isn't
      // orphaned; the retry still 409s, correctly, since the bytes are on disk.
      const staleCleanup = (async () => {
        if (req.method !== 'POST') return;
        const meta = decodeUploadMetadata(req.headers['upload-metadata']);
        const artifactId = meta.artifactId ?? meta.videoid ?? meta.projectid;
        if (!artifactId) return;
        try {
          // Only act for callers holding a valid capability token for this
          // artifactId — otherwise an unauthenticated POST could delete
          // someone else's in-progress upload.
          await verifyUploadToken(req, { artifactId, phase: 'create' });
        } catch {
          return; // core.handler will reject it with the proper 401/403
        }
        try {
          const ready = await storage.resolve(artifactId);
          if (!ready) {
            // Age-gate the removal: a still-uploading artifact's on-disk file
            // is touched on every PATCH chunk, so a recent mtime means the
            // original transfer is (or very recently was) actively writing —
            // don't sweep it out from under itself. Only clear state once
            // it's been idle long enough to be confident it really aborted.
            // No local path / no file yet (fresh create, no bytes written)
            // is also treated as "too new to clean up" — fail safe.
            const localPath = await storage.getLocalPath(artifactId);
            const stats = localPath ? await stat(localPath).catch(() => null) : null;
            // No local path means no bytes were ever written — treat as past-idle so it gets cleared.
            const idleMs = stats ? Date.now() - stats.mtimeMs : STALE_UPLOAD_IDLE_MS + 1;
            if (idleMs < STALE_UPLOAD_IDLE_MS) {
              console.log('[pulsevault] skipping stale cleanup, upload looks active:', artifactId, 'idleMs:', idleMs);
              return;
            }
            const removed = await storage.remove(artifactId);
            if (removed) console.log('[pulsevault] cleared stale unfinished upload for retry:', artifactId);
            return;
          }
          const reservation = await takeReservation(artifactId);
          if (reservation) {
            console.log('[pulsevault] finalizing orphaned ready upload:', artifactId);
            await attachUploadedVideo(artifactId, reservation);
          }
          notifySseClients(artifactId, ready);
        } catch (err) {
          console.warn('[pulsevault] stale-upload cleanup failed (continuing):', artifactId, err.message);
        }
      })();

      staleCleanup
        .then(() => core.handler(req, res, next))
        .catch((err) => {
          console.error('[pulsevault] handler error:', err);
          if (!res.headersSent) {
            res.writeHead(500);
            res.end();
          }
        });
    });
    console.log('[pulsevault] @mieweb/pulsevault mounted at /pulsevault via Wormhole plugin');
  },
});

function mintUploadToken(artifactId) {
  return issueCapabilityToken(artifactId, CAPABILITY_SECRET, {
    keyId: CAPABILITY_KEY_ID,
    issuer: ISSUER,
  });
}

Meteor.methods({
  async 'pulsevault.reserve'({ ticketId, existingVideoid, target } = {}) {
    const identity = await requireIdentity(this);

    // The web client caches the last reserved videoid per ticket
    // (localStorage `pulsevault:ticket:<id>`) so a re-opened QR modal can
    // resume an interrupted upload. But if that upload actually FINISHED,
    // reusing the id is always wrong: the artifact file already exists, so
    // PulseCam's create POST hard-409s ("rejected by server"), and the fresh
    // reservation we'd record here would make the retry re-attach the same
    // old video to the ticket again. If the cached id is already `ready` on
    // disk, ignore it and mint a fresh videoid — the client persists the
    // videoid we return, so its stale cache self-heals.
    let videoid = existingVideoid ?? null;
    if (videoid) {
      try {
        const alreadyDone = await storage.resolve(videoid);
        if (alreadyDone) {
          console.log('[pulsevault] reserve: ignoring completed existingVideoid', videoid);
          videoid = null;
        } else {
          // Not finished yet. Any signed-in user could otherwise pass an
          // arbitrary in-progress existingVideoid and get a valid capability
          // token minted for it — which would also let them trigger the
          // stale-cleanup path against someone else's upload, and would
          // overwrite the original reservation's userId below, misattaching
          // the finished video to the wrong user's ticket. Only reuse it if
          // the caller is the one who originally reserved it (or nobody has
          // a tracked reservation for it at all, e.g. it expired).
          const existingReservation = await peekReservation(videoid);
          if (existingReservation && existingReservation.userId !== identity.userId) {
            console.warn(
              '[pulsevault] reserve: rejecting existingVideoid owned by another user',
              videoid,
            );
            videoid = null;
          }
        }
      } catch {
        videoid = null; // malformed id — start fresh
      }
    }
    videoid = videoid ?? randomUUID();
    const uploadToken = mintUploadToken(videoid);

    if (target === 'library' || !ticketId) {
      await persistReservation(videoid, { userId: identity.userId, target: 'library' });
    } else {
      const ticket = await rawDb().collection('tickets').findOne({ _id: new ObjectId(ticketId) });
      if (!ticket) throw new Meteor.Error('not-found', 'Ticket not found');
      await persistReservation(videoid, { userId: identity.userId, ticketId });
    }

    return { videoid, uploadToken };
  },

  async 'pulsevault.reserveForLibrary'() {
    const identity = await requireIdentity(this);
    const videoid = randomUUID();
    const uploadToken = mintUploadToken(videoid);
    await persistReservation(videoid, { userId: identity.userId, target: 'library' });
    return { videoid, uploadToken };
  },

  /**
   * Get a single video from the media library by its artifactId (videoid).
   * Returns the video metadata and a ready-to-use playback URL.
   */
  async 'pulsevault.getVideo'({ artifactId } = {}) {
    await requireIdentity(this);
    if (!artifactId || typeof artifactId !== 'string') {
      throw new Meteor.Error('bad-request', 'artifactId is required');
    }
    const doc = await rawDb().collection('mediaitems').findOne({ videoid: artifactId });
    if (!doc) throw new Meteor.Error('not-found', 'Video not found');
    return {
      artifactId: doc.videoid,
      mediaId: String(doc._id),
      url: doc.url ?? `${ISSUER}/pulsevault/artifacts/${doc.videoid}`,
      title: doc.title ?? null,
      mimeType: doc.mimeType ?? 'video/mp4',
      size: doc.size ?? 0,
      thumbnail: doc.thumbnail ?? null,
      uploadedAt: doc.uploadedAt ?? null,
    };
  },

  /**
   * List videos from the media library for the calling user.
   * Filters to type='video' so images are excluded.
   */
  async 'pulsevault.listVideos'({ limit } = {}) {
    const identity = await requireIdentity(this);
    const safeLimit = Math.min(Math.max(1, limit ?? 50), 100);
    const docs = await rawDb()
      .collection('mediaitems')
      .find({ userId: identity.userId, type: 'video' })
      .sort({ uploadedAt: -1 })
      .limit(safeLimit)
      .toArray();
    return {
      videos: docs.map((doc) => ({
        artifactId: doc.videoid,
        mediaId: String(doc._id),
        url: doc.url ?? `${ISSUER}/pulsevault/artifacts/${doc.videoid}`,
        title: doc.title ?? null,
        mimeType: doc.mimeType ?? 'video/mp4',
        size: doc.size ?? 0,
        thumbnail: doc.thumbnail ?? null,
        uploadedAt: doc.uploadedAt ?? null,
      })),
    };
  },
});
