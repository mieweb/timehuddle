/**
 * Teams — wormhole REST integration tests.
 *
 * Fixture: OWNER (team admin), MEMBER (regular), OUTSIDER (not in team).
 * Ported from backend/tests/teams.test.ts (Fastify) to Meteor wormhole calls.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash } from 'crypto';
import {
  createUserAndGetJwt,
  wormhole,
  getDb,
  closeDb,
  purgeUser,
  ObjectId,
  DDPConnection,
} from './helpers';
import { METEOR_URL } from './setup';

const OWNER = { name: 'Team Owner', email: 'wh-team-owner@test.dev', password: 'Password1!' };
const MEMBER = { name: 'Team Member', email: 'wh-team-member@test.dev', password: 'Password1!' };
const OUTSIDER = { name: 'Team Outsider', email: 'wh-team-outsider@test.dev', password: 'Password1!' };
const INVITEE = { name: 'New Invitee', email: 'wh-team-invitee@test.dev', password: 'Password1!' };

let ownerJwt: string;
let memberJwt: string;
let outsiderJwt: string;
let ownerId: string;
let memberId: string;
let outsiderId: string;
let fixtureTeamId: string;
let pendingInvitationId: string;
let pendingInvitationToken: string;

const MAILPIT_URL = process.env.MAILPIT_URL ?? 'http://localhost:8025';

function generateTestInvitationToken(seed: string): string {
  return createHash('sha256').update(`${seed}-${Date.now()}-${Math.random()}`).digest('hex');
}

async function waitForInvitationToken(email: string, timeoutMs = 15_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const list = (await (await fetch(`${MAILPIT_URL}/api/v1/messages`)).json()) as {
      messages: Array<{ ID: string; To: Array<{ Address: string }> }>;
    };
    const message = list.messages.find((candidate) =>
      candidate.To.some((recipient) => recipient.Address.toLowerCase() === email.toLowerCase()),
    );
    if (message) {
      const detail = (await (
        await fetch(`${MAILPIT_URL}/api/v1/message/${message.ID}`)
      ).json()) as { HTML?: string; Text?: string };
      const body = detail.Text ?? detail.HTML ?? '';
      const token = body.match(/[?&]invite=([a-f0-9]{64})/)?.[1];
      if (token) return token;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`No team invitation email arrived for ${email} within ${timeoutMs}ms`);
}

beforeAll(async () => {
  await Promise.all([
    purgeUser(OWNER.email),
    purgeUser(MEMBER.email),
    purgeUser(OUTSIDER.email),
    purgeUser(INVITEE.email),
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
  ownerId = String((await db.collection('users').findOne({ 'emails.address': OWNER.email }))!._id);
  memberId = String((await db.collection('users').findOne({ 'emails.address': MEMBER.email }))!._id);
  outsiderId = String((await db.collection('users').findOne({ 'emails.address': OUTSIDER.email }))!._id);

  // Create a shared fixture team via wormhole, then add the member
  const createRes = await wormhole<{ team: { id: string } }>(
    'teams.create',
    { name: 'Fixture Team' },
    ownerJwt,
  );
  fixtureTeamId = createRes.result.team.id;
  await wormhole('teams.invite', { teamId: fixtureTeamId, email: MEMBER.email }, ownerJwt);
}, 30000);

afterAll(async () => {
  // Clean up fixture team (may already be deleted by tests)
  await wormhole('teams.delete', { teamId: fixtureTeamId }, ownerJwt).catch(() => {});
  const db = await getDb();
  await db.collection('team_invitations').deleteMany({ teamId: fixtureTeamId });
  await Promise.all([
    purgeUser(OWNER.email),
    purgeUser(MEMBER.email),
    purgeUser(OUTSIDER.email),
    purgeUser(INVITEE.email),
  ]);
  await closeDb();
});

// ─── Auth gate ────────────────────────────────────────────────────────────────

describe('auth gate', () => {
  it('rejects unauthenticated calls', async () => {
    const res = await wormhole('teams.list', {}, 'bad-jwt-token');
    expect(res.ok).toBe(false);
  });
});

// ─── teams.list ──────────────────────────────────────────────────────────────

describe('teams.list', () => {
  it('returns teams for owner', async () => {
    const res = await wormhole<{ teams: Array<{ id: string; name: string; members: string[]; admins: string[] }> }>(
      'teams.list',
      {},
      ownerJwt,
    );
    expect(res.ok).toBe(true);
    const fixture = res.result.teams.find((t) => t.id === fixtureTeamId);
    expect(fixture).toBeDefined();
    expect(fixture!.name).toBe('Fixture Team');
    expect(fixture!.members).toContain(ownerId);
    expect(fixture!.admins).toContain(ownerId);
  });

  it('does not return the fixture team for outsider', async () => {
    const res = await wormhole<{ teams: Array<{ id: string }> }>('teams.list', {}, outsiderJwt);
    expect(res.ok).toBe(true);
    expect(res.result.teams.find((t) => t.id === fixtureTeamId)).toBeUndefined();
  });
});

// ─── teams.ensurePersonal ────────────────────────────────────────────────────

describe('teams.ensurePersonal', () => {
  it('creates a personal workspace when none exists', async () => {
    const res = await wormhole<{ team: { id: string; isPersonal: boolean; members: string[] } }>(
      'teams.ensurePersonal',
      {},
      outsiderJwt,
    );
    expect(res.ok).toBe(true);
    expect(res.result.team.isPersonal).toBe(true);
    expect(res.result.team.members).toContain(outsiderId);
  });

  it('also enrolls the user as a default-org member (regression: signup gave a personal team but no org)', async () => {
    const db = await getDb();
    const defaultOrg = await db.collection('organizations').findOne({ slug: 'default' });
    expect(defaultOrg).toBeTruthy();

    const membership = await db.collection('org_members').findOne({
      orgId: defaultOrg!._id.toHexString(),
      userId: outsiderId,
    });
    expect(membership).toBeTruthy();
    expect(membership!.role).toBe('member');
  });

  it('is idempotent — calling twice returns the same team', async () => {
    const res1 = await wormhole<{ team: { id: string } }>('teams.ensurePersonal', {}, memberJwt);
    const res2 = await wormhole<{ team: { id: string } }>('teams.ensurePersonal', {}, memberJwt);
    expect(res1.ok).toBe(true);
    expect(res2.ok).toBe(true);
    expect(res1.result.team.id).toBe(res2.result.team.id);
  });
});

// ─── teams.create ────────────────────────────────────────────────────────────

describe('teams.create', () => {
  it('creates a team', async () => {
    const res = await wormhole<{
      team: { id: string; name: string; description: string | null; members: string[]; admins: string[]; isPersonal: boolean; code: string };
    }>('teams.create', { name: 'New Team', description: 'A brand new team' }, ownerJwt);
    expect(res.ok).toBe(true);
    expect(res.result.team.name).toBe('New Team');
    expect(res.result.team.description).toBe('A brand new team');
    expect(res.result.team.members).toContain(ownerId);
    expect(res.result.team.admins).toContain(ownerId);
    expect(res.result.team.isPersonal).toBe(false);
    expect(typeof res.result.team.code).toBe('string');

    // cleanup
    await wormhole('teams.delete', { teamId: res.result.team.id }, ownerJwt);
  });

  it('rejects missing name', async () => {
    const res = await wormhole('teams.create', {}, ownerJwt);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/name/i);
  });

  it('rejects empty name', async () => {
    const res = await wormhole('teams.create', { name: '   ' }, ownerJwt);
    expect(res.ok).toBe(false);
  });
});

// ─── teams.join ──────────────────────────────────────────────────────────────

describe('teams.join', () => {
  let joinTeamId: string;
  let joinTeamCode: string;

  beforeAll(async () => {
    const res = await wormhole<{ team: { id: string } }>(
      'teams.create',
      { name: 'Join Code Team' },
      ownerJwt,
    );
    joinTeamId = res.result.team.id;
    const db = await getDb();
    const team = await db.collection('teams').findOne({ _id: new ObjectId(joinTeamId) });
    joinTeamCode = team!.code;
  });

  afterAll(async () => {
    const db = await getDb();
    await db.collection('teams').deleteOne({ _id: new ObjectId(joinTeamId) });
  });

  it('joins an existing team by code', async () => {
    const res = await wormhole<{ status: string; team?: { id: string; members: string[] }; request?: any }>(
      'teams.join',
      { teamCode: joinTeamCode },
      outsiderJwt,
    );
    expect(res.ok).toBe(true);
    expect(res.result.status).toBe('pending');
    expect(res.result.request).toBeDefined();

    // Approve the request as owner
    const approveRes = await wormhole<{ ok: boolean }>(
      'teams.approveJoinRequest',
      { requestId: res.result.request.id },
      ownerJwt,
    );
    expect(approveRes.ok).toBe(true);

    // Verify user was added to team
    const db = await getDb();
    const team = await db.collection('teams').findOne({ _id: new ObjectId(joinTeamId) });
    expect(team?.members).toContain(outsiderId);

    // cleanup: remove outsider so other tests can re-join
    await db.collection('teams').updateOne(
      { _id: new ObjectId(joinTeamId) },
      { $pull: { members: outsiderId } } as any,
    );
  });

  it('returns error for bad code', async () => {
    const res = await wormhole('teams.join', { teamCode: 'BADCODE999' }, outsiderJwt);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not found/i);
  });

  it('returns error if already a member', async () => {
    const res = await wormhole('teams.join', { teamCode: joinTeamCode }, ownerJwt);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/already/i);
  });
});

// ─── teams.rename ────────────────────────────────────────────────────────────

describe('teams.rename', () => {
  it('admin can rename', async () => {
    const res = await wormhole<{ team: { id: string; name: string } }>(
      'teams.rename',
      { teamId: fixtureTeamId, newName: 'Renamed Team' },
      ownerJwt,
    );
    expect(res.ok).toBe(true);
    expect(res.result.team.name).toBe('Renamed Team');
    // restore
    await wormhole('teams.rename', { teamId: fixtureTeamId, newName: 'Fixture Team' }, ownerJwt);
  });

  it('non-admin member is forbidden', async () => {
    const res = await wormhole(
      'teams.rename',
      { teamId: fixtureTeamId, newName: 'Hacked' },
      memberJwt,
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/admin/i);
  });

  it('outsider is forbidden', async () => {
    const res = await wormhole(
      'teams.rename',
      { teamId: fixtureTeamId, newName: 'Hacked' },
      outsiderJwt,
    );
    expect(res.ok).toBe(false);
  });
});

// ─── teams.getMembers ────────────────────────────────────────────────────────

describe('teams.getMembers', () => {
  it('returns members with name and email', async () => {
    const res = await wormhole<{ members: Array<{ id: string; name: string; email: string }> }>(
      'teams.getMembers',
      { teamId: fixtureTeamId },
      ownerJwt,
    );
    expect(res.ok).toBe(true);
    expect(Array.isArray(res.result.members)).toBe(true);
    const ownerEntry = res.result.members.find((m) => m.id === ownerId);
    expect(ownerEntry).toBeDefined();
    expect(ownerEntry!.name).toBe(OWNER.name);
    expect(ownerEntry!.email).toBe(OWNER.email);
  });

  it('outsider is forbidden', async () => {
    const res = await wormhole(
      'teams.getMembers',
      { teamId: fixtureTeamId },
      outsiderJwt,
    );
    expect(res.ok).toBe(false);
  });
});

// ─── teams.invite ────────────────────────────────────────────────────────────

describe('teams.invite', () => {
  it('adds user to team by email', async () => {
    const res = await wormhole<{ ok: boolean }>(
      'teams.invite',
      { teamId: fixtureTeamId, email: OUTSIDER.email },
      ownerJwt,
    );
    if (!res.ok) console.error('Invite failed:', res.error);
    expect(res.ok).toBe(true);
    expect(res.result.ok).toBe(true);
    // cleanup
    const db = await getDb();
    await db.collection('teams').updateOne(
      { _id: new ObjectId(fixtureTeamId) },
      { $pull: { members: outsiderId } } as any,
    );
  });

  it('creates a pending invitation for an unregistered email', async () => {
    const res = await wormhole<{ status: string; invitationId: string }>(
      'teams.invite',
      { teamId: fixtureTeamId, email: INVITEE.email },
      ownerJwt,
    );
    expect(res.ok).toBe(true);
    expect(res.result.status).toBe('pending');
    pendingInvitationId = res.result.invitationId;
    pendingInvitationToken = await waitForInvitationToken(INVITEE.email);
    const db = await getDb();
    const invitation = await db.collection('team_invitations').findOne({
      _id: new ObjectId(res.result.invitationId),
    });
    expect(invitation).toMatchObject({
      teamId: fixtureTeamId,
      email: INVITEE.email,
      status: 'pending',
    });
    expect(invitation?.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(invitation?.tokenHash).toBe(
      createHash('sha256').update(pendingInvitationToken).digest('hex'),
    );
  });

  it('rejects duplicate pending invitations', async () => {
    const res = await wormhole(
      'teams.invite',
      { teamId: fixtureTeamId, email: INVITEE.email },
      ownerJwt,
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/pending invitation/i);
  });

  it('rejects invalid email addresses', async () => {
    const res = await wormhole(
      'teams.invite',
      { teamId: fixtureTeamId, email: 'not-an-email' },
      ownerJwt,
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/valid email/i);
  });

  it('requires a team administrator', async () => {
    const res = await wormhole(
      'teams.invite',
      { teamId: fixtureTeamId, email: 'another-invitee@test.dev' },
      memberJwt,
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/admin/i);
  });

  it('only allows the invited email to accept and joins that user after registration', async () => {
    const mismatch = await wormhole(
      'teams.acceptInvite',
      { token: pendingInvitationToken },
      outsiderJwt,
    );
    expect(mismatch.ok).toBe(false);
    expect(mismatch.error).toMatch(/sign in with/i);

    const invitee = await createUserAndGetJwt(INVITEE);
    const accepted = await wormhole<{ ok: boolean; team: { id: string } }>(
      'teams.acceptInvite',
      { token: pendingInvitationToken },
      invitee.jwt,
    );
    expect(accepted.ok).toBe(true);
    expect(accepted.result.team.id).toBe(fixtureTeamId);

    const db = await getDb();
    const team = await db.collection('teams').findOne({ _id: new ObjectId(fixtureTeamId) });
    expect(team?.members).toContain(invitee.userId);
    const invitation = await db
      .collection('team_invitations')
      .findOne({ _id: new ObjectId(pendingInvitationId) });
    expect(invitation).toMatchObject({
      status: 'accepted',
      acceptedBy: invitee.userId,
    });

    const reused = await wormhole(
      'teams.acceptInvite',
      { token: pendingInvitationToken },
      invitee.jwt,
    );
    expect(reused.ok).toBe(false);
    expect(reused.error).toMatch(/already been accepted/i);
  });

  it.each([
    ['expired', new Date(Date.now() - 1_000), /expired/i],
    ['revoked', new Date(Date.now() + 60_000), /revoked/i],
  ])('rejects %s invitations with clear feedback', async (status, expiresAt, errorPattern) => {
    const token = generateTestInvitationToken(status);
    const db = await getDb();
    await db.collection('team_invitations').insertOne({
      _id: new ObjectId(),
      teamId: fixtureTeamId,
      email: `wh-${status}@test.dev`,
      tokenHash: createHash('sha256').update(token).digest('hex'),
      invitedBy: ownerId,
      status: status === 'expired' ? 'pending' : status,
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt,
    });

    const res = await wormhole('teams.getInvitation', { token }, ownerJwt);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(errorPattern);
  });

  it('returns error if already a member', async () => {
    const res = await wormhole(
      'teams.invite',
      { teamId: fixtureTeamId, email: MEMBER.email },
      ownerJwt,
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/already/i);
  });
});

// ─── teams.getPendingInvitations / teams.revokeInvite ────────────────────────

describe('teams.getPendingInvitations / teams.revokeInvite', () => {
  const ORG_OWNER = { name: 'Org Owner', email: 'wh-team-org-owner@test.dev', password: 'Password1!' };
  let orgOwnerJwt: string;
  let orgOwnerId: string;
  let settingsTeamId: string;

  beforeAll(async () => {
    await purgeUser(ORG_OWNER.email);
    const orgOwner = await createUserAndGetJwt(ORG_OWNER);
    orgOwnerJwt = orgOwner.jwt;
    const db = await getDb();
    orgOwnerId = String(
      (await db.collection('users').findOne({ 'emails.address': ORG_OWNER.email }))!._id,
    );

    // Team owned/administered by OWNER, but living in an org whose owner is a
    // different user (ORG_OWNER) who is NOT a team admin.
    const createRes = await wormhole<{ team: { id: string } }>(
      'teams.create',
      { name: 'Invitation Settings Team' },
      ownerJwt,
    );
    settingsTeamId = createRes.result.team.id;

    const orgId = new ObjectId();
    await db.collection('organizations').insertOne({
      _id: orgId,
      name: 'Invitation Settings Org',
      slug: `invitation-settings-org-${orgId.toHexString()}`,
      owners: [orgOwnerId],
      admins: [],
      allowAutoJoin: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await db
      .collection('teams')
      .updateOne({ _id: new ObjectId(settingsTeamId) }, { $set: { orgId: orgId.toHexString() } });
  }, 30000);

  afterAll(async () => {
    const db = await getDb();
    await db.collection('team_invitations').deleteMany({ teamId: settingsTeamId });
    await wormhole('teams.delete', { teamId: settingsTeamId }, ownerJwt).catch(() => {});
    await db.collection('organizations').deleteMany({ name: 'Invitation Settings Org' });
    await purgeUser(ORG_OWNER.email);
  });

  it('plain team admin can list pending invitations', async () => {
    const invite = await wormhole<{ invitationId: string }>(
      'teams.invite',
      { teamId: settingsTeamId, email: 'wh-settings-admin-invitee@test.dev' },
      ownerJwt,
    );
    expect(invite.ok).toBe(true);

    const res = await wormhole<{ invitations: Array<{ id: string; email: string; status: string }> }>(
      'teams.getPendingInvitations',
      { teamId: settingsTeamId },
      ownerJwt,
    );
    expect(res.ok).toBe(true);
    expect(res.result.invitations).toContainEqual(
      expect.objectContaining({ email: 'wh-settings-admin-invitee@test.dev', status: 'pending' }),
    );
  });

  it('plain team admin can revoke a pending invitation', async () => {
    const invite = await wormhole<{ invitationId: string }>(
      'teams.invite',
      { teamId: settingsTeamId, email: 'wh-settings-admin-revoke@test.dev' },
      ownerJwt,
    );
    expect(invite.ok).toBe(true);

    const revoke = await wormhole(
      'teams.revokeInvite',
      { invitationId: invite.result.invitationId },
      ownerJwt,
    );
    expect(revoke.ok).toBe(true);

    const db = await getDb();
    const invitation = await db
      .collection('team_invitations')
      .findOne({ _id: new ObjectId(invite.result.invitationId) });
    expect(invitation?.status).toBe('revoked');
  });

  it('org owner (non-admin) can list pending invitations', async () => {
    const res = await wormhole<{ invitations: unknown[] }>(
      'teams.getPendingInvitations',
      { teamId: settingsTeamId },
      orgOwnerJwt,
    );
    expect(res.ok).toBe(true);
  });

  it('org owner (non-admin) can revoke a pending invitation', async () => {
    const invite = await wormhole<{ invitationId: string }>(
      'teams.invite',
      { teamId: settingsTeamId, email: 'wh-settings-orgowner-revoke@test.dev' },
      ownerJwt,
    );
    expect(invite.ok).toBe(true);

    const revoke = await wormhole(
      'teams.revokeInvite',
      { invitationId: invite.result.invitationId },
      orgOwnerJwt,
    );
    expect(revoke.ok).toBe(true);

    const db = await getDb();
    const invitation = await db
      .collection('team_invitations')
      .findOne({ _id: new ObjectId(invite.result.invitationId) });
    expect(invitation?.status).toBe('revoked');
  });

  it('non-admin, non-org-owner is forbidden from listing invitations', async () => {
    const res = await wormhole('teams.getPendingInvitations', { teamId: settingsTeamId }, outsiderJwt);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/admin/i);
  });

  it('non-admin, non-org-owner is forbidden from revoking invitations', async () => {
    const invite = await wormhole<{ invitationId: string }>(
      'teams.invite',
      { teamId: settingsTeamId, email: 'wh-settings-outsider-revoke@test.dev' },
      ownerJwt,
    );
    expect(invite.ok).toBe(true);

    const revoke = await wormhole(
      'teams.revokeInvite',
      { invitationId: invite.result.invitationId },
      outsiderJwt,
    );
    expect(revoke.ok).toBe(false);
    expect(revoke.error).toMatch(/admin/i);
  });

  it('revoked invitations remain visible in the list but are not re-revocable', async () => {
    const invite = await wormhole<{ invitationId: string }>(
      'teams.invite',
      { teamId: settingsTeamId, email: 'wh-settings-revoked-visible@test.dev' },
      ownerJwt,
    );
    expect(invite.ok).toBe(true);

    const firstRevoke = await wormhole(
      'teams.revokeInvite',
      { invitationId: invite.result.invitationId },
      ownerJwt,
    );
    expect(firstRevoke.ok).toBe(true);

    const list = await wormhole<{ invitations: Array<{ id: string; status: string }> }>(
      'teams.getPendingInvitations',
      { teamId: settingsTeamId },
      ownerJwt,
    );
    expect(list.ok).toBe(true);
    expect(list.result.invitations).toContainEqual(
      expect.objectContaining({ id: invite.result.invitationId, status: 'revoked' }),
    );

    const secondRevoke = await wormhole(
      'teams.revokeInvite',
      { invitationId: invite.result.invitationId },
      ownerJwt,
    );
    expect(secondRevoke.ok).toBe(false);
    expect(secondRevoke.error).toMatch(/pending/i);
  });
});

// ─── teams.setRole ───────────────────────────────────────────────────────────

describe('teams.setRole', () => {
  it('admin can promote member to admin', async () => {
    const res = await wormhole<{ ok: boolean }>(
      'teams.setRole',
      { teamId: fixtureTeamId, userId: memberId, role: 'admin' },
      ownerJwt,
    );
    expect(res.ok).toBe(true);
    // verify
    const db = await getDb();
    const team = await db.collection('teams').findOne({ _id: new ObjectId(fixtureTeamId) });
    expect(team?.admins).toContain(memberId);
    // demote back
    await wormhole(
      'teams.setRole',
      { teamId: fixtureTeamId, userId: memberId, role: 'member' },
      ownerJwt,
    );
  });

  it('non-admin is forbidden', async () => {
    const res = await wormhole(
      'teams.setRole',
      { teamId: fixtureTeamId, userId: ownerId, role: 'member' },
      memberJwt,
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/admin/i);
  });

  it('cannot demote last admin', async () => {
    const res = await wormhole(
      'teams.setRole',
      { teamId: fixtureTeamId, userId: ownerId, role: 'member' },
      ownerJwt,
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/last admin/i);
  });
});

// ─── teams.removeMember ──────────────────────────────────────────────────────

describe('teams.removeMember', () => {
  it('admin can remove a regular member', async () => {
    // add outsider via the invite method so Meteor sees the change
    const inviteRes = await wormhole('teams.invite', { teamId: fixtureTeamId, email: OUTSIDER.email }, ownerJwt);
    expect(inviteRes.ok).toBe(true);

    const res = await wormhole<{ ok: boolean }>(
      'teams.removeMember',
      { teamId: fixtureTeamId, userId: outsiderId },
      ownerJwt,
    );
    expect(res.ok).toBe(true);
    const db = await getDb();
    const team = await db.collection('teams').findOne({ _id: new ObjectId(fixtureTeamId) });
    expect(team?.members).not.toContain(outsiderId);
  });

  it('non-admin is forbidden', async () => {
    const res = await wormhole(
      'teams.removeMember',
      { teamId: fixtureTeamId, userId: ownerId },
      memberJwt,
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/admin/i);
  });

  it('cannot remove self', async () => {
    const res = await wormhole(
      'teams.removeMember',
      { teamId: fixtureTeamId, userId: ownerId },
      ownerJwt,
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/yourself/i);
  });
});

// ─── teams.delete ────────────────────────────────────────────────────────────

describe('teams.delete', () => {
  it('admin can delete a team', async () => {
    // create a temp team to delete
    const createRes = await wormhole<{ team: { id: string } }>(
      'teams.create',
      { name: 'To Delete' },
      ownerJwt,
    );
    expect(createRes.ok).toBe(true);
    const tmpId = createRes.result.team.id;

    const res = await wormhole<{ ok: boolean }>('teams.delete', { teamId: tmpId }, ownerJwt);
    expect(res.ok).toBe(true);
    const db = await getDb();
    const gone = await db.collection('teams').findOne({ _id: new ObjectId(tmpId) });
    expect(gone).toBeNull();
  });

  it('non-admin is forbidden', async () => {
    const res = await wormhole('teams.delete', { teamId: fixtureTeamId }, memberJwt);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/admin/i);
  });

  it('outsider is forbidden', async () => {
    const res = await wormhole('teams.delete', { teamId: fixtureTeamId }, outsiderJwt);
    expect(res.ok).toBe(false);
  });
});

// ─── Invite links ─────────────────────────────────────────────────────────────
//
// An invite link is the only thing that grants membership outright. A team code
// no longer does: 'teams.joinByLink' routes a bare code through the ordinary
// approval flow, which is what the QR codes shared before invite links existed
// now degrade to.

describe('teams invite links', () => {
  let linkTeamId: string;
  let linkTeamCode: string;

  /** Detach the outsider so each redemption test starts from "not a member". */
  async function resetOutsiderMembership() {
    const db = await getDb();
    await db
      .collection('teams')
      .updateOne({ _id: new ObjectId(linkTeamId) }, { $pull: { members: outsiderId } } as never);
    await db.collection('teamjoinrequests').deleteMany({ teamId: linkTeamId });
  }

  beforeAll(async () => {
    const createRes = await wormhole<{ team: { id: string; code: string } }>(
      'teams.create',
      { name: 'Invite Link Team' },
      ownerJwt,
    );
    linkTeamId = createRes.result.team.id;
    linkTeamCode = createRes.result.team.code;
    // What a link grants is the team's decision. Most of this block tests the
    // "admits outright" half, so opt the fixture team into that; the approval
    // half gets its own test below.
    await wormhole(
      'teams.updateSettings',
      { teamId: linkTeamId, autoAcceptJoins: true },
      ownerJwt,
    );
  }, 30000);

  afterAll(async () => {
    const db = await getDb();
    await db.collection('team_invitations').deleteMany({ teamId: linkTeamId });
    await db.collection('teamjoinrequests').deleteMany({ teamId: linkTeamId });
    await wormhole('teams.delete', { teamId: linkTeamId }, ownerJwt).catch(() => {});
  });

  /** Mint a link and hand back its token and id. */
  async function createLink() {
    const res = await wormhole<{ link: { invitationId: string }; url: string }>(
      'teams.createInviteLink',
      { teamId: linkTeamId },
      ownerJwt,
    );
    expect(res.ok).toBe(true);
    const token = new URL(res.result.url).searchParams.get('join')!;
    return { token, invitationId: res.result.link.invitationId };
  }

  it('generates an opaque token, never the team code', async () => {
    const { token } = await createLink();
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(token).not.toContain(linkTeamCode);
  });

  it('stores only the hash of the token', async () => {
    const { token, invitationId } = await createLink();
    const db = await getDb();
    const doc = await db.collection('team_invitations').findOne({ _id: new ObjectId(invitationId) });
    expect(doc).toBeTruthy();
    expect(doc!.tokenHash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(JSON.stringify(doc)).not.toContain(token);
  });

  it('is refused to a member who is not an admin', async () => {
    const res = await wormhole('teams.createInviteLink', { teamId: linkTeamId }, memberJwt);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/admin/i);
  });

  it('is refused to an outsider', async () => {
    const res = await wormhole('teams.createInviteLink', { teamId: linkTeamId }, outsiderJwt);
    expect(res.ok).toBe(false);
  });

  it('reports the active link without disclosing its URL', async () => {
    const { token, invitationId } = await createLink();
    const res = await wormhole<{
      link: { invitationId: string; expiresAt: string; useCount: number };
    }>('teams.getInviteLink', { teamId: linkTeamId }, ownerJwt);
    expect(res.ok).toBe(true);
    expect(res.result.link.invitationId).toBe(invitationId);
    expect(JSON.stringify(res.result)).not.toContain(token);
  });

  it('adds the redeemer to the team with no approval step', async () => {
    await resetOutsiderMembership();
    const { token } = await createLink();

    const res = await wormhole<{ status: string }>(
      'teams.joinByLink',
      { value: token },
      outsiderJwt,
    );
    expect(res.ok).toBe(true);
    expect(res.result.status).toBe('joined');

    const db = await getDb();
    const team = await db.collection('teams').findOne({ _id: new ObjectId(linkTeamId) });
    expect(team!.members).toContain(outsiderId);
    const pending = await db
      .collection('teamjoinrequests')
      .findOne({ teamId: linkTeamId, userId: outsiderId, status: 'pending' });
    expect(pending).toBeNull();
  });

  it('is idempotent — redeeming twice leaves one membership', async () => {
    await resetOutsiderMembership();
    const { token, invitationId } = await createLink();

    await wormhole('teams.joinByLink', { value: token }, outsiderJwt);
    const second = await wormhole<{ status: string }>(
      'teams.joinByLink',
      { value: token },
      outsiderJwt,
    );
    expect(second.ok).toBe(true);
    expect(second.result.status).toBe('joined');

    const db = await getDb();
    const team = await db.collection('teams').findOne({ _id: new ObjectId(linkTeamId) });
    expect(team!.members.filter((id: string) => id === outsiderId)).toHaveLength(1);
    // The second open was a no-op, so it did not count as a use.
    const doc = await db.collection('team_invitations').findOne({ _id: new ObjectId(invitationId) });
    expect(doc!.useCount).toBe(1);
    // A group link survives being redeemed — it is not consumed.
    expect(doc!.status).toBe('pending');
  });

  it('stops working once revoked', async () => {
    await resetOutsiderMembership();
    const { token, invitationId } = await createLink();

    const revoke = await wormhole('teams.revokeInvite', { invitationId }, ownerJwt);
    expect(revoke.ok).toBe(true);

    const res = await wormhole('teams.joinByLink', { value: token }, outsiderJwt);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/revoked/i);

    const db = await getDb();
    const team = await db.collection('teams').findOne({ _id: new ObjectId(linkTeamId) });
    expect(team!.members).not.toContain(outsiderId);
  });

  it('retires the previous link when a replacement is generated', async () => {
    await resetOutsiderMembership();
    const first = await createLink();
    const second = await createLink();

    const stale = await wormhole('teams.joinByLink', { value: first.token }, outsiderJwt);
    expect(stale.ok).toBe(false);

    const fresh = await wormhole('teams.joinByLink', { value: second.token }, outsiderJwt);
    expect(fresh.ok).toBe(true);
  });

  it('stops working once expired', async () => {
    await resetOutsiderMembership();
    const { token, invitationId } = await createLink();

    const db = await getDb();
    await db
      .collection('team_invitations')
      .updateOne(
        { _id: new ObjectId(invitationId) },
        { $set: { expiresAt: new Date(Date.now() - 1000) } },
      );

    const res = await wormhole('teams.joinByLink', { value: token }, outsiderJwt);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/expired/i);
  });

  it('rejects an unknown token', async () => {
    const res = await wormhole('teams.joinByLink', { value: 'f'.repeat(64) }, outsiderJwt);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/invalid/i);
  });

  it('keeps link tokens out of the email-invitation flow', async () => {
    const { token } = await createLink();
    const res = await wormhole('teams.acceptInvite', { token }, outsiderJwt);
    expect(res.ok).toBe(false);
  });

  it('leaves invite links out of the email-invitation list', async () => {
    const { invitationId } = await createLink();
    const res = await wormhole<{ invitations: Array<{ id: string }> }>(
      'teams.getPendingInvitations',
      { teamId: linkTeamId },
      ownerJwt,
    );
    expect(res.ok).toBe(true);
    expect(res.result.invitations.map((i) => i.id)).not.toContain(invitationId);
  });

  it('previews the team a link opens', async () => {
    const { token } = await createLink();
    const res = await wormhole<{ teamName: string; kind: string; requiresApproval: boolean }>(
      'teams.previewJoinLink',
      { value: token },
      outsiderJwt,
    );
    expect(res.ok).toBe(true);
    expect(res.result.teamName).toBe('Invite Link Team');
    expect(res.result.kind).toBe('link');
    expect(res.result.requiresApproval).toBe(false);
  });

  // ── The team's approval setting governs the link too ──────────────────────
  //
  // Holding a link is not a way around a setting whose purpose is to see who
  // is coming in: on a team that reviews its joiners, a link asks rather than
  // admits.
  describe('on a team that reviews its joiners', () => {
    beforeAll(async () => {
      await wormhole(
        'teams.updateSettings',
        { teamId: linkTeamId, autoAcceptJoins: false },
        ownerJwt,
      );
    });

    afterAll(async () => {
      await wormhole(
        'teams.updateSettings',
        { teamId: linkTeamId, autoAcceptJoins: true },
        ownerJwt,
      );
    });

    it('asks for approval instead of admitting', async () => {
      await resetOutsiderMembership();
      const { token } = await createLink();

      const res = await wormhole<{ status: string }>(
        'teams.joinByLink',
        { value: token },
        outsiderJwt,
      );
      expect(res.ok).toBe(true);
      expect(res.result.status).toBe('pending');

      const db = await getDb();
      const team = await db.collection('teams').findOne({ _id: new ObjectId(linkTeamId) });
      expect(team!.members).not.toContain(outsiderId);
      const request = await db
        .collection('teamjoinrequests')
        .findOne({ teamId: linkTeamId, userId: outsiderId, status: 'pending' });
      expect(request).toBeTruthy();
    });

    it('does not stack requests when the link is reopened', async () => {
      await resetOutsiderMembership();
      const { token, invitationId } = await createLink();

      await wormhole('teams.joinByLink', { value: token }, outsiderJwt);
      await wormhole('teams.joinByLink', { value: token }, outsiderJwt);

      const db = await getDb();
      const count = await db
        .collection('teamjoinrequests')
        .countDocuments({ teamId: linkTeamId, userId: outsiderId, status: 'pending' });
      expect(count).toBe(1);
      // Reopening while already waiting is not a second use of the link.
      const doc = await db
        .collection('team_invitations')
        .findOne({ _id: new ObjectId(invitationId) });
      expect(doc!.useCount).toBe(1);
    });

    it('says so in the preview, so the login page can set expectations', async () => {
      const { token } = await createLink();
      const res = await wormhole<{ kind: string; requiresApproval: boolean }>(
        'teams.previewJoinLink',
        { value: token },
        outsiderJwt,
      );
      expect(res.ok).toBe(true);
      expect(res.result.kind).toBe('link');
      expect(res.result.requiresApproval).toBe(true);
    });
  });
});

