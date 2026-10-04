/**
 * Media library — who may list someone else's library (media.listForUser).
 *
 * A viewer sees only what the owner posted to a team the viewer can access
 * (member or admin, or through the org or enterprise). Rows with no team — a
 * composer image or document, a kept or private Pulse video — stay the owner's.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createUserAndGetJwt, wormhole, getDb, closeDb, purgeUser, ObjectId } from './helpers';

const OWNER = { name: 'Library Owner', email: 'wh-lib-owner@test.dev', password: 'Password1!' };
const ADMIN = { name: 'Library Admin', email: 'wh-lib-admin@test.dev', password: 'Password1!' };
const STRANGER = { name: 'Library Stranger', email: 'wh-lib-stranger@test.dev', password: 'Password1!' };

let ownerId: string;
let ownerJwt: string;
let adminJwt: string;
let strangerJwt: string;

const idOf = async (email: string) =>
  String((await (await getDb()).collection('users').findOne({ 'emails.address': email }))!._id);

beforeAll(async () => {
  for (const u of [OWNER, ADMIN, STRANGER]) await purgeUser(u.email);
  ownerJwt = (await createUserAndGetJwt(OWNER)).jwt;
  adminJwt = (await createUserAndGetJwt(ADMIN)).jwt;
  strangerJwt = (await createUserAndGetJwt(STRANGER)).jwt;
  ownerId = await idOf(OWNER.email);
  const adminId = await idOf(ADMIN.email);

  const db = await getDb();
  // The admin runs the first team without being one of its members.
  const shared = { _id: new ObjectId(), name: 'WH Lib Shared', members: [ownerId], admins: [adminId], code: 'WHLIB01', isPersonal: false };
  const other = { _id: new ObjectId(), name: 'WH Lib Other', members: [ownerId], admins: [], code: 'WHLIB02', isPersonal: false };
  await db.collection('teams').insertMany([shared, other]);
  await db.collection('mediaitems').insertMany([
    { userId: ownerId, type: 'image', title: 'composer image', uploadedAt: new Date() },
    { userId: ownerId, type: 'video', videoid: 'wh-lib-v1', teamId: shared._id.toHexString(), title: 'shared video', uploadedAt: new Date() },
    { userId: ownerId, type: 'video', videoid: 'wh-lib-v2', teamId: other._id.toHexString(), title: 'other team video', uploadedAt: new Date() },
    { userId: ownerId, type: 'video', videoid: 'wh-lib-v3', title: 'kept video', uploadedAt: new Date() },
  ]);
});

afterAll(async () => {
  const db = await getDb();
  await db.collection('mediaitems').deleteMany({ userId: ownerId });
  await db.collection('teams').deleteMany({ code: { $in: ['WHLIB01', 'WHLIB02'] } });
  for (const u of [OWNER, ADMIN, STRANGER]) await purgeUser(u.email);
  await closeDb();
});

const titlesFor = async (jwt: string) => {
  const res = await wormhole<{ items: Array<{ title: string }> }>('media.listForUser', { userId: ownerId }, jwt);
  return res.ok ? res.result.items.map((i) => i.title).sort() : res.error;
};

describe('media.listForUser', () => {
  it('shows the owner everything', async () => {
    expect(await titlesFor(ownerJwt)).toEqual(['composer image', 'kept video', 'other team video', 'shared video']);
  });

  it('shows a team admin only what was posted to their team', async () => {
    expect(await titlesFor(adminJwt)).toEqual(['shared video']);
  });

  it('refuses someone with no team in common', async () => {
    expect(await titlesFor(strangerJwt)).toMatch(/Not a teammate/);
  });
});
