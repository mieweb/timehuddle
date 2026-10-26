/**
 * Run-once startup migrations, safe across several server instances.
 * Takes the Mongo `db` and has no Meteor imports, so it is testable.
 */

const DUPLICATE_KEY_ERROR_CODE = 11000;
const CLAIM_STALE_MS = 5 * 60 * 1000;
const CLAIM_POLL_MS = 500;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// One instance owns a migration. It claims the marker by inserting it; the rest
// wait for `done`, and take over a claim that has gone stale after a crash.
// Returns the claim time to finish with, or null when the migration is done.
async function claimMigration(migrations, markerId) {
  const claimedAt = new Date();
  try {
    await migrations.insertOne({ _id: markerId, status: 'running', claimedAt });
    return claimedAt;
  } catch (error) {
    if (error?.code !== DUPLICATE_KEY_ERROR_CODE) throw error;
  }
  for (;;) {
    const marker = await migrations.findOne({ _id: markerId });
    // Markers from before claims existed carry no status and mean done.
    if (marker && marker.status !== 'running') return null;
    const takeoverAt = new Date();
    const taken = await migrations.findOneAndUpdate(
      { _id: markerId, status: 'running', claimedAt: { $lt: new Date(Date.now() - CLAIM_STALE_MS) } },
      { $set: { claimedAt: takeoverAt } },
    );
    if (taken) return takeoverAt;
    await wait(CLAIM_POLL_MS);
  }
}

/**
 * Run `migrate(claimedAt)` once across every instance, then mark it done.
 * Only the instance that still owns the claim may mark it done; a taken-over
 * claim has a new `claimedAt`.
 */
export async function runMigrationOnce(db, markerId, migrate) {
  const migrations = db.collection('migrations');
  const claimedAt = await claimMigration(migrations, markerId);
  if (!claimedAt) return;
  await migrate(claimedAt);
  await migrations.updateOne(
    { _id: markerId, claimedAt },
    { $set: { status: 'done', ranAt: new Date() } },
  );
}
