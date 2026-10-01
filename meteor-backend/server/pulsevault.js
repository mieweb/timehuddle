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
 *  1. `pulsevault.reserve` mints a fresh artifactId + a 30-minute HMAC
 *     capability token (the Pulse link), and records the reservation's
 *     destination — a Huddle post, plan/wrap-up, ticket or clock-session
 *     attachment, or timesheet walkthrough (see pulse-destinations.js).
 *  2. The Pulse app uploads the bytes via TUS to `/pulsevault/upload`,
 *     authenticated by that token (and identified by `Pulse-Client`).
 *  3. `onUploadComplete` takes the reservation and delivers the video to its
 *     destination; the web app has nothing left to do.
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
  ensureWebReady,
} from '@mieweb/pulsevault/core';
import { rawDb } from './collections.js';
import { requireIdentity, resolveToken } from './auth-bridge.js';
import { deliverPulseVideo, resolvePulseDestination } from './pulse-destinations.js';
import { pulsevaultOpenApiSpec, pulsevaultSwaggerHtml } from './pulsevault-docs.js';
import { randomUUID } from 'crypto';
import path from 'path';
import { stat } from 'fs/promises';

const { ObjectId } = MongoInternals.NpmModules.mongodb.module;

// Where PulseVault keeps Pulse uploads (video, thumbnail, captions, beat
// manifest). Removal goes through `removeArtifact` below, never raw paths.
const VIDEOS_DIR = process.env.VIDEOS_DIR || path.resolve(process.cwd(), 'data/videos');

const CAPABILITY_KEY_ID = 'v1';
/**
 * How long a Pulse link works. One link = one upload: past this the token no
 * longer authorizes a create or PATCH, so its reservation is dead too.
 */
const UPLOAD_LINK_SECONDS = 30 * 60;
/**
 * Reservations outlive their link a little: an upload whose last PATCH lands
 * just before the link expires still needs its reservation when it completes.
 */
const RESERVATION_TTL_SECONDS = UPLOAD_LINK_SECONDS + 10 * 60;
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
  // Absolute on purpose, unlike stored URLs: SSE subscribers are off-device
  // (the Pulse app that scanned the QR code), so they have no "current backend
  // origin" to resolve a path against.
  const payload = JSON.stringify({
    artifactId,
    url: `${ISSUER}/pulsevault/artifacts/${artifactId}`,
    size: ready?.size ?? 0,
  });
  const event = `event: ready\ndata: ${payload}\n\n`;
  for (const res of clients) {
    // A subscriber that already hung up is not an error worth logging — the
    // upload succeeded either way, and this Set is dropped immediately below.
    try { res.write(event); } catch { /* subscriber gone */ }
    try { res.end(); } catch { /* subscriber gone */ }
  }
  sseClients.delete(artifactId);
}

function lookupCapabilitySecret(kid) {
  return kid === CAPABILITY_KEY_ID ? CAPABILITY_SECRET : null;
}

/**
 * Verify a PulseVault capability token. Exported so the `/pulse/open` scan
 * interstitial can reject a made-up token before rendering a page that would
 * otherwise hand Pulse Cam a live-looking upload session (see pulse-link.js).
 */
export const verifyUploadToken = createCapabilityAuthorize(lookupCapabilitySecret, {
  issuer: ISSUER,
});

/**
 * artifactId -> the reservation `{ userId, destination }`, in Mongo so it
 * survives server restarts — meteor hot-reloads on every server file change,
 * and a restart between upload-finish and `onUploadComplete` would otherwise
 * lose where the video goes. Mongo's TTL monitor expires a reservation with
 * its link, so an abandoned one simply disappears.
 */
const RESERVATIONS_COLL = 'pulsevault_reservations';
/**
 * Where each finished upload ended up — `{ kept, reason }` from
 * deliverPulseVideo — so the Pulse popup can say so. Kept as long as a
 * reservation would have been, then Mongo's TTL monitor clears it.
 */
const DELIVERIES_COLL = 'pulsevault_deliveries';

/** A stored reservation without its Mongo bookkeeping, or null. */
function reservationOf(doc) {
  if (!doc) return null;
  const { _id, createdAt, ...reservation } = doc;
  return reservation;
}

async function persistReservation(videoid, reservation) {
  await rawDb().collection(RESERVATIONS_COLL).updateOne(
    { _id: videoid },
    { $set: { ...reservation, createdAt: new Date() } },
    { upsert: true },
  );
}