// ─── The team code is an identifier, not a credential ─────────────────────────

describe('team codes', () => {
  let codeTeamId: string;
  let codeTeamCode: string;

  beforeAll(async () => {
    const createRes = await wormhole<{ team: { id: string; code: string } }>(
      'teams.create',
      { name: 'Code Team' },
      ownerJwt,
    );
    codeTeamId = createRes.result.team.id;
    codeTeamCode = createRes.result.team.code;
  }, 30000);

  afterAll(async () => {
    const db = await getDb();
    await db.collection('teamjoinrequests').deleteMany({ teamId: codeTeamId });
    await wormhole('teams.delete', { teamId: codeTeamId }, ownerJwt).catch(() => {});
  });

  it('is generated from a CSPRNG, not Math.random', async () => {
    // 8 Crockford base32 characters, and distinct across teams.
    expect(codeTeamCode).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
    const other = await wormhole<{ team: { id: string; code: string } }>(
      'teams.create',
      { name: 'Code Team Two' },
      ownerJwt,
    );
    expect(other.result.team.code).not.toBe(codeTeamCode);
    await wormhole('teams.delete', { teamId: other.result.team.id }, ownerJwt);
  });

  it('opening a code link only requests membership — it does not grant it', async () => {
    const res = await wormhole<{ status: string }>(
      'teams.joinByLink',
      { value: codeTeamCode },
      outsiderJwt,
    );
    expect(res.ok).toBe(true);
    expect(res.result.status).toBe('pending');

    const db = await getDb();
    const team = await db.collection('teams').findOne({ _id: new ObjectId(codeTeamId) });
    expect(team!.members).not.toContain(outsiderId);
  });

  it('says so in the preview, so the login page can set expectations', async () => {
    const res = await wormhole<{ kind: string; requiresApproval: boolean }>(
      'teams.previewJoinLink',
      { value: codeTeamCode },
      outsiderJwt,
    );
    expect(res.ok).toBe(true);
    expect(res.result.kind).toBe('code');
    expect(res.result.requiresApproval).toBe(true);
  });

  it('can be rotated by an admin, retiring the old code', async () => {
    const res = await wormhole<{ code: string }>(
      'teams.rotateCode',
      { teamId: codeTeamId },
      ownerJwt,
    );
    expect(res.ok).toBe(true);
    expect(res.result.code).not.toBe(codeTeamCode);

    const stale = await wormhole('teams.previewJoinLink', { value: codeTeamCode }, outsiderJwt);
    expect(stale.ok).toBe(false);
    codeTeamCode = res.result.code;
  });

  it('cannot be rotated by a non-admin', async () => {
    const res = await wormhole('teams.rotateCode', { teamId: codeTeamId }, memberJwt);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/admin/i);
  });

  it('is unique across teams, so a code names exactly one', async () => {
    const made: string[] = [];
    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const res = await wormhole<{ team: { id: string; code: string } }>(
        'teams.create',
        { name: `Code Uniqueness ${i}` },
        ownerJwt,
      );
      expect(res.ok).toBe(true);
      made.push(res.result.team.code);
      ids.push(res.result.team.id);
    }
    expect(new Set(made).size).toBe(made.length);
    await Promise.all(ids.map((id) => wormhole('teams.delete', { teamId: id }, ownerJwt)));
  });
});

