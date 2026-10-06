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
 *     artifactId + a short-lived HMAC capability token whose `context` says
 *     who reserved it and where the video goes (a ticket, a Redmine issue, or
 *     the media library). Nothing is recorded here: PulseVault stores the
 *     context with the upload it authorizes.
 *  2. The Pulse app or web fallback uploads bytes via TUS to
 *     `/pulsevault/upload`, authenticated by that capability token. PulseVault
 *     holds every create to the shape of a pulse (the video under the token's
 *     own id, its thumbnail/manifest/captions under their own ids `relatedTo`
 *     it), lets a re-scan of the same link take over an upload the app
 *     abandoned, and refuses to delete a video once it has landed.
 *  3. `onUploadComplete` gets that context back and creates the ticket
 *     attachment / media-library item. PulseVault fires it again if it threw
 *     or the server restarted first, so it is idempotent on the video id.
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
import { requireIdentity } from './auth-bridge.js';
import { createAttachment } from './attachments.js';
import { REDMINE, resolveTicketRef } from './ticket-refs.js';
import { requireTeamMembership } from './permissions.js';
import { pulsevaultOpenApiSpec, pulsevaultSwaggerHtml } from './pulsevault-docs.js';
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

/**
 * Verify a PulseVault capability token. Exported so the `/pulse/open` scan
 * interstitial can reject a made-up token before rendering a page that would
 * otherwise hand Pulse Cam a live-looking upload session (see pulse-link.js).
 * On a `create` it also holds the upload to the shape of a pulse.
 */
export const verifyUploadToken = createCapabilityAuthorize(lookupCapabilitySecret, {
  issuer: ISSUER,
});

/**
 * Whether `userId` is the person who uploaded this artifact.
 *
 * For any caller that takes an artifact id from the client and stores it as
 * evidence: without this, a `videoid` is just a string the client asserts, so
 * one user could cite another's recording — or one that doesn't exist.
 *
 * Falls back to the upload's own record in PulseVault because
 * `onUploadComplete` writes the media record asynchronously, and the client
 * can legitimately submit in the window before it lands. That record only
 * exists once the upload was created (bytes may still be arriving), so a
 * reservation that was never used can't be cited as evidence.
 */
export async function artifactBelongsTo(artifactId, userId) {
  if (!artifactId || !userId) return false;
  const media = await rawDb()
    .collection('mediaitems')
    .findOne({ videoid: artifactId }, { projection: { userId: 1 } });
  if (media) return media.userId === userId;

  // The status describes whatever artifact the id names (a thumbnail's or
  // captions' id carries its owner's context too), and exists from the moment
  // the upload was created — so it must be a video, and bytes must have
  // arrived: a reservation that was never used is not evidence.
  const status = await core.getStatus(artifactId).catch(() => null);
  if (!status || status.kind !== 'video' || status.context?.userId !== userId) return false;
  return status.state === 'ready' || status.state === 'processing' || (status.bytesReceived ?? 0) > 0;
}

/**
 * Playback path for an artifact — stored path-only, never host-qualified.
 *
 * ISSUER (ROOT_URL) is the address the backend answered on when the upload
 * happened, which is not a property of the video: in dev the stack is served
 * from the machine's LAN IP, so every DHCP lease change used to orphan every
 * previously-uploaded clip. Clients re-attach their current backend origin at
 * read time (`resolveMediaUrl` in src/lib/api.ts).
 */
function artifactPath(artifactId) {
  return `/pulsevault/artifacts/${artifactId}`;
}

/**
 * Extension → MIME for every video container accepted here: `.mp4` from the
 * Pulse app, and `.mov`/`.m4v` from the iOS camera roll through the web
 * fallback (ISO-BMFF like `.mp4`, so `createMp4Sniffer` accepts them;
 * PulseVault serves them with these types). Also the `mimeType` recorded on
 * the media item.
 */