/**
 * Fetch AND consume the reservation for an artifactId, in one step: if two
 * paths finish the same upload at once, only one of them gets to deliver it.
 */
async function takeReservation(artifactId) {
  const doc = await rawDb().collection(RESERVATIONS_COLL).findOneAndDelete({ _id: artifactId });
  return reservationOf(doc);
}

/**
 * Look up the reservation for an artifactId WITHOUT consuming it — used to
 * check who reserved an id before trusting it.
 */
async function peekReservation(artifactId) {
  return reservationOf(await rawDb().collection(RESERVATIONS_COLL).findOne({ _id: artifactId }));
}

/**
 * Whether `userId` is the person who uploaded this artifact.
 *
 * For any caller that takes an artifact id from the client and stores it as
 * evidence: without this, a `videoid` is just a string the client asserts, so
 * one user could cite another's recording — or one that doesn't exist.
 *
 * Falls back to the reservation because `onUploadComplete` writes the media
 * record asynchronously, and the client can legitimately submit in the window
 * before it lands. A reservation only proves an id was minted, though, so that
 * path also has to see bytes on disk — otherwise reserving and never uploading
 * would mint citable evidence for a video that does not exist.
 */
export async function artifactBelongsTo(artifactId, userId) {
  if (!artifactId || !userId) return false;
  const media = await rawDb()
    .collection('mediaitems')
    .findOne({ videoid: artifactId }, { projection: { userId: 1 } });
  if (media) return media.userId === userId;

  const reservation = await peekReservation(artifactId);
  if (reservation?.userId !== userId) return false;
  return Boolean(await storage.getLocalPath(artifactId).catch(() => null));
}

Meteor.startup(async () => {
  const coll = rawDb().collection(RESERVATIONS_COLL);
  // Reservations expire with their link (plus a margin); Mongo's TTL monitor
  // clears the dead ones. An index made with an older TTL is updated in place.
  await coll
    .createIndex({ createdAt: 1 }, { expireAfterSeconds: RESERVATION_TTL_SECONDS })
    .catch(() =>
      rawDb().command({
        collMod: RESERVATIONS_COLL,
        index: { keyPattern: { createdAt: 1 }, expireAfterSeconds: RESERVATION_TTL_SECONDS },
      }),
    )
    .catch((err) => {
      console.warn('[pulsevault] reservations TTL index failed:', err.message);
    });
  await rawDb()
    .collection(DELIVERIES_COLL)
    .createIndex({ createdAt: 1 }, { expireAfterSeconds: RESERVATION_TTL_SECONDS })
    .catch((err) => {
      console.warn('[pulsevault] deliveries TTL index failed:', err.message);
    });
});

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
 * Extension → MIME for every video container PulseVault accepts.
 *
 * Single source for three things that must agree: which extensions the tus
 * create POST allows, the `Content-Type` the GET route serves, and the
 * `mimeType`/`filename` recorded on the media item.
 *
 * `.mov`/`.m4v` are what the iOS camera roll and the native video picker hand
 * back — they're ISO-BMFF like `.mp4`, so `createMp4Sniffer` accepts them.
 */
const VIDEO_CONTENT_TYPES = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.m4v': 'video/mp4',
};

/** Fallback when an artifact's stored extension can't be read back. */
const DEFAULT_VIDEO_EXT = '.mp4';

/**
 * The extension the bytes were actually stored under.
 *
 * Read from storage rather than assumed, so a `.mov` from an iPhone isn't
 * recorded in the media library as an mp4 — which would both mislabel its
 * `mimeType` and hand the user a `.mp4` filename for a QuickTime file.
 * `getLocalPath` reads the sidecar, so this works before *and* after the
 * artifact is marked ready (i.e. from both `onUploadComplete` and the
 * orphaned-upload recovery path).
 */
async function artifactExt(artifactId) {
  const localPath = await storage.getLocalPath(artifactId).catch(() => null);
  const ext = localPath ? path.extname(localPath).toLowerCase() : '';
  return VIDEO_CONTENT_TYPES[ext] ? ext : DEFAULT_VIDEO_EXT;
}

/**
 * The destination a reservation was made for. Reservations from before
 * destinations existed carry `target: 'library'`, `attachedTo` or a bare
 * `ticketId` instead.
 */
