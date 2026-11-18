/**
 * The overdue sweep for Pulse videos sent from the app (huddle-server §10,
 * PLAN O14): hourly, and once at startup, every row whose video hasn't
 * landed 24 h after Send gets `overdueAt`. A clock type's post shows that its
 * video hasn't arrived yet, and its uploader gets one push. Time never
 * abandons a row: a video that arrives later still attaches, and its delivery
 * clears the flag and the post's mark (pulse-upload-delivery.js).
 *
 * Loaded from pulse-upload-delivery.js. `PULSE_UPLOADS_SWEEP_MS` runs it more
 * often (a test backend); the rules are pure, in pulse-delivery-core.js and
 * pulse-uploads-core.js.
 */
import { Meteor } from 'meteor/meteor';
import { MongoInternals } from 'meteor/mongo';

import { rawDb, isObjectIdHex } from './collections.js';
import { createNotification } from './notify-core.js';
import {
  overdueMark,
  overduePostMark,
  overduePush,
  PULSE_SWEEP_BATCH,
  sessionPostIdOf,
  sweepIntervalMs,
} from './pulse-delivery-core.js';
import { overdueQuery } from './pulse-uploads-core.js';
import { pulseUploadsCollection } from './pulse-uploads.js';

const { ObjectId } = MongoInternals.NpmModules.mongodb.module;

/** How many batches one pass marks at most; the rest wait for the next pass. */
const MAX_BATCHES = 50;

/** Mark one row overdue; its post and push only when this pass marked it (once, however many sweeps run). */
async function markOverdue(row, now) {
  const mark = overdueMark(row, now);
  const { modifiedCount } = await pulseUploadsCollection().updateOne(mark.filter, mark.update);
  if (!modifiedCount) return false;
  const postId = sessionPostIdOf(row);
  const postMark = overduePostMark({
    row,
    postId: typeof postId === 'string' && isObjectIdHex(postId) ? new ObjectId(postId.toLowerCase()) : null,
    now,
  });
  if (postMark) await rawDb().collection('huddlePosts').updateOne(postMark.filter, postMark.update);
  const push = overduePush(row);
  if (push) {
    try {
      await createNotification(push);
    } catch (err) {
      console.error(`[pulse-uploads] overdue push for ${row._id} failed:`, err);
    }
  }
  return true;
}

/** One pass: marks every row overdue at `now`, and says how many it marked. */
export async function sweepOverdueUploads(now = new Date()) {
  let marked = 0;
  for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
    const rows = await pulseUploadsCollection()
      .find(overdueQuery(now.getTime()))
      .sort({ sentAt: 1 })
      .limit(PULSE_SWEEP_BATCH)
      .toArray();
    for (const row of rows) {
      try {
        if (await markOverdue(row, now)) marked += 1;
      } catch (err) {
        console.error(`[pulse-uploads] marking ${row._id} overdue failed:`, err);
      }
    }
    if (rows.length < PULSE_SWEEP_BATCH) break;
  }
  return marked;
}

function runSweep() {
  sweepOverdueUploads()
    .then((marked) => {
      if (marked) console.log('[pulse-uploads] marked', marked, 'upload(s) overdue');
    })
    .catch((err) => console.error('[pulse-uploads] overdue sweep failed:', err));
}

Meteor.startup(() => {
  runSweep();
  Meteor.setInterval(runSweep, sweepIntervalMs(process.env.PULSE_UPLOADS_SWEEP_MS));
});