const VIDEO_CONTENT_TYPES = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.m4v': 'video/x-m4v',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The reserved destination no longer exists. The one failure that settles an
 * upload as kept: anything else thrown from the attach is left for PulseVault
 * to replay.
 */
function destinationGone(message) {
  return Object.assign(new Error(message), { statusCode: 404 });
}

/**
 * Create the mediaitems doc / ticket attachment for a finished upload.
 * Idempotent on the video: PulseVault may fire the completion again if this
 * threw or the server restarted before it recorded the first one.
 */
async function attachUploadedVideo({ artifactId, ext, size }, { userId, target, ticketId }) {
  const videoUrl = artifactPath(artifactId);
  const title = `Video ${artifactId.slice(0, 8)}`;
  const mimeType = VIDEO_CONTENT_TYPES[ext] ?? 'video/mp4';

  if (target === 'library') {
    const media = rawDb().collection('mediaitems');
    const existing = await media.findOne({ videoid: artifactId }, { projection: { _id: 1 } });
    if (existing) return 'Added to the media library'; // a replay
    await media.insertOne({
      _id: new ObjectId(),
      userId,
      type: 'video',
      mimeType,
      url: videoUrl,
      videoid: artifactId,
      filename: `${artifactId}${ext}`,
      size,
      title,
      caption: null,
      altText: null,
      thumbnail: null,
      uploadedAt: new Date(),
    });
    console.log('[pulsevault] created media item for library upload:', artifactId);
    return 'Added to the media library';
  }

  const attachedTo = { kind: target === REDMINE ? REDMINE : 'ticket', id: ticketId };
  const existing = await rawDb()
    .collection('attachments')
    .findOne(
      { url: videoUrl, 'attachedTo.kind': attachedTo.kind, 'attachedTo.id': attachedTo.id },
      { projection: { _id: 1 } },
    );
  const note = `Attached to ${attachedTo.kind} ${ticketId}`;
  if (existing) return note; // a replay
  if (attachedTo.kind === 'ticket') {
    // `tickets.delete` soft-deletes (status: 'deleted'), so a deleted ticket still has a document.
    const ticket = await rawDb()
      .collection('tickets')
      .findOne({ _id: new ObjectId(ticketId), status: { $ne: 'deleted' } }, { projection: { _id: 1 } });
    if (!ticket) throw destinationGone(`Ticket ${ticketId} was deleted while the video was uploading`);
  } else {
    // The Redmine issue was checked at reserve time; check again now, with the uploader's
    // key. Gone for good → kept. Redmine unreachable, rate-limited or the key rejected → thrown,
    // so PulseVault tries the delivery again later.
    try {
      await resolveTicketRef(userId, REDMINE, ticketId);
    } catch (err) {
      if (err?.error === 'not-found') {
        throw destinationGone(`Redmine issue ${ticketId} was deleted while the video was uploading`);
      }
      throw err;
    }
  }
  await createAttachment({ url: videoUrl, type: 'video', title, attachedTo, addedBy: userId });
  console.log('[pulsevault] created attachment for', attachedTo.kind, ticketId, 'video:', artifactId);
  return note;
}

const storage = createLocalStorage({ workspaceDir: VIDEOS_DIR });

