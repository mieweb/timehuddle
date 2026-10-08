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
 * One link, one upload, one destination:
 *  1. `pulsevault.reserve` mints an artifactId + a short-lived HMAC capability
 *     token whose `context` says who reserved it and where the video goes
 *     (see pulse-destinations.js). Nothing is recorded here: PulseVault
 *     stores the context with the upload it authorizes.
 *  2. The Pulse app or web fallback uploads bytes via TUS to
 *     `/pulsevault/upload`, authenticated by that capability token. PulseVault
 *     holds every create to the shape of a pulse (the video under the token's
 *     own id, its thumbnail/manifest/captions under their own ids `relatedTo`
 *     it), lets a re-scan of the same link take over an upload the app
 *     abandoned, and refuses to delete a video once it has landed.
 *  3. `onUploadComplete` gets that context back and delivers the video to its
 *     destination. PulseVault fires it again if it threw or the server
 *     restarted first, so delivery is idempotent on the video id.
 */
import { Meteor } from 'meteor/meteor';
import { Wormhole } from 'meteor/wreiske:meteor-wormhole';
import {
  createPulseVaultCore,
  createLocalStorage,
  createVideoValidator,
  issueCapabilityToken,
  createCapabilityAuthorize,
} from '@mieweb/pulsevault/core';
import { rawDb } from './collections.js';
import { requireIdentity } from './auth-bridge.js';
import { deliverPulseVideo, resolvePulseDestination } from './pulse-destinations.js';
import { pulsevaultOpenApiSpec, pulsevaultSwaggerHtml } from './pulsevault-docs.js';
import { randomUUID } from 'crypto';
import path from 'path';

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
 * Pulse app, and whatever a file picker hands over (a camera-roll `.mov`, a
 * browser recording's `.webm`, …). Conform (`webReady`) turns each into an
 * `.mp4` once it lands; a video it couldn't convert keeps its own type.
 */
const VIDEO_CONTENT_TYPES = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.m4v': 'video/x-m4v',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.3gp': 'video/3gpp',
  '.avi': 'video/x-msvideo',
};

/**
 * The video a finished upload delivers, as pulse-destinations.js takes it.
 * `name` is the Pulse draft's title (`Upload-Metadata.name`), when sent.
 * `ext` is the uploaded file's; anything conform didn't skip is served as an MP4.
 */
function describeVideo({ artifactId, ext, size, name, webReady }) {
  const servedExt = webReady && webReady.action !== 'skipped' ? '.mp4' : ext;
  return {
    artifactId,
    url: artifactPath(artifactId),
    name: name || null,
    title: `Video ${artifactId.slice(0, 8)}`,
    filename: `${artifactId}${servedExt}`,
    mimeType: VIDEO_CONTENT_TYPES[servedExt] ?? 'video/mp4',
    size,
  };
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
  // Conform: every finished video is served in the one format the Pulse app
  // records (faststart H.264/AAC MP4, longest edge ≤ 1920, orientation kept);
  // a Pulse upload is left as it is. Runs in the background after the final
  // PATCH, one at a time, and only then calls `onUploadComplete` — so nothing
  // is delivered while its bytes are still being rewritten. Without ffmpeg on
  // PATH it serves the original (see the startup check below).
  webReady: { completeAfter: true, concurrency: 1 },
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
  validatePayload: createVideoValidator(),
  onUploadComplete: async (_request, ctx) => {
    console.log('[pulsevault][hook] onUploadComplete', ctx.artifactId, ctx.kind, ctx.replay ? '(replay)' : '');
    // Only the video is attached: its captions, manifest and thumbnail are
    // separate artifacts, found from the video at read time.
    if (ctx.kind !== 'video') return;
    const userId = ctx.context?.userId;
    const destination = destinationOf(ctx.context ?? {});
    if (!userId || !destination) {
      console.log('[pulsevault][hook] onUploadComplete: no destination on', ctx.artifactId);
      await core.recordOutcome(ctx.artifactId, { state: 'kept', reason: 'No destination on this upload' });
      return;
    }
    // `kept` when the destination is gone for good; anything else throws, so
    // PulseVault replays the completion.
    const outcome = await deliverPulseVideo(userId, destination, describeVideo(ctx));
    await core.recordOutcome(ctx.artifactId, outcome);
    console.log('[pulsevault]', outcome.state, ctx.artifactId, outcome.note ?? outcome.reason);
  },
  onArtifactEvent: (event) => {
    if (event.phase === 'processed' && event.webReady?.action !== 'none') {
      console.log('[pulsevault] web-ready', event.artifactId, event.webReady);
    }
  },
});

// Without ffmpeg every upload still works, but is served as uploaded: an
// iPhone HEVC or a WebM then won't play in every browser. Said once, loudly.
Meteor.startup(async () => {
  if (!(await core.conformAvailable())) {
    console.error('[pulsevault] conform unavailable: ffmpeg/ffprobe not on PATH — videos are served as uploaded');
  }
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

/**
 * The destination an upload's context names. Until this deploy `reserve`
 * signed `{ target, ticketId }` instead (#644), and a link token lives 30
 * minutes, so an upload minted just before it can still complete — or have its
 * completion replayed — after. Remove once that window has passed.
 */
function destinationOf({ destination, target, ticketId }) {
  if (destination) return destination;
  if (!target) return null;
  if (target === 'library' || !ticketId) return { kind: 'library' };
  return { kind: target, id: ticketId };
}

Meteor.methods({
  /**
   * Reserve one Pulse upload: a fresh video id and a link token for it that
   * carries where the finished video goes (`destination`, see
   * pulse-destinations.js). The server delivers it there when the upload
   * completes — the client has nothing left to do.
   */
  async 'pulsevault.reserve'({ destination } = {}) {
    const identity = await requireIdentity(this);
    const resolved = await resolvePulseDestination(identity.userId, destination);
    // Always a fresh id: one link is one upload, and a re-scan of the same
    // link resumes it (PulseVault's `reclaim`).
    const videoid = randomUUID();
    return {
      videoid,
      uploadToken: mintUploadToken(videoid, { userId: identity.userId, destination: resolved }),
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
