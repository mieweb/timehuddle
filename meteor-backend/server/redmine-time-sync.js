/**
 * One row per time entry TimeHuddle has created in Redmine (M5, D5).
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
 *   failureReason       set if the read-back disagreed ('hours-mismatch'),
 *                       otherwise null. The entry still exists either way.
 *
 * **Why one row per entry, not per ticket-day (D5).** The first design allowed
 * exactly one entry per ticket-day, enforced by a unique index. Combined with
 * create-only (D1), that meant any work done after a mid-day push could never
 * reach Redmine, and the push panel silently disappeared. A ticket-day may now
 * carry several entries; each push sends only the seconds not already covered,
 * and Redmine's per-issue total stays correct.
 *
 * `redmineTimeEntryId` and `syncedSeconds` are canonical business data: losing
 * either would resend time already in Redmine. Titles and urls stay out, as M3
 * established.
 */
import { Meteor } from 'meteor/meteor';

import { RedmineTimeSyncs } from './collections';
import { redmineClosedSecondsUntil } from './timer-core';

Meteor.startup(async () => {
  // The pre-D5 index made a second entry for the same ticket-day impossible.
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
 * One-time backfill for rows written before D5, which recorded rounded hours but
 * not the seconds they covered.
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
 * Seconds already sent to Redmine, per ticket-day, for one user.
 * @returns {Promise<Map<string, number>>} keyed `ticketId|date` — safe because a
 *   ticket id is a decimal or hex string and a date is `YYYY-MM-DD`, so neither
 *   can contain the separator. Must match the keys built in redmine-time-entries.js.
 */
export async function sentSecondsFor(userId) {
  const rows = await RedmineTimeSyncs.find(
    { userId, redmineTimeEntryId: { $type: 'number' } },
    { fields: { ticketId: 1, date: 1, syncedSeconds: 1 } },
  ).fetchAsync();

  const byKey = new Map();
  for (const row of rows) {
    const key = `${row.ticketId}|${row.date}`;
    byKey.set(key, (byKey.get(key) ?? 0) + (row.syncedSeconds ?? 0));
  }
  return byKey;
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
 * Flag an entry whose read-back disagreed with what was sent. The entry exists
 * in Redmine regardless, so it keeps counting as sent — clearing it would resend
 * the same time as a duplicate.
 */
export function flagEntry(redmineTimeEntryId, failureReason) {
  return RedmineTimeSyncs.updateAsync({ redmineTimeEntryId }, { $set: { failureReason } });
}
