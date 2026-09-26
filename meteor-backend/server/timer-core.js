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
import { normalizeSource, refKey, resolveTicketRefs, sourceSelector } from './ticket-refs';
import { sumClosedSessions } from './redmine-net-hours';

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
 * Net worked seconds for one user, one ticket, one day — the number M5 projects
 * to Redmine as a single "Spent time" entry.
 *
 * Deliberately *not* `timers.getTicketTotal`, which answers a different question
 * (a ticket's lifetime total across every user and every day) and would push
 * other people's hours under the caller's name.
 *
 * Sums across **all** matching WorkItems, not one: `timers.copyPrevious` dedupes
 * on a signature including `note` and `sortOrder`, so sibling rows for the same
 * user + source + ticket + date legitimately exist and all of them count.
 */
export async function netSecondsFor(userId, source, ticketId, date) {
  const rows = await workItems()
    .find(
      { userId, ticketId, date, ...sourceSelector(normalizeSource(source)) },
      { projection: { _id: 1 } },
    )
    .toArray();
  if (!rows.length) return 0;

  // `timers.workItemId` is stored as a hex string, not an ObjectId.
  const workItemIds = rows.map((row) => row._id.toHexString());
  const sessions = await timers()
    .find(
      { workItemId: { $in: workItemIds }, endTime: { $ne: null } },
      { projection: { endTime: 1, durationSeconds: 1 } },
    )
    .toArray();

  return sumClosedSessions(sessions);
}

/**
 * Every Redmine ticket-day this user has tracked time against, with its net
 * seconds — the full candidate set the manual push (M5, D2) draws from.
 *
 * The same grouping `netSecondsFor` performs, but for all of a user's Redmine
 * work at once, so the confirmation dialog needs one round trip rather than one
 * per ticket-day. Sibling WorkItems for the same tuple collapse into a single
 * total for exactly the reason given above.
 *
 * Days with no closed session are dropped: a still-running timer has no final
 * duration, and under D1 a pushed entry can never be corrected, so partial time
 * must not reach Redmine.
 *
 * @returns {Promise<Array<{ticketId: string, date: string, seconds: number}>>}
 */
export async function redmineTicketDaysFor(userId) {
  const rows = await workItems()
    .find(
      { userId, ...sourceSelector('redmine') },
      { projection: { _id: 1, ticketId: 1, date: 1 } },
    )
    .toArray();
  if (!rows.length) return [];

  // `timers.workItemId` is stored as a hex string, not an ObjectId.
  const keyByWorkItem = new Map(
    rows.map((row) => [row._id.toHexString(), `${row.ticketId}|${row.date}`]),
  );

  const sessions = await timers()
    .find(
      { workItemId: { $in: [...keyByWorkItem.keys()] }, endTime: { $ne: null } },
      { projection: { workItemId: 1, endTime: 1, durationSeconds: 1 } },
    )
    .toArray();

  const byKey = new Map();
  for (const session of sessions) {
    const key = keyByWorkItem.get(session.workItemId);
    if (!key) continue;
    const bucket = byKey.get(key) ?? [];
    bucket.push(session);
    byKey.set(key, bucket);
  }

  return [...byKey.entries()].map(([key, bucket]) => {
    const [ticketId, date] = key.split('|');
    return { ticketId, date, seconds: sumClosedSessions(bucket) };
  });
}

/**
 * Net Redmine seconds for one user + ticket + day, counting only sessions that
 * had closed by `cutoffMs`.
 *
 * Used once, to backfill how much time each pre-D5 sync row actually covered:
 * those rows recorded rounded hours, not seconds, but the sessions that fed them
 * are still here and closed before the push, so the exact figure is recoverable.
 */
export async function redmineClosedSecondsUntil(userId, ticketId, date, cutoffMs) {
  const rows = await workItems()
    .find({ userId, ticketId, date, ...sourceSelector('redmine') }, { projection: { _id: 1 } })
    .toArray();
  if (!rows.length) return 0;

  const sessions = await timers()
    .find(
      {
        workItemId: { $in: rows.map((row) => row._id.toHexString()) },
        endTime: { $ne: null, $lte: cutoffMs },
      },
      { projection: { endTime: 1, durationSeconds: 1 } },
    )
    .toArray();
  return sumClosedSessions(sessions);
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
