/**
 * One-time move to hierarchical settings (#607). Takes the Mongo `db` and has
 * no Meteor imports, so it is testable (tests/settings-migrate.test.ts).
 */

const MARKER_ID = 'hierarchical-settings-607';
const DUPLICATE_KEY_ERROR_CODE = 11000;

// Existing teams keep behaving as before: no explicit value used to mean off.
export async function pinExistingTeamPlanSetting(db) {
  const { modifiedCount } = await db
    .collection('teams')
    .updateMany(
      { isPersonal: { $ne: true }, 'settings.requirePlanForClock': { $exists: false } },
      { $set: { 'settings.requirePlanForClock': false } },
    );
  return modifiedCount;
}

// The top-level `allowAutoJoin` field becomes `settings.allowAutoJoin`.
export async function moveOrgAutoJoinIntoSettings(db) {
  const { modifiedCount } = await db
    .collection('organizations')
    .updateMany({ allowAutoJoin: { $exists: true } }, [
      { $set: { 'settings.allowAutoJoin': '$allowAutoJoin' } },
      { $unset: 'allowAutoJoin' },
    ]);
  return modifiedCount;
}

// Teams are pinned once: from then on an absent value means "inherit", and
// pinning it again would turn off every team created since.
export async function migrateSettings(db) {
  const orgs = await moveOrgAutoJoinIntoSettings(db);
  if (orgs) console.log(`[settings] moved allowAutoJoin into settings on ${orgs} org(s)`);

  const migrations = db.collection('migrations');
  if (await migrations.findOne({ _id: MARKER_ID })) return;
  const teams = await pinExistingTeamPlanSetting(db);
  if (teams) console.log(`[settings] pinned requirePlanForClock=false on ${teams} team(s)`);
  await migrations.insertOne({ _id: MARKER_ID, ranAt: new Date() }).catch((error) => {
    // Another instance finished the same migration first.
    if (error?.code !== DUPLICATE_KEY_ERROR_CODE) throw error;
  });
}