function destinationOf(reservation) {
  if (reservation.destination) return reservation.destination;
  if (reservation.target === 'library') return { kind: 'library' };
  return reservation.attachedTo ?? { kind: 'ticket', id: reservation.ticketId };
}

/**
 * Deliver a finished upload to wherever its reservation said it goes (or keep
 * it in the uploader's library), and note which for `pulsevault.status`.
 */
async function attachUploadedVideo(artifactId, reservation, size = 0) {
  const ext = await artifactExt(artifactId);
  // Pulse sends the draft's title as `Upload-Metadata.name` (PROTOCOL.md §4.1);
  // it becomes the post text / attachment title. A short id when there's none.
  const name = (await storage.getName?.(artifactId).catch(() => null)) || null;
  const destination = destinationOf(reservation);
  const outcome = await deliverPulseVideo(reservation.userId, destination, {
    artifactId,
    url: artifactPath(artifactId),
    name,
    title: name || `Video ${artifactId.slice(0, 8)}`,
    filename: `${artifactId}${ext}`,
    mimeType: VIDEO_CONTENT_TYPES[ext],
    size,
    thumbnail: null,
  });
  await rawDb()
    .collection(DELIVERIES_COLL)
    .updateOne(
      { _id: artifactId },
      { $set: { userId: reservation.userId, ...outcome, createdAt: new Date() } },
      { upsert: true },
    );
  console.log('[pulsevault]', outcome.kept ? 'kept' : 'delivered', artifactId, 'for', destination.kind);
}

/**
 * Delete an artifact's bytes and PulseVault record (e.g. when its media item is
 * removed). Accepts an id or a `/pulsevault/artifacts/<id>` path; anything
 * else is ignored.
 */
export async function removeArtifact(idOrPath) {
  if (!idOrPath) return;
  const match = String(idOrPath).match(/^(?:\/pulsevault\/artifacts\/)?([A-Za-z0-9._-]+)$/);
  if (!match) return;
  await storage.remove(match[1]).catch((err) => {
    console.warn('[pulsevault] remove failed:', match[1], err.message);
  });
}

const localStorage_ = createLocalStorage({ workspaceDir: VIDEOS_DIR });

// The package's ext→MIME map only knows `.mp4`, so every other video container
// resolves to `application/octet-stream` — which `<video>` refuses to play
// inline (it downloads instead). Correct it on the way out.
const storage = {
  ...localStorage_,
  resolve: async (artifactId) => {
    const resolved = await localStorage_.resolve(artifactId);
    if (resolved?.contentType !== 'application/octet-stream') return resolved;
    const fixup = VIDEO_CONTENT_TYPES[path.extname(resolved.filename ?? '').toLowerCase()];
    return fixup ? { ...resolved, contentType: fixup } : resolved;
  },
};

