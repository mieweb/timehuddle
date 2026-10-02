/**
 * One row per time entry TimeHuddle has created in Redmine.
 *
 * Row shape:
 *   userId              TimeHuddle user id
 *   ticketId            Redmine issue id, as a string (a number in the Redmine
 *                       API, a string in our WorkItem rows)
 *   date                "YYYY-MM-DD" — the entry's `spent_on`
 *   source              always 'redmine'; stored for legibility
 *   redmineTimeEntryId  the remote entry's id
 *   syncedSeconds       the raw seconds this entry covered — what later pushes
 *                       subtract to find the unsent remainder
 *   syncedHours         the rounded hours actually sent
 *   lastAttemptAt       when it was pushed
 *   failureReason       set if the read-back disagreed ('hours-mismatch') or could not be made ('unconfirmed'),
 *                       otherwise null. The entry still exists either way.
 *   discardedAt         set instead of `redmineTimeEntryId` when the user chose
 *                       never to send this time ("Never send" in the push
 *                       dialog). `syncedSeconds` is the time discarded, which
 *                       counts as handled so it is never offered again; no
 *                       entry exists in Redmine.
 *
 * **Why one row per entry, not per ticket-day.** Entries are create-only, so
 * with one entry per ticket-day any work done after a mid-day push could never
 * reach Redmine. A ticket-day may carry several entries; each push sends only
 * the seconds not already covered, and Redmine's per-issue total stays correct.
 *
 * `redmineTimeEntryId` and `syncedSeconds` are canonical business data: losing
 * either would resend time already in Redmine. Titles and urls stay out.
 */
import { Meteor } from 'meteor/meteor';

import { RedmineTimeSyncs } from './collections';
import { ticketDayKey } from './redmine-net-hours';
import { redmineClosedSecondsUntil } from './timer-core';

Meteor.startup(async () => {
  // An older unique index made a second entry for the same ticket-day impossible.
  try {
    await RedmineTimeSyncs.rawCollection().dropIndex('unique_redmine_time_sync_day');
  } catch {
    /* already dropped, or never created */
  }

  try {
    await RedmineTimeSyncs.createIndexAsync(
      { userId: 1, ticketId: 1, date: 1 },
      { name: 'redmine_time_sync_lookup' },
    );
    // Each remote entry is recorded once, however the push is retried.
    await RedmineTimeSyncs.createIndexAsync(
      { redmineTimeEntryId: 1 },
      {
        unique: true,
        name: 'unique_redmine_time_entry',
        partialFilterExpression: { redmineTimeEntryId: { $type: 'number' } },
      },
    );
  } catch (error) {
    console.error('[redmine] failed to create time-sync indexes:', error);
  }

  await backfillSyncedSeconds();
});

/**
 * One-time backfill for older rows, which recorded rounded hours but not the
 * seconds they covered.
 *
 * Deriving seconds from `syncedHours` would be up to 18 seconds out per row, and
 * that error would resurface as phantom unsent time. The exact figure is
 * recoverable instead: those rows were pushed with the ticket-day's whole total
 * at the time, i.e. every session that had closed by `lastAttemptAt`.
 * Idempotent — only rows still missing `syncedSeconds` are touched.
 */
async function backfillSyncedSeconds() {
  const rows = await RedmineTimeSyncs.find(
    { redmineTimeEntryId: { $type: 'number' }, syncedSeconds: { $exists: false } },
    { fields: { userId: 1, ticketId: 1, date: 1, lastAttemptAt: 1 } },
  ).fetchAsync();

  for (const row of rows) {
    const cutoff = row.lastAttemptAt instanceof Date ? row.lastAttemptAt.getTime() : Date.now();
    const seconds = await redmineClosedSecondsUntil(row.userId, row.ticketId, row.date, cutoff);
    await RedmineTimeSyncs.updateAsync(row._id, { $set: { syncedSeconds: seconds } });
  }
  if (rows.length) console.log(`[redmine] backfilled syncedSeconds on ${rows.length} sync row(s)`);
}

/**
 * What has already been handled per ticket-day, for one user: the raw seconds
 * covered (sent or discarded), how many of those were discarded, and the whole
 * minutes Redmine holds from the entries sent.
 * @returns {Promise<Map<string, {seconds: number, discardedSeconds: number, minutes: number}>>}
 *   keyed by `ticketDayKey`
 */
export async function pushLedgerFor(userId) {
  // Discarded time counts too: "handled" is what keeps it out of the dialog.
  const rows = await RedmineTimeSyncs.find(
    {
      userId,
      $or: [{ redmineTimeEntryId: { $type: 'number' } }, { discardedAt: { $type: 'date' } }],
    },
    { fields: { ticketId: 1, date: 1, syncedSeconds: 1, syncedHours: 1, redmineTimeEntryId: 1 } },
  ).fetchAsync();

  const byKey = new Map();
  for (const row of rows) {
    const key = ticketDayKey(row.ticketId, row.date);
    const held = byKey.get(key) ?? { seconds: 0, discardedSeconds: 0, minutes: 0 };
    const seconds = row.syncedSeconds ?? 0;
    held.seconds += seconds;
    if (row.redmineTimeEntryId == null) held.discardedSeconds += seconds;
    else held.minutes += Math.round((row.syncedHours ?? seconds / 3600) * 60);
    byKey.set(key, held);
  }
  return byKey;
}

/**
 * The ids of the Redmine time entries TimeHuddle pushed for one user on one
 * issue. Their time already shows on the issue page as that user's own timer
 * sessions, so the page leaves these Redmine copies out.
 * @returns {Promise<Set<number>>}
 */
export async function pushedEntryIdsFor(userId, ticketId) {
  const rows = await RedmineTimeSyncs.find(
    { userId, ticketId: String(ticketId), redmineTimeEntryId: { $type: 'number' } },
    { fields: { redmineTimeEntryId: 1 } },
  ).fetchAsync();
  return new Set(rows.map((row) => row.redmineTimeEntryId));
}

/** Record an entry Redmine has just created. */
export function recordEntry(userId, ticketId, date, { redmineTimeEntryId, seconds, hours }) {
  return RedmineTimeSyncs.insertAsync({
    userId,
    ticketId,
    date,
    source: 'redmine',
    redmineTimeEntryId,
    syncedSeconds: seconds,
    syncedHours: hours,
    lastAttemptAt: new Date(),
    failureReason: null,
  });
}

/**
 * Record that the user chose never to send `seconds` of a ticket-day's time to
 * Redmine. Nothing is written to Redmine; the time stays in TimeHuddle, and
 * only time tracked on that day later is offered again.
 */
export function recordDiscard(userId, ticketId, date, seconds) {
  return RedmineTimeSyncs.insertAsync({
    userId,
    ticketId,
    date,
    source: 'redmine',
    redmineTimeEntryId: null,
    syncedSeconds: seconds,
    syncedHours: 0,
    discardedAt: new Date(),
    lastAttemptAt: null,
    failureReason: null,
  });
}

/**
 * Flag an entry whose read-back disagreed with what was sent. The entry exists
 * in Redmine regardless, so it keeps counting as sent — clearing it would resend
 * the same time as a duplicate.
 */
export function flagEntry(redmineTimeEntryId, failureReason) {
  return RedmineTimeSyncs.updateAsync({ redmineTimeEntryId }, { $set: { failureReason } });
}
