/**
 * Channels — wormhole REST integration tests.
 *
 * Fixture: OWNER (team admin), MEMBER (regular, not the channel creator),
 * OUTSIDER (not in team). Covers create/update/delete permissions and the
 * channel-message push notification deep-link URL.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createUserAndGetJwt, wormhole, getDb, closeDb, purgeUser } from './helpers';

const OWNER = { name: 'Channel Owner', email: 'wh-channel-owner@test.dev', password: 'Password1!' };
const MEMBER = { name: 'Channel Member', email: 'wh-channel-member@test.dev', password: 'Password1!' };
const OUTSIDER = {
  name: 'Channel Outsider',
  email: 'wh-channel-outsider@test.dev',
  password: 'Password1!',
};

let ownerJwt: string;
let memberJwt: string;
let outsiderJwt: string;
let memberId: string;
let fixtureTeamId: string;

beforeAll(async () => {
  await Promise.all([
    purgeUser(OWNER.email),
    purgeUser(MEMBER.email),
    purgeUser(OUTSIDER.email),
  ]);
  const [owner, member, outsider] = await Promise.all([
    createUserAndGetJwt(OWNER),
    createUserAndGetJwt(MEMBER),
    createUserAndGetJwt(OUTSIDER),
  ]);
  ownerJwt = owner.jwt;
  memberJwt = member.jwt;
  outsiderJwt = outsider.jwt;

  const db = await getDb();
  memberId = String(
    (await db.collection('users').findOne({ 'emails.address': MEMBER.email }))!._id,
  );

  const createRes = await wormhole<{ team: { id: string } }>(
    'teams.create',
    { name: 'Channel Fixture Team' },
    ownerJwt,
  );
  fixtureTeamId = createRes.result.team.id;
  await wormhole('teams.invite', { teamId: fixtureTeamId, email: MEMBER.email }, ownerJwt);
}, 30000);

afterAll(async () => {
  await wormhole('teams.delete', { teamId: fixtureTeamId }, ownerJwt).catch(() => {});
  await Promise.all([purgeUser(OWNER.email), purgeUser(MEMBER.email), purgeUser(OUTSIDER.email)]);
  await closeDb();
});

// ─── channels.list auto-provisioning ──────────────────────────────────────────

describe('channels.list', () => {
  it('rejects a non-team-member', async () => {
    const res = await wormhole('channels.list', { teamId: fixtureTeamId }, outsiderJwt);
    expect(res.ok).toBe(false);
  });

  it('auto-provisions a default #general channel', async () => {
    const res = await wormhole<{ channels: Array<{ id: string; name: string; isDefault: boolean }> }>(
      'channels.list',
      { teamId: fixtureTeamId },
      ownerJwt,
    );
    expect(res.ok).toBe(true);
    const general = res.result.channels.find((c) => c.isDefault);
    expect(general).toBeDefined();
    expect(general!.name).toBe('general');
  });
});

// ─── channels.update ──────────────────────────────────────────────────────────

describe('channels.update', () => {
  let channelId: string;

  beforeAll(async () => {
    const res = await wormhole<{ channel: { id: string } }>(
      'channels.create',
      { teamId: fixtureTeamId, name: 'eng-original', description: 'orig desc' },
      memberJwt,
    );
    channelId = res.result.channel.id;
  });

  it('lets the creator rename the channel and update its description', async () => {
    const res = await wormhole<{ channel: { name: string; description?: string } }>(
      'channels.update',
      { channelId, teamId: fixtureTeamId, name: 'eng-renamed', description: 'new desc' },
      memberJwt,
    );
    expect(res.ok).toBe(true);
    expect(res.result.channel.name).toBe('eng-renamed');
    expect(res.result.channel.description).toBe('new desc');
  });

  it('lets a team admin (non-creator) edit the channel', async () => {
    const res = await wormhole<{ channel: { description?: string } }>(
      'channels.update',
      { channelId, teamId: fixtureTeamId, description: 'admin edited' },
      ownerJwt,
    );
    expect(res.ok).toBe(true);
    expect(res.result.channel.description).toBe('admin edited');
  });

  it('rejects edits from a non-creator, non-admin team member', async () => {
    const otherMember = await createUserAndGetJwt({
      name: 'Other Member',
      email: 'wh-channel-other-member@test.dev',
      password: 'Password1!',
    });
    await wormhole(
      'teams.invite',
      { teamId: fixtureTeamId, email: 'wh-channel-other-member@test.dev' },
      ownerJwt,
    );
    const res = await wormhole('channels.update', { channelId, teamId: fixtureTeamId, description: 'nope' }, otherMember.jwt);
    expect(res.ok).toBe(false);
    await purgeUser('wh-channel-other-member@test.dev');
  });

  it('rejects duplicate channel names within the same team', async () => {
    await wormhole('channels.create', { teamId: fixtureTeamId, name: 'dup-target' }, ownerJwt);
    const res = await wormhole(
      'channels.update',
      { channelId, teamId: fixtureTeamId, name: 'dup-target' },
      memberJwt,
    );
    expect(res.ok).toBe(false);
  });
});

// ─── channels.delete ──────────────────────────────────────────────────────────

describe('channels.delete', () => {
  it('refuses to delete the default channel', async () => {
    const listRes = await wormhole<{ channels: Array<{ id: string; isDefault: boolean }> }>(
      'channels.list',
      { teamId: fixtureTeamId },
      ownerJwt,
    );
    const general = listRes.result.channels.find((c) => c.isDefault)!;
    const res = await wormhole('channels.delete', { channelId: general.id, teamId: fixtureTeamId }, ownerJwt);
    expect(res.ok).toBe(false);
  });

  it('rejects delete from a non-creator, non-admin member', async () => {
    const createRes = await wormhole<{ channel: { id: string } }>(
      'channels.create',
      { teamId: fixtureTeamId, name: 'to-be-protected' },
      memberJwt,
    );
    const channelId = createRes.result.channel.id;

    const outsiderInTeam = await createUserAndGetJwt({
      name: 'Delete Denier',
      email: 'wh-channel-delete-denier@test.dev',
      password: 'Password1!',
    });
    await wormhole(
      'teams.invite',
      { teamId: fixtureTeamId, email: 'wh-channel-delete-denier@test.dev' },
      ownerJwt,
    );
    const res = await wormhole(
      'channels.delete',
      { channelId, teamId: fixtureTeamId },
      outsiderInTeam.jwt,
    );
    expect(res.ok).toBe(false);
    await purgeUser('wh-channel-delete-denier@test.dev');
  });

  it('lets the creator hard-delete a channel and its messages', async () => {
    const createRes = await wormhole<{ channel: { id: string } }>(
      'channels.create',
      { teamId: fixtureTeamId, name: 'to-delete' },
      memberJwt,
    );
    const channelId = createRes.result.channel.id;
    await wormhole('channels.sendMessage', { channelId, teamId: fixtureTeamId, text: 'hi' }, memberJwt);

    const db = await getDb();
    expect(await db.collection('channelmessages').countDocuments({ channelId })).toBe(1);

    const res = await wormhole('channels.delete', { channelId, teamId: fixtureTeamId }, memberJwt);
    expect(res.ok).toBe(true);

    expect(await db.collection('channels').findOne({ _id: new (await import('mongodb')).ObjectId(channelId) })).toBeNull();
    expect(await db.collection('channelmessages').countDocuments({ channelId })).toBe(0);
  });
});

// ─── channels.sendMessage notification deep-link ─────────────────────────────

describe('channels.sendMessage notification', () => {
  it('builds a channel-specific deep-link URL with openTeam and openChannel', async () => {
    const createRes = await wormhole<{ channel: { id: string } }>(
      'channels.create',
      { teamId: fixtureTeamId, name: 'notif-check' },
      ownerJwt,
    );
    const channelId = createRes.result.channel.id;

    await wormhole(
      'channels.sendMessage',
      { channelId, teamId: fixtureTeamId, text: 'ping' },
      ownerJwt,
    );

    const db = await getDb();
    const notif = await db.collection('notifications').findOne({
      userId: memberId,
      'data.type': 'channel_message',
      'data.channelId': channelId,
    });
    expect(notif).toBeTruthy();
    expect(notif!.data.url).toBe(`/app/messages?openTeam=${fixtureTeamId}&openChannel=${channelId}`);
  });
});