const core = createPulseVaultCore({
  storage,
  basePath: '/pulsevault',
  // WebApp.connectHandlers.use('/pulsevault', ...) already strips the mount
  // prefix before calling the handler — per the package's Meteor integration docs.
  stripBasePath: false,
  maxUploadSize: 500 * 1024 * 1024, // 500 MB
  // Uploads a client abandoned (an app killed mid-upload) — and the captions,
  // manifest or thumbnail of a video that never finished — are removed after a
  // day. Well above the capability token's lifetime, past which no upload can
  // continue anyway.
  retention: { abandonedAfterSeconds: 24 * 60 * 60 },
  // Every kind stays enabled — a pulse uploads a .pulse beat manifest, .vtt
  // captions and a .jpg thumbnail alongside its video; rejecting any of those
  // would make this a broken pairing target. Video is derived from
  // VIDEO_CONTENT_TYPES so the accepted extensions can't drift from the ones we
  // know how to serve. Without an extension listed here the tus create POST
  // 400s before any bytes move.
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
      return;
    }
    try {
      await verifyUploadToken(request, ctx);
      // Uploads come from the Pulse app only: PulseVault is built for its
      // protocol, and TimeHuddle has no general video upload endpoint (yet).
      // Pulse 2.1+ sends `Pulse-Client` on every request (PROTOCOL.md §7.2).
      // Not a security boundary (a header can be forged; the capability token
      // is the real check) — it keeps web code from quietly uploading here.
      if (ctx.phase === 'create' && !request.headers['pulse-client']) {
        throw Object.assign(new Error('Uploads here come from the Pulse app only.'), {
          statusCode: 403,
        });
      }
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
    // Web-playability backstop: phones routinely upload MP4s with the moov atom
    // at the end (a stall before frame one) or HEVC video (undecodable in
    // Firefox and most Chrome). Fix it once, before the video is attached, so
    // Huddle never shows an unplayable clip: a lossless faststart remux, or a
    // one-time H.264 transcode for a hostile codec. Atomic (tmp + rename) and
    // fail-open — without ffmpeg on PATH it logs and keeps the original bytes.
    if (ctx.kind === 'video') {
      const localPath = await storage.getLocalPath(ctx.artifactId);
      if (localPath) {
        const result = await ensureWebReady(localPath, { logger: console });
        if (result.action !== 'none') console.log('[pulsevault] web-ready', ctx.artifactId, result);
      }
    }
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
        const heartbeat = setInterval(() => {
          // Write failures mean the subscriber vanished without a 'close'
          // event; the interval is torn down by that handler below.
          try { res.write(':\n\n'); } catch { /* subscriber gone */ }
        }, 25_000);
        req.on('close', () => {
          clearInterval(heartbeat);
          const clients = sseClients.get(artifactId);
          clients?.delete(res);
          // Drop the empty Set too — otherwise every abandoned subscription
          // (client disconnects before the upload completes) leaks an entry
          // in this process-global map forever, since artifactIds are unique.
          if (clients && clients.size === 0) sseClients.delete(artifactId);
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
    expirySeconds: UPLOAD_LINK_SECONDS,
  });
}

Meteor.methods({
  /**
   * Reserve one Pulse upload: a fresh video id, a link token for it, and where
   * the finished video goes (`destination`, see pulse-destinations.js). The
   * server delivers it there when the upload completes — nothing else to do.
   *
   * Older callers pass `target` ('ticket' | 'clock' | 'library') with
   * `ticketId` / `clockEventId` instead of `destination`.
   */
  async 'pulsevault.reserve'({ destination, target, ticketId, clockEventId } = {}) {
    const identity = await requireIdentity(this);
    const requested =
      destination ??
      (target === 'clock'
        ? { kind: 'clock', id: clockEventId }
        : target === 'ticket' || (target !== 'library' && ticketId)
          ? { kind: 'ticket', id: ticketId }
          : { kind: 'library' });
    const resolved = await resolvePulseDestination(identity.userId, requested);

    // Always a fresh id: one link is one upload (a failed or cancelled upload
    // is deleted, never resumed), and a UUID can't clash with another.
    const videoid = randomUUID();
    const uploadToken = mintUploadToken(videoid);
    await persistReservation(videoid, { userId: identity.userId, destination: resolved });
    return { videoid, uploadToken };
  },

  async 'pulsevault.reserveForLibrary'() {
    const identity = await requireIdentity(this);
    const videoid = randomUUID();
    const uploadToken = mintUploadToken(videoid);
    await persistReservation(videoid, { userId: identity.userId, destination: { kind: 'library' } });
    return { videoid, uploadToken };
  },

  /**
   * Where one of the caller's Pulse uploads stands, for the Pulse popup:
   * `waiting` (reserved, not delivered yet), `done` (delivered), `kept` (it
   * couldn't go where it was meant to, so it's in the uploader's media
   * library; `reason` says why) or `expired` (the link ran out, or the id is
   * unknown).
   */
  async 'pulsevault.status'({ videoid } = {}) {
    const identity = await requireIdentity(this);
    if (typeof videoid !== 'string' || !videoid) {
      throw new Meteor.Error('bad-request', 'videoid is required');
    }
    const reservation = await peekReservation(videoid);
    const delivery =
      reservation ?? (await rawDb().collection(DELIVERIES_COLL).findOne({ _id: videoid }));
    if (delivery && delivery.userId !== identity.userId) {
      throw new Meteor.Error('forbidden', 'Not yours');
    }
    if (reservation) return { state: 'waiting' };
    if (delivery) return delivery.kept ? { state: 'kept', reason: delivery.reason } : { state: 'done' };
    // Landed but not delivered yet (the moment between the two).
    const landed = await storage.resolve(videoid).catch(() => null);
    return { state: landed ? 'waiting' : 'expired' };
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
