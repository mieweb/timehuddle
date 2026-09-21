/**
 * Sync state for the one Redmine time entry that represents a user's work on an
 * issue on a given day (M4 groundwork for M5's write).
 *
 * Row shape — one per (user, Redmine issue, day):
 *   userId              TimeHuddle user id
 *   ticketId            Redmine issue id, as a string (it is a number in the
 *                       Redmine API but a string in our WorkItem rows)
 *   date                "YYYY-MM-DD"
 *   source              always 'redmine'; stored for legibility, not indexed —
 *                       Huddle ticket ids are 24-hex ObjectIds and Redmine ids
 *                       are short decimals, so the two cannot collide
 *   redmineTimeEntryId  the remote entry's id, or null before the first sync
 *   syncedHours         what Redmine confirmed on the last successful write
 *   lastAttemptAt       when a sync was last tried
 *   failureReason       why the last attempt failed, or null
 *
 * `redmineTimeEntryId` is canonical business data, not a display convenience:
 * it is the remote system's identity for this record, and losing it produces
 * duplicate Redmine entries. Resolved issue titles and urls stay out, exactly as
 * M3 established.
 *
 * M5 adds the write path. This module ships only the collection, its uniqueness
 * guarantee, and the read helper the sync engine will start from.
 */
import { Meteor } from 'meteor/meteor';

import { RedmineTimeSyncs } from './collections';

// The one-entry-per-issue-per-day guarantee lives here, in the storage layer,
// rather than in a read-before-write that two concurrent session closes could
// both pass. Mirrors the unique-index startup pattern in redmine.js.
Meteor.startup(async () => {
  try {
    await RedmineTimeSyncs.createIndexAsync(
      { userId: 1, ticketId: 1, date: 1 },
      { unique: true, name: 'unique_redmine_time_sync_day' },
    );
  } catch (error) {
    console.error('[redmine] failed to create unique time-sync index:', error);
  }
});

/** The sync row for one user + Redmine issue + day, or null before a first sync. */
export function findSyncState(userId, ticketId, date) {
  return RedmineTimeSyncs.findOneAsync({ userId, ticketId, date });
}

/**
 * Every ticket-day this user has already pushed.
 *
 * Only rows that actually carry a `redmineTimeEntryId` count as synced: a row
 * left behind by a failed attempt holds a `failureReason` and no id, and must
 * stay eligible for a retry.
 *
 * @returns {Promise<Set<string>>} keys of the form `ticketId|date` — safe because a
 *   ticket id is a decimal or hex string and a date is `YYYY-MM-DD`, so neither
 *   can contain the separator. Must match the keys built in redmine.js.
 */
export async function syncedKeysFor(userId) {
  const rows = await RedmineTimeSyncs.find(
    { userId, redmineTimeEntryId: { $ne: null } },
    { fields: { ticketId: 1, date: 1 } },
  ).fetchAsync();
  return new Set(rows.map((row) => `${row.ticketId}|${row.date}`));
}

/**
 * Record a successful push.
 *
 * `upsert` against the unique `{userId, ticketId, date}` index is what makes a
 * double-press of the button harmless: the second write updates the same row
 * rather than creating a second one, and the caller checks for an existing
 * entry id before ever reaching Redmine.
 */
export function recordSynced(userId, ticketId, date, { redmineTimeEntryId, hours }) {
  return RedmineTimeSyncs.upsertAsync(
    { userId, ticketId, date },
    {
      $set: {
        userId,
        ticketId,
        date,
        source: 'redmine',
        redmineTimeEntryId,
        syncedHours: hours,
        lastAttemptAt: new Date(),
        failureReason: null,
      },
    },
  );
}

/**
 * Record a failed push, leaving `redmineTimeEntryId` untouched so a retry is
 * still possible. The reason is kept verbatim for the UI — "the role lacks
 * log_time" is a different user action from "Redmine was unreachable".
 */
export function recordFailure(userId, ticketId, date, failureReason) {
  return RedmineTimeSyncs.upsertAsync(
    { userId, ticketId, date },
    {
      $set: {
        userId,
        ticketId,
        date,
        source: 'redmine',
        lastAttemptAt: new Date(),
        failureReason,
      },
      $setOnInsert: { redmineTimeEntryId: null, syncedHours: null },
    },
  );
}
