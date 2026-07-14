/**
 * PulseVault — video upload + serving for Meteor, backed by the real
 * `@mieweb/pulsevault` package (framework-agnostic core) instead of a
 * hand-rolled TUS server. Mounted on `WebApp.connectHandlers` per the
 * package's documented Meteor integration pattern.
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
import { WebApp } from 'meteor/webapp';
import { Meteor } from 'meteor/meteor';
import { MongoInternals } from 'meteor/mongo';
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
import { randomUUID } from 'crypto';
import path from 'path';

const { ObjectId } = MongoInternals.NpmModules.mongodb.module;

// Reuse the same directory/env-var convention as uploads.js's `VIDEOS_DIR`
// (used there to clean up video files on `media.remove`).
const VIDEOS_DIR = process.env.VIDEOS_DIR || path.resolve(process.cwd(), 'data/videos');

const CAPABILITY_KEY_ID = 'v1';
const CAPABILITY_SECRET = process.env.PULSEVAULT_SECRET || 'dev-insecure-pulsevault-secret';
const ISSUER = process.env.ROOT_URL;

function lookupCapabilitySecret(kid) {
  return kid === CAPABILITY_KEY_ID ? CAPABILITY_SECRET : null;
}

const verifyUploadToken = createCapabilityAuthorize(lookupCapabilitySecret, { issuer: ISSUER });

/**
 * artifactId -> { userId, ticketId } | { userId, target: 'library' }
 * Reservations are short-lived (capability tokens expire in 30 min by
 * default), so an in-memory map is fine — a server restart mid-upload just
 * means the client has to re-scan the QR code, same tradeoff the previous
 * hand-rolled reservation store made.
 */
const reservationContext = new Map();

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
    console.log('[pulsevault][hook] reservationContext keys:', [...reservationContext.keys()]);
    const reservation = reservationContext.get(ctx.artifactId);
    reservationContext.delete(ctx.artifactId);
    if (!reservation) {
      console.log('[pulsevault][hook] onUploadComplete: NO reservation context for', ctx.artifactId);
      return;
    }
    console.log('[pulsevault][hook] onUploadComplete: found reservation', JSON.stringify(reservation));

    const videoUrl = `${ISSUER}/pulsevault/artifacts/${ctx.artifactId}`;
    const title = `Video ${ctx.artifactId.slice(0, 8)}`;

    if (reservation.target === 'library') {
      await rawDb().collection('mediaitems').insertOne({
        _id: new ObjectId(),
        userId: reservation.userId,
        type: 'video',
        mimeType: 'video/mp4',
        url: videoUrl,
        videoid: ctx.artifactId,
        filename: `${ctx.artifactId}.mp4`,
        size: ctx.size ?? 0,
        title,
        caption: null,
        altText: null,
        thumbnail: null,
        uploadedAt: new Date(),
      });
      console.log('[pulsevault] created media item for library upload:', ctx.artifactId);
    } else {
      await createAttachment({
        url: videoUrl,
        type: 'video',
        title,
        attachedTo: { kind: 'ticket', id: reservation.ticketId },
        addedBy: reservation.userId,
      });
      console.log('[pulsevault] created attachment for ticket:', reservation.ticketId, 'video:', ctx.artifactId);
    }
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

WebApp.connectHandlers.use('/pulsevault', (req, res, next) => {
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
  core.handler(req, res, next).catch((err) => {
    console.error('[pulsevault] handler error:', err);
    if (!res.headersSent) {
      res.writeHead(500);
      res.end();
    }
  });
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
    const videoid = existingVideoid ?? randomUUID();
    const uploadToken = mintUploadToken(videoid);

    if (target === 'library' || !ticketId) {
      reservationContext.set(videoid, { userId: identity.userId, target: 'library' });
    } else {
      const ticket = await rawDb().collection('tickets').findOne({ _id: new ObjectId(ticketId) });
      if (!ticket) throw new Meteor.Error('not-found', 'Ticket not found');
      reservationContext.set(videoid, { userId: identity.userId, ticketId });
    }

    return { videoid, uploadToken };
  },

  async 'pulsevault.reserveForLibrary'() {
    const identity = await requireIdentity(this);
    const videoid = randomUUID();
    const uploadToken = mintUploadToken(videoid);
    reservationContext.set(videoid, { userId: identity.userId, target: 'library' });
    return { videoid, uploadToken };
  },
});

console.log('[pulsevault] @mieweb/pulsevault mounted at /pulsevault');
