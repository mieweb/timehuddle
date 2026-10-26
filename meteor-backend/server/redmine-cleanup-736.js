/**
 * Clearing what was stored against a bare Redmine issue number (#736).
 *
 * Since #736 every row on the Tickets page is a TimeHuddle ticket: acting on a
 * Redmine issue carries it on one (`ticket-carry.js`). What a bare issue held
 * before that is cleared rather than moved, since re-pulling an issue replaces
 * it: its My Board entries, its pins and "removed" marks, and the attachments
 * added on its own page, which is gone.
 *
 * Time logged on a bare issue is left alone. It is someone's worked hours, and
 * it still shows in the timesheet and still sends to Redmine.
 *
 * Takes `db` and has no Meteor imports, so it is testable on its own
 * (tests/redmine-cleanup-736.test.ts).
 */
import { runMigrationOnce } from './migration-claim';

const MARKER_ID = 'redmine-bare-rows-736';

/**
 * Delete the bare-issue board entries, pins, removals and attachments, and give
 * links made before the host was stored the deployment's Redmine host
 * (`redmineHost`, skipped when null). Idempotent. Returns what it changed.
 */
export async function clearBareRedmineData(db, { redmineHost }) {
  const [board, { hidesKept, prefs }, attachments, hosts] = await Promise.all([
    db.collection('my_board').deleteMany({ sourceId: 'redmine' }),
    clearPinsAndRemovals(db.collection('redmine_issue_prefs')),
    db.collection('attachments').deleteMany({ 'attachedTo.kind': 'redmine' }),
    redmineHost
      ? db
          .collection('tickets')
          .updateMany(
            { 'linkedIssue.source': 'redmine', 'linkedIssue.host': { $exists: false } },
            { $set: { 'linkedIssue.host': redmineHost } },
          )
      : { modifiedCount: 0 },
  ]);
  return {
    boardEntries: board.deletedCount,
    prefs,
    hidesKept,
    attachments: attachments.deletedCount,
    linksGivenHost: hosts.modifiedCount,
  };
}

/**
 * Delete the pins and removals. Dismissals stay, since they still hide issues
 * from the search suggestions, and that includes the hide a pinned or removed
 * row can carry in `dismissedAt`: such a row becomes a plain dismissal first,
 * aged from when it was dismissed.
 */
async function clearPinsAndRemovals(prefs) {
  const kept = await prefs.updateMany(
    { state: { $in: ['pinned', 'removed'] }, dismissedAt: { $ne: null } },
    [{ $set: { state: 'dismissed', updatedAt: '$dismissedAt' } }, { $unset: 'dismissedAt' }],
  );
  const cleared = await prefs.deleteMany({ state: { $in: ['pinned', 'removed'] } });
  return { hidesKept: kept.modifiedCount, prefs: cleared.deletedCount };
}

/** Run the cleanup once across every server instance. */
export function migrateBareRedmineData(db, { redmineHost }) {
  return runMigrationOnce(db, MARKER_ID, async () => {
    const cleared = await clearBareRedmineData(db, { redmineHost });
    console.log('[redmine] cleared bare-issue data (#736):', JSON.stringify(cleared));
  });
}
