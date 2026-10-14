/**
 * Startup migration to hierarchical settings (server/settings/migrate.js), #607.
 *
 * Existing teams keep today's behaviour (no value meant off), and an org's
 * top-level `allowAutoJoin` moves into `settings`.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { getDb, closeDb, ObjectId } from './helpers';
import {
  migrateSettings,
  moveOrgAutoJoinIntoSettings,
  pinExistingTeamPlanSetting,
} from '../server/settings/migrate';

const tag = `mig607-${Date.now()}`;
const createdTeams: ObjectId[] = [];
const createdOrgs: ObjectId[] = [];

async function insertTeam(fields: Record<string, unknown>) {
  const db = await getDb();
  const _id = new ObjectId();
  await db.collection('teams').insertOne({
    _id,
    name: `${tag}-team`,
    members: [],
    admins: [],
    isPersonal: false,
    createdAt: new Date(),
    ...fields,
  });
  createdTeams.push(_id);
  return _id;
}

async function insertOrg(fields: Record<string, unknown>) {
  const db = await getDb();
  const _id = new ObjectId();
  await db.collection('organizations').insertOne({
    _id,
    name: `${tag}-org`,
    slug: `${tag}-${_id.toHexString()}`,
    owners: [],
    admins: [],
    createdAt: new Date(),
    ...fields,
  });
  createdOrgs.push(_id);
  return _id;
}

afterAll(async () => {
  const db = await getDb();
  await db.collection('teams').deleteMany({ _id: { $in: createdTeams } });
  await db.collection('organizations').deleteMany({ _id: { $in: createdOrgs } });
  await closeDb();
});

describe('pinExistingTeamPlanSetting', () => {
  it('pins unset non-personal teams to false and leaves everything else alone', async () => {
    const unset = await insertTeam({});
    const unsetWithOtherSettings = await insertTeam({ settings: { autoAcceptJoins: true } });
    const explicitTrue = await insertTeam({ settings: { requirePlanForClock: true } });
    const personal = await insertTeam({ isPersonal: true });

    await pinExistingTeamPlanSetting(await getDb());

    const db = await getDb();
    const read = (id: ObjectId) => db.collection('teams').findOne({ _id: id });
    expect((await read(unset))?.settings?.requirePlanForClock).toBe(false);
    expect((await read(unsetWithOtherSettings))?.settings).toEqual({
      autoAcceptJoins: true,
      requirePlanForClock: false,
    });
    expect((await read(explicitTrue))?.settings?.requirePlanForClock).toBe(true);
    expect((await read(personal))?.settings).toBeUndefined();
  });
});

describe('moveOrgAutoJoinIntoSettings', () => {
  it('copies the top-level field into settings, keeps it, and a second run changes nothing', async () => {
    const off = await insertOrg({ allowAutoJoin: false });
    const on = await insertOrg({ allowAutoJoin: true, settings: { requirePlanForClock: true } });
    const unset = await insertOrg({});

    const db = await getDb();
    await moveOrgAutoJoinIntoSettings(db);
    expect(await moveOrgAutoJoinIntoSettings(db)).toBe(0);

    const read = (id: ObjectId) => db.collection('organizations').findOne({ _id: id });
    const offDoc = await read(off);
    expect(offDoc?.settings).toEqual({ allowAutoJoin: false });
    expect(offDoc?.allowAutoJoin).toBe(false);
    const onDoc = await read(on);
    expect(onDoc?.settings).toEqual({ requirePlanForClock: true, allowAutoJoin: true });
    expect(onDoc?.allowAutoJoin).toBe(true);
    expect((await read(unset))?.settings).toBeUndefined();
  });
});

describe('migrateSettings', () => {
  it('pins teams once: a team created afterwards still inherits', async () => {
    const db = await getDb();
    await db.collection('migrations').deleteOne({ _id: 'hierarchical-settings-607' });
    const before = await insertTeam({});

    await migrateSettings(db);
    const after = await insertTeam({ createdAt: new Date(Date.now() + 60_000) });
    await migrateSettings(db);

    const read = (id: ObjectId) => db.collection('teams').findOne({ _id: id });
    expect((await read(before))?.settings?.requirePlanForClock).toBe(false);
    expect((await read(after))?.settings).toBeUndefined();
  });

  it('copies org auto-join once: a value reset to inherited stays reset', async () => {
    const db = await getDb();
    await db.collection('migrations').deleteOne({ _id: 'hierarchical-settings-607' });
    const org = await insertOrg({ allowAutoJoin: false });

    await migrateSettings(db);
    const read = () => db.collection('organizations').findOne({ _id: org });
    expect((await read())?.settings?.allowAutoJoin).toBe(false);

    await db
      .collection('organizations')
      .updateOne({ _id: org }, { $unset: { 'settings.allowAutoJoin': '' } });
    await migrateSettings(db);
    expect((await read())?.settings?.allowAutoJoin).toBeUndefined();
  });

  it('tolerates another instance recording the marker first', async () => {
    const db = await getDb();
    await db.collection('migrations').deleteOne({ _id: 'hierarchical-settings-607' });
    await expect(Promise.all([migrateSettings(db), migrateSettings(db)])).resolves.toBeDefined();
  });

  it('takes over a claim left running by a crashed instance', async () => {
    const db = await getDb();
    const marker = db.collection('migrations');
    await marker.deleteOne({ _id: 'hierarchical-settings-607' });
    await marker.insertOne({
      _id: 'hierarchical-settings-607',
      status: 'running',
      claimedAt: new Date(Date.now() - 10 * 60 * 1000),
    });
    const stuck = await insertTeam({});

    await migrateSettings(db);

    expect(
      (await db.collection('teams').findOne({ _id: stuck }))?.settings?.requirePlanForClock,
    ).toBe(false);
    expect((await marker.findOne({ _id: 'hierarchical-settings-607' }))?.status).toBe('done');
  });
});
