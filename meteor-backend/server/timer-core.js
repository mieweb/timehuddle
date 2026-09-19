/**
 * Timer helpers the clock domain needs: pause/resume/stop close or restart the
 * user's running work-timer, and the timesheet nests each shift's ticket
 * sessions under it (M3.1). Port of the timer-session helpers in
 * backend/src/services/timer.service.ts (closeRunningForUser, closeAllForUser,
 * findClosedAtTime, restartTimerForWorkItem).
 *
 * Writes go through the native driver on the shared `timers` collection, so they
 * land in the oplog and the `timers.liveForUser` publication stays reactive —
 * no explicit broadcast needed (the Fastify version pinged a WebSocket here).
 */
import { MongoInternals } from 'meteor/mongo';
import { rawDb, isValidId } from './collections';
import { normalizeSource, refKey, resolveTicketRefs } from './ticket-refs';

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

/**
 * Start a fresh running timer for a work item (used when a break ends).
 * `clockEventId` ties the new session to the shift it resumes inside, the same
 * way `timers.startSession` does, so the Dashboard timesheet can nest it.
 */
export async function restartTimerForWorkItem(userId, workItemId, now, clockEventId = null) {
  if (!isValidId(workItemId)) return null;
  const workItem = await workItems().findOne({ _id: new ObjectId(workItemId) });
  if (!workItem) return null;
  const session = {
    _id: new ObjectId(),
    workItemId,
    userId,
    clockEventId,
    date: workItem.date,
    startTime: now,
    endTime: null,
    createdAt: new Date(),
  };
  await timers().insertOne(session);
  return session;
}

/**
 * Ticket-timer sessions that happened during each of `clockEventIds`, as
 * `Map<clockEventId, session[]>` sorted oldest-first, joined to their WorkItem
 * for the ticket ref and resolved to a display title + link.
 *
 * Only sessions written since M3 carry a `clockEventId`; older ones are simply
 * absent from the result, which renders as a shift with no ticket rows.
 */
export async function ticketSessionsForClockEvents(userId, clockEventIds) {
  const byEvent = new Map();
  if (!clockEventIds.length) return byEvent;

  const sessions = await timers()
    .find({ userId, clockEventId: { $in: clockEventIds } })
    .sort({ startTime: 1 })
    .toArray();
  if (!sessions.length) return byEvent;

  const workItemIds = [...new Set(sessions.map((s) => s.workItemId))].filter(isValidId);
  const items = await workItems()
    .find({ _id: { $in: workItemIds.map((id) => new ObjectId(id)) } })
    .toArray();
  const itemById = new Map(items.map((item) => [item._id.toHexString(), item]));
  const display = await resolveTicketRefs(userId, items);

  for (const session of sessions) {
    const item = itemById.get(session.workItemId);
    if (!item) continue; // work item deleted out from under its sessions
    const source = normalizeSource(item.source);
    const shown = display.get(refKey(source, item.ticketId));
    const rows = byEvent.get(session.clockEventId) ?? [];
    rows.push({
      id: session._id.toHexString(),
      workItemId: session.workItemId,
      source,
      ticketId: item.ticketId,
      title: shown?.title ?? null,
      url: shown?.url ?? null,
      startTime: session.startTime,
      endTime: session.endTime ?? null,
      durationSeconds: session.durationSeconds ?? null,
    });
    byEvent.set(session.clockEventId, rows);
  }
  return byEvent;
}