const core = createPulseVaultCore({
  storage,
  basePath: '/pulsevault',
  // WebApp.connectHandlers.use('/pulsevault', ...) already strips the mount
  // prefix before calling the handler — per the package's Meteor integration docs.
  stripBasePath: false,
  maxUploadSize: 500 * 1024 * 1024, // 500 MB
  // Uploads a client abandoned, and the captions, manifest or thumbnail of a
  // video that never finished, are removed after a day: well above the
  // capability token's lifetime, past which no upload can continue anyway.
  retention: { abandonedAfterSeconds: 24 * 60 * 60 },
  // A video that landed stays: its pairing token can no longer delete it, nor
  // the files related to it.
  lockWhenReady: true,
  // Web-playability backstop: phones routinely upload MP4s with the moov atom
  // at the end (a stall before frame one) or HEVC video (undecodable in
  // Firefox and most Chrome). PulseVault fixes each video once, in the
  // background after Pulse's final PATCH is answered, and only then calls
  // `onUploadComplete` — so nothing is attached while its bytes are still
  // being rewritten. Fail-open: without ffmpeg on PATH it serves the original.
  webReady: { completeAfter: true },
  // A pulse uploads a .pulse beat manifest, .vtt captions and a .jpg
  // thumbnail alongside its video, so every kind is accepted. Video is
  // derived from VIDEO_CONTENT_TYPES so the accepted extensions can't drift
  // from the ones recorded on media items.
  allowedExtensions: {
    video: Object.keys(VIDEO_CONTENT_TYPES),
    project: ['.pulse', '.zip'],
    captions: ['.vtt', '.srt'],
    thumbnail: ['.jpg', '.jpeg', '.png'],
  },
  authorize: async (request, ctx) => {
    console.log('[pulsevault][hook] authorize called', {
      phase: ctx.phase,
      artifactId: ctx.artifactId,
      kind: ctx.kind,
      relatedTo: ctx.relatedTo ?? null,
      hasToken: !!(ctx.token || request.headers.authorization),
    });
    if (ctx.phase === 'resolve') {
      // Artifact playback is public — no auth required.
      return undefined;
    }
    try {
      // Returns the token's context on `create`, which PulseVault stores with
      // the upload and hands back to `onUploadComplete`.
      const result = await verifyUploadToken(request, ctx);
      console.log('[pulsevault][hook] authorize PASSED', ctx.phase, ctx.artifactId);
      return result;
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
    console.log('[pulsevault][hook] onUploadComplete', ctx.artifactId, ctx.kind, ctx.replay ? '(replay)' : '');
    // Only the video is attached: its captions, manifest and thumbnail are
    // separate artifacts, found from the video at read time.
    if (ctx.kind !== 'video') return;
    const reservation = ctx.context;
    if (!reservation?.userId) {
      console.log('[pulsevault][hook] onUploadComplete: no reservation context for', ctx.artifactId);
      await core.recordOutcome(ctx.artifactId, { state: 'kept', reason: 'No reservation on this upload' });
      return;
    }
    try {
      const note = await attachUploadedVideo(ctx, reservation);
      await core.recordOutcome(ctx.artifactId, { state: 'done', note });
    } catch (err) {
      // Only a destination that's gone for good settles the upload as kept
      // (the video stays in storage, and the status route says why). Anything
      // else is thrown, so PulseVault replays the completion.
      if (err.statusCode !== 404) throw err;
      console.warn('[pulsevault] kept', ctx.artifactId, err.message);
      await core.recordOutcome(ctx.artifactId, { state: 'kept', reason: err.message });
    }
  },
  onArtifactEvent: (event) => {
    if (event.phase === 'processed' && event.webReady?.action !== 'none') {
      console.log('[pulsevault] web-ready', event.artifactId, event.webReady);
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

      const logCtx = {
        'upload-offset': req.headers['upload-offset'],
        'upload-length': req.headers['upload-length'],
        'content-length': req.headers['content-length'],
        'tus-resumable': req.headers['tus-resumable'],
        authorization: req.headers.authorization ? 'present' : 'missing',
      };

      // Decode Upload-Metadata on POST (TUS upload creation) so we can see what
      // artifactId/kind/filename the client is sending.
      if (req.method === 'POST') {
        const meta = decodeUploadMetadata(req.headers['upload-metadata']);
        logCtx['meta.artifactId'] = meta.artifactId ?? meta.videoid ?? meta.projectid ?? '(missing)';
        logCtx['meta.filename'] = meta.filename ?? '(missing)';
        logCtx['meta.kind'] = meta.kind ?? 'video (default)';
        logCtx['meta.relatedTo'] = meta.relatedTo ?? null;
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

      core.handler(req, res, next).catch((err) => {
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

Meteor.startup(async () => {
  await storage.initialize();
  // Completions that never finished (the attach threw, or the server restarted
  // between the final byte and the attach) are delivered now, and every five
  // minutes after.
  const replayed = await core.replayCompletions();
  if (replayed.length) console.log('[pulsevault] replayed', replayed.length, 'completion(s):', replayed.join(', '));
});

/** The capability token for one reservation: who, and where the video goes. */
function mintUploadToken(artifactId, context) {
  return issueCapabilityToken(artifactId, CAPABILITY_SECRET, {
    keyId: CAPABILITY_KEY_ID,
    issuer: ISSUER,
    context,
  });
}

Meteor.methods({
  async 'pulsevault.reserve'({ ticketId, existingVideoid, target } = {}) {
    const identity = await requireIdentity(this);

    // The web client caches the last reserved videoid per ticket
    // (localStorage `pulsevault:ticket:<id>`) so a re-opened QR modal can
    // resume an interrupted upload. But if that upload actually FINISHED,
    // reusing the id is always wrong: the artifact already exists, so
    // PulseCam's create POST hard-409s ("rejected by server"). And an
    // unfinished upload may only be resumed by the person who reserved it:
    // any signed-in user could otherwise pass an arbitrary in-progress
    // id and get a token minted for it. The upload's own context says who.
    // Only a well-formed id is reused (getStatus reports anything else as
    // `unknown`), and only a video's: a thumbnail's id would 409 the video.
    let videoid = null;
    if (typeof existingVideoid === 'string' && UUID_RE.test(existingVideoid)) {
      try {
        const status = await core.getStatus(existingVideoid);
        if (
          status.state === 'unknown' ||
          (status.state === 'uploading' &&
            status.kind === 'video' &&
            status.context?.userId === identity.userId)
        ) {
          videoid = existingVideoid;
        } else {
          console.log('[pulsevault] reserve: not reusing existingVideoid', existingVideoid, status.state);
        }
      } catch (err) {
        console.warn('[pulsevault] reserve: could not read existingVideoid', existingVideoid, err.message);
      }
    }
    videoid = videoid ?? randomUUID();

    let reservation;
    if (target === 'library' || !ticketId) {
      reservation = { userId: identity.userId, target: 'library' };
    } else if (target === REDMINE) {
      await resolveTicketRef(identity.userId, REDMINE, ticketId);
      reservation = { userId: identity.userId, target: REDMINE, ticketId };
    } else {
      const ticket = await rawDb()
        .collection('tickets')
        .findOne({ _id: new ObjectId(ticketId), status: { $ne: 'deleted' } });
      if (!ticket) throw new Meteor.Error('not-found', 'Ticket not found');
      // Only someone who can see the ticket's team may mint an upload for it — the same
      // check as reading the ticket, unconditional like there: a ticket without a valid team
      // is refused, not open to everyone. A token is a capability to attach to this ticket.
      await requireTeamMembership(identity.userId, String(ticket.teamId ?? ''));
      reservation = { userId: identity.userId, target: 'ticket', ticketId };
    }

    return { videoid, uploadToken: mintUploadToken(videoid, reservation) };
  },

  async 'pulsevault.reserveForLibrary'() {
    const identity = await requireIdentity(this);
    const videoid = randomUUID();
    return {
      videoid,
      uploadToken: mintUploadToken(videoid, { userId: identity.userId, target: 'library' }),
    };
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
      url: doc.url ?? artifactPath(doc.videoid),
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
        url: doc.url ?? artifactPath(doc.videoid),
        title: doc.title ?? null,
        mimeType: doc.mimeType ?? 'video/mp4',
        size: doc.size ?? 0,
        thumbnail: doc.thumbnail ?? null,
        uploadedAt: doc.uploadedAt ?? null,
      })),
    };
  },
});