// ── Deprecated method names ───────────────────────────────────────────────────
//
// Native bundles already on people's phones call these, and their caller
// swallows errors — dropping them would make a shared link silently fail to
// join. They must keep working, with the corrected behaviour.

describe('teams.joinByQr / teams.previewByCode (deprecated aliases)', () => {
  let aliasTeamId: string;
  let aliasTeamCode: string;

  /**
   * Call over DDP, as an already-installed bundle does. These two are
   * deliberately not on the REST surface: they exist for old clients, and
   * exposing them there would widen the API for a test's convenience.
   */
  async function asOldClient<T>(method: string, args: Record<string, unknown>): Promise<T> {
    const ddp = new DDPConnection(`${METEOR_URL.replace('http://', 'ws://')}/websocket`);
    try {
      await ddp.connect();
      await ddp.login(OUTSIDER.email, OUTSIDER.password);
      return (await ddp.call(method, [args])) as T;
    } finally {
      ddp.close();
    }
  }

  beforeAll(async () => {
    const res = await wormhole<{ team: { id: string; code: string } }>(
      'teams.create',
      { name: 'Alias Team' },
      ownerJwt,
    );
    aliasTeamId = res.result.team.id;
    aliasTeamCode = res.result.team.code;
  }, 30000);

  afterAll(async () => {
    const db = await getDb();
    await db.collection('teamjoinrequests').deleteMany({ teamId: aliasTeamId });
    await db.collection('team_invitations').deleteMany({ teamId: aliasTeamId });
    await wormhole('teams.delete', { teamId: aliasTeamId }, ownerJwt).catch(() => {});
  });

  it('still previews a team by its code', async () => {
    const result = await asOldClient<{ teamName: string; kind: string }>('teams.previewByCode', {
      teamCode: aliasTeamCode,
    });
    expect(result.teamName).toBe('Alias Team');
    expect(result.kind).toBe('code');
  });

  it('routes an old client through approval rather than admitting outright', async () => {
    const db = await getDb();
    await db
      .collection('teams')
      .updateOne({ _id: new ObjectId(aliasTeamId) }, { $pull: { members: outsiderId } } as never);
    await db.collection('teamjoinrequests').deleteMany({ teamId: aliasTeamId });

    const result = await asOldClient<{ status: string }>('teams.joinByQr', {
      teamCode: aliasTeamCode,
    });
    expect(result.status).toBe('pending');

    const team = await db.collection('teams').findOne({ _id: new ObjectId(aliasTeamId) });
    expect(team!.members).not.toContain(outsiderId);
  });

  it('still redeems an invite-link token for an old client', async () => {
    const db = await getDb();
    await db.collection('teams').updateOne({ _id: new ObjectId(aliasTeamId) }, {
      $set: { 'settings.autoAcceptJoins': true },
      $pull: { members: outsiderId },
    } as never);
    await db.collection('teamjoinrequests').deleteMany({ teamId: aliasTeamId });

    const created = await wormhole<{ url: string }>(
      'teams.createInviteLink',
      { teamId: aliasTeamId },
      ownerJwt,
    );
    const token = new URL(created.result.url).searchParams.get('join')!;

    const result = await asOldClient<{ status: string }>('teams.joinByQr', { teamCode: token });
    expect(result.status).toBe('joined');

    const team = await db.collection('teams').findOne({ _id: new ObjectId(aliasTeamId) });
    expect(team!.members).toContain(outsiderId);
  });
});
