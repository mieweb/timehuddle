/**
 * Migration: Remove deprecated clock event fields introduced by the pause/resume PR.
 *
 * Fields removed from all clockevents documents:
 *   - originalStartTime  (replaced by immutable startTime)
 *   - pausedAt           (replaced by checking breaks[] for an open entry)
 *   - totalPausedSeconds (derived from breaks[] at read time)
 *   - pauseStartedSessionId (timer-session coupling removed)
 *   - autoClockedOutAt   (auto clock-out feature removed)
 */

/** @param {import("mongodb").Db} db */
async function up(db) {
  const result = await db.collection("clockevents").updateMany(
    {
      $or: [
        { originalStartTime: { $exists: true } },
        { pausedAt: { $exists: true } },
        { totalPausedSeconds: { $exists: true } },
        { pauseStartedSessionId: { $exists: true } },
        { autoClockedOutAt: { $exists: true } },
      ],
    },
    {
      $unset: {
        originalStartTime: "",
        pausedAt: "",
        totalPausedSeconds: "",
        pauseStartedSessionId: "",
        autoClockedOutAt: "",
      },
    }
  );
  console.log(`[remove-clock-deprecated-fields] updated ${result.modifiedCount} document(s)`);
}

/** @param {import("mongodb").Db} db */
async function down(_db) {
  // These fields are intentionally not restored on rollback.
  // Rolling back this migration would require re-deriving pausedAt/totalPausedSeconds
  // from the breaks[] array, which is complex and lossy. If a rollback is needed,
  // restore from a database backup taken before this migration ran.
  console.log(
    "[remove-clock-deprecated-fields] down: no-op (fields not restored — restore from backup if needed)"
  );
}

module.exports = { up, down };
