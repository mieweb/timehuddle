/**
 * One-time move to hierarchical settings (#607). Takes the Mongo `db` and has
 * no Meteor imports, so it is testable (tests/settings-migrate.test.ts).
 */

const MARKER_ID = 'hierarchical-settings-607';
const DUPLICATE_KEY_ERROR_CODE = 11000;

// Existing teams keep behaving as before: no explicit value used to mean off.
// Teams created since `before` already inherit and are left alone.
export async function pinExistingTeamPlanSetting(db, before = new Date()) {
  const { modifiedCount } = await db.collection('teams').updateMany(
    {
      isPersonal: { $ne: true },
      'settings.requirePlanForClock': { $exists: false },
      $or: [{ createdAt: { $lte: before } }, { createdAt: { $exists: false } }],
    },
    { $set: { 'settings.requirePlanForClock': false } },
  );
  return modifiedCount;
}

// The top-level `allowAutoJoin` is copied into `settings.allowAutoJoin`. The legacy field stays
// so servers from the previous version, still draining in a rolling deploy, read the same value.
export async function moveOrgAutoJoinIntoSettings(db) {
  const { modifiedCount } = await db.collection('organizations').updateMany(
    { allowAutoJoin: { $exists: true }, 'settings.allowAutoJoin': { $exists: false } },
    [{ $set: { 'settings.allowAutoJoin': '$allowAutoJoin' } }],
  );
  return modifiedCount;
}

const CLAIM_STALE_MS = 5 * 60 * 1000;
const CLAIM_POLL_MS = 500;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// One instance owns the team pin. It claims the marker by inserting it; the rest
// wait for `done`, and take over a claim that has gone stale after a crash.
async function claimTeamPin(migrations) {
  const claimedAt = new Date();
  try {
    await migrations.insertOne({ _id: MARKER_ID, status: 'running', claimedAt });
    return claimedAt;
  } catch (error) {
    if (error?.code !== DUPLICATE_KEY_ERROR_CODE) throw error;
  }
  for (;;) {
    const marker = await migrations.findOne({ _id: MARKER_ID });
    // Markers from before claims existed carry no status and mean done.
    if (marker && marker.status !== 'running') return null;
    const takeoverAt = new Date();
    const taken = await migrations.findOneAndUpdate(
      { _id: MARKER_ID, status: 'running', claimedAt: { $lt: new Date(Date.now() - CLAIM_STALE_MS) } },
      { $set: { claimedAt: takeoverAt } },
    );
    if (taken) return takeoverAt;
    await wait(CLAIM_POLL_MS);
  }
}

// Teams are pinned once: from then on an absent value means "inherit", and
// pinning it again would turn off every team created since.
export async function migrateSettings(db) {
  const migrations = db.collection('migrations');
  const claimedAt = await claimTeamPin(migrations);
  if (!claimedAt) return;
  // Once only: copying again would restore a value an admin has since reset to inherited.
  const orgs = await moveOrgAutoJoinIntoSettings(db);
  if (orgs) console.log(`[settings] moved allowAutoJoin into settings on ${orgs} org(s)`);

  const teams = await pinExistingTeamPlanSetting(db, claimedAt);
  if (teams) console.log(`[settings] pinned requirePlanForClock=false on ${teams} team(s)`);
  // Only the instance that still owns the claim may mark it done; a taken-over claim has a new `claimedAt`.
  await migrations.updateOne(
    { _id: MARKER_ID, claimedAt },
    { $set: { status: 'done', ranAt: new Date() } },
  );
}
