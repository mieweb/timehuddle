/**
 * One-time move to hierarchical settings (#607). Takes the Mongo `db` and has
 * no Meteor imports, so it is testable (tests/settings-migrate.test.ts).
 */

import { runMigrationOnce } from '../migration-claim';

const MARKER_ID = 'hierarchical-settings-607';

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

// Teams are pinned once: from then on an absent value means "inherit", and
// pinning it again would turn off every team created since.
export function migrateSettings(db) {
  return runMigrationOnce(db, MARKER_ID, async (claimedAt) => {
    // Once only: copying again would restore a value an admin has since reset to inherited.
    const orgs = await moveOrgAutoJoinIntoSettings(db);
    if (orgs) console.log(`[settings] moved allowAutoJoin into settings on ${orgs} org(s)`);

    const teams = await pinExistingTeamPlanSetting(db, claimedAt);
    if (teams) console.log(`[settings] pinned requirePlanForClock=false on ${teams} team(s)`);
  });
}
