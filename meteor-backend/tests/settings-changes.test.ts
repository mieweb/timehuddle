/**
 * Settings change signal across server instances (server/settings/changes.js), #607.
 *
 * Another instance's write reaches this one through a Mongo change stream; here
 * the write is made straight to the database, as a second instance would make it.
 */
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { getDb, closeDb, ObjectId } from './helpers';
import { watchSettingsChanges } from '../server/settings/changes';

let watcher: ReturnType<typeof watchSettingsChanges>;
let signals = 0;
const orgId = new ObjectId();
const teamId = new ObjectId();

const settle = () => new Promise((resolve) => setTimeout(resolve, 600));

beforeAll(async () => {
  const db = await getDb();
  const now = new Date();
  await db.collection('organizations').insertOne({
    _id: orgId,
    name: 'Settings Changes Org',
    slug: `settings-changes-${orgId.toHexString()}`,
    owners: [],
    admins: [],
    settings: {},
    settingsLocks: {},
    createdAt: now,
    updatedAt: now,
  });
  await db.collection('teams').insertOne({
    _id: teamId,
    orgId: orgId.toHexString(),
    name: 'Settings Changes Team',
    members: [],
    admins: [],
    code: 'WHSETCH1',
    isPersonal: false,
    createdAt: now,
  });
  watcher = watchSettingsChanges(db, () => {
    signals += 1;
  });
  await watcher.ready;
});

afterAll(async () => {
  await watcher.stop();
  const db = await getDb();
  await db.collection('organizations').deleteMany({ _id: orgId });
  await db.collection('teams').deleteMany({ _id: teamId });
  await closeDb();
});

describe('watchSettingsChanges', () => {
  it('signals when another instance changes an org setting or lock', async () => {
    const db = await getDb();
    const before = signals;
    await db
      .collection('organizations')
      .updateOne({ _id: orgId }, { $set: { 'settings.requirePlanForClock': true } });
    await settle();
    expect(signals).toBeGreaterThan(before);

    const afterSetting = signals;
    await db
      .collection('organizations')
      .updateOne({ _id: orgId }, { $set: { 'settingsLocks.requirePlanForClock': true } });
    await settle();
    expect(signals).toBeGreaterThan(afterSetting);
  });

  it('signals when a team setting is set or removed', async () => {
    const db = await getDb();
    const before = signals;
    await db
      .collection('teams')
      .updateOne({ _id: teamId }, { $set: { 'settings.autoAcceptJoins': true } });
    await settle();
    expect(signals).toBeGreaterThan(before);

    const afterSet = signals;
    await db.collection('teams').updateOne({ _id: teamId }, { $unset: { settings: '' } });
    await settle();
    expect(signals).toBeGreaterThan(afterSet);
  });

  it('stays quiet for changes that do not affect resolved settings', async () => {
    const db = await getDb();
    const before = signals;
    await db.collection('teams').updateOne({ _id: teamId }, { $set: { name: 'Renamed' } });
    await db.collection('organizations').updateOne({ _id: orgId }, { $set: { name: 'Renamed' } });
    await settle();
    expect(signals).toBe(before);
  });
});
