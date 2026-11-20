/**
 * A Pulse video's captions, for a client that knows only the video:
 * `GET /pulse/captions/:videoId` redirects to its captions artifact (400 for a
 * malformed id, 404 when it has none). Public, like playback: anyone with the
 * video's link may play it, and its captions with it. CORS is the global
 * handler's (pulse-cors-core.js), the same as /pulsevault's, so a `<track>` in
 * the web app or a native app's WebView may fetch it — and follow the
 * redirect, which gets the same headers.
 *
 * It redirects instead of proxying because PulseVault already serves a `.vtt`
 * as `text/vtt` (CAPTIONS_CONTENT_TYPE in pulse-captions-core.js).
 *
 * Also fills in `captionsId` on media items from before videos kept one (see
 * pulsevault.js `storeCaptionsId` for new ones), at startup, in the
 * background.
 */
import { Meteor } from 'meteor/meteor';
import { WebApp } from 'meteor/webapp';
import { rawDb } from './collections.js';
import { captionsIdFor } from './pulsevault.js';
import { BACKFILL_BATCH, routeDecision, videoIdFromPath } from './pulse-captions-core.js';

export { captionsIdFor };

WebApp.connectHandlers.use('/pulse/captions', async (req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  try {
    const decision = await routeDecision(videoIdFromPath(req.url), captionsIdFor);
    // Captions can still arrive for a video (a retry), so nobody keeps the answer.
    if (decision.status === 302) {
      res.writeHead(302, { Location: decision.location, 'Cache-Control': 'no-cache' });
      res.end();
      return;
    }
    res.writeHead(decision.status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ error: decision.error }));
  } catch (err) {
    console.error('[pulse-captions] lookup failed:', err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Captions lookup failed' }));
    }
  }
});

/**
 * Give every media item with a video and no `captionsId` one (the id, or null
 * for none), BACKFILL_BATCH at a time, in `_id` order so an item whose lookup
 * failed (left unset, for the next start) is not read again in this pass.
 */
export async function backfillCaptionsIds() {
  const media = rawDb().collection('mediaitems');
  let after = null;
  let filled = 0;
  for (;;) {
    const batch = await media
      .find(
        { videoid: { $type: 'string' }, captionsId: { $exists: false }, ...(after ? { _id: { $gt: after } } : {}) },
        { projection: { _id: 1, videoid: 1 } },
      )
      .sort({ _id: 1 })
      .limit(BACKFILL_BATCH)
      .toArray();
    if (!batch.length) break;
    after = batch[batch.length - 1]._id;
    const found = new Map();
    for (const videoid of new Set(batch.map((item) => item.videoid))) {
      try {
        found.set(videoid, await captionsIdFor(videoid));
      } catch (err) {
        console.error(`[pulse-captions] backfill: looking up ${videoid} failed:`, err);
      }
    }
    const writes = batch
      .filter((item) => found.has(item.videoid))
      .map((item) => ({
        updateOne: {
          filter: { _id: item._id, captionsId: { $exists: false } },
          update: { $set: { captionsId: found.get(item.videoid) } },
        },
      }));
    if (writes.length) await media.bulkWrite(writes, { ordered: false });
    filled += writes.length;
    if (batch.length < BACKFILL_BATCH) break;
  }
  return filled;
}

// Not awaited before serving: until it runs, an older video just plays without captions.
Meteor.startup(() => {
  backfillCaptionsIds()
    .then((filled) => {
      if (filled) console.log('[pulse-captions] backfilled captionsId on', filled, 'media item(s)');
    })
    .catch((err) => console.error('[pulse-captions] backfill failed:', err));
});
