/**
 * Timer-write helpers needed by the clock methods (pause/resume/stop close or
 * restart the user's running work-timer). Port of the timer-session helpers in
 * backend/src/services/timer.service.ts (closeRunningForUser, closeAllForUser,
 * findClosedAtTime, restartTimerForWorkItem).
 *
 * Writes go through the native driver on the shared `timers` collection, so they
 * land in the oplog and the `timers.liveForUser` publication stays reactive —
 * no explicit broadcast needed (the Fastify version pinged a WebSocket here).
 */
import { MongoInternals } from 'meteor/mongo';
import { rawDb, isValidId } from './collections';

const { ObjectId } = MongoInternals.NpmModules.mongodb.module;

function timers() {
  return rawDb().collection('timers');
}
function workItems() {
  return rawDb().collection('workitems');
}

/** Close the user's single running timer session (if any). Returns its hex id or null. */
export async function closeRunningForUser(userId, now) {
  const running = await timers().findOne({ userId, endTime: null });
  if (!running) return null;
  const durationSeconds = Math.max(0, Math.floor((now - running.startTime) / 1000));
  await timers().updateOne(
    { _id: running._id, endTime: null },
    { $set: { endTime: now, durationSeconds } }
  );
  return running._id.toHexString();
}

/** Close every running timer session for the user. Returns how many were closed. */
export async function closeAllForUser(userId, now) {
  const running = await timers().find({ userId, endTime: null }).toArray();
  if (running.length === 0) return 0;
  const bulkOps = running.map((s) => ({
    updateOne: {
      filter: { _id: s._id, endTime: null },
      update: {
        $set: {
          endTime: now,
          durationSeconds: Math.max(0, Math.floor((now - s.startTime) / 1000)),
        },
      },
    },
  }));
  const result = await timers().bulkWrite(bulkOps);
  return result.modifiedCount;
}

/** Find the timer session that closed exactly at `endTime` for the user. */
export function findClosedAtTime(userId, endTime) {
  return timers().findOne({ userId, endTime });
}

/** Start a fresh running timer for a work item (used when a break ends). */
export async function restartTimerForWorkItem(userId, workItemId, now) {
  if (!isValidId(workItemId)) return null;
  const workItem = await workItems().findOne({ _id: new ObjectId(workItemId) });
  if (!workItem) return null;
  const session = {
    _id: new ObjectId(),
    workItemId,
    userId,
    date: workItem.date,
    startTime: now,
    endTime: null,
    createdAt: new Date(),
  };
  await timers().insertOne(session);
  return session;
}
