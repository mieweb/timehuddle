/**
 * Tickets — wormhole REST integration tests.
 *
 * Fixture: OWNER (team admin), MEMBER (regular), OUTSIDER (not in team).
 * Tests exercise the full wormhole stack: REST → Meteor method → MongoDB.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { createUserAndGetJwt, wormhole, getDb, closeDb, purgeUser, ObjectId } from './helpers';

const OWNER = { name: 'Ticket Owner', email: 'wh-ticket-owner@test.dev', password: 'Password1!' };
const MEMBER = {
  name: 'Ticket Member',
  email: 'wh-ticket-member@test.dev',
  password: 'Password1!',
};
const OUTSIDER = {
  name: 'Ticket Outsider',
  email: 'wh-ticket-outsider@test.dev',
  password: 'Password1!',
};

let ownerJwt: string;
let memberJwt: string;
let outsiderJwt: string;
let teamId: string;
let ownerId: string;
let memberId: string;

beforeAll(async () => {
  const db = await getDb();
  await Promise.all([purgeUser(OWNER.email), purgeUser(MEMBER.email), purgeUser(OUTSIDER.email)]);

  const [owner, member, outsider] = await Promise.all([
    createUserAndGetJwt(OWNER),
    createUserAndGetJwt(MEMBER),
    createUserAndGetJwt(OUTSIDER),
  ]);
  ownerJwt = owner.jwt;
  memberJwt = member.jwt;
  outsiderJwt = outsider.jwt;

  ownerId = String((await db.collection('users').findOne({ 'emails.address': OWNER.email }))!._id);
  memberId = String(
    (await db.collection('users').findOne({ 'emails.address': MEMBER.email }))!._id,
  );

  const teamDoc = {
    _id: new ObjectId(),
    name: 'WH Ticket Team',
    members: [ownerId, memberId],
    admins: [ownerId],
    code: 'WHTICKET',
    isPersonal: false,
    createdAt: new Date(),
  };
  await db.collection('teams').insertOne(teamDoc);
  teamId = teamDoc._id.toHexString();
});

afterAll(async () => {
  const db = await getDb();
  await db.collection('teams').deleteMany({ code: 'WHTICKET' });
  await db.collection('tickets').deleteMany({ teamId });
  await Promise.all([purgeUser(OWNER.email), purgeUser(MEMBER.email), purgeUser(OUTSIDER.email)]);
  await closeDb();
});

describe('tickets (wormhole)', () => {
  let ticketId: string;

  it('rejects unauthenticated calls', async () => {
    const res = await wormhole('tickets.create', { teamId, title: 'Nope' }, 'invalid-jwt');
    expect(res.ok).toBe(false);
  });

  it('creates a ticket', async () => {
    const res = await wormhole<{ id: string; title: string; teamId: string; createdBy: string }>(
      'tickets.create',
      { teamId, title: 'Test Ticket', description: 'A test', priority: 'medium' },
      ownerJwt,
    );
    expect(res.ok).toBe(true);
    expect(res.result.title).toBe('Test Ticket');
    expect(res.result.teamId).toBe(teamId);
    expect(res.result.createdBy).toBe(ownerId);
    ticketId = res.result.id;
  });

  it('lists tickets for the team', async () => {
    const res = await wormhole<Array<{ id: string; title: string }>>(
      'tickets.list',
      { teamId },
      ownerJwt,
    );
    expect(res.ok).toBe(true);
    expect(Array.isArray(res.result)).toBe(true);
    expect(res.result.some((t) => t.id === ticketId)).toBe(true);
  });

  it('member can list tickets', async () => {
    const res = await wormhole('tickets.list', { teamId }, memberJwt);
    expect(res.ok).toBe(true);
  });

  it('outsider cannot list tickets', async () => {
    const res = await wormhole('tickets.list', { teamId }, outsiderJwt);
    expect(res.ok).toBe(false);
  });

  it('updates ticket status', async () => {
    const res = await wormhole<{ id: string; status: string }>(
      'tickets.updateStatus',
      { ticketId, status: 'in-progress' },
      ownerJwt,
    );
    if (!res.ok) console.error('Update failed:', res.error);
    expect(res.ok).toBe(true);
    expect(res.result.status).toBe('in-progress');
  });

  it('clears ticket priority with none', async () => {
    const setRes = await wormhole<{ id: string; priority?: string | null }>(
      'tickets.updateStatus',
      { ticketId, priority: 'high' },
      ownerJwt,
    );
    expect(setRes.ok).toBe(true);
    expect(setRes.result.priority).toBe('high');

    const clearRes = await wormhole<{ id: string; priority?: string | null }>(
      'tickets.updateStatus',
      { ticketId, priority: 'none' },
      ownerJwt,
    );
    expect(clearRes.ok).toBe(true);
    expect(clearRes.result.priority == null).toBe(true);
  });

  it('updates ticket title and description', async () => {
    const res = await wormhole<{ id: string; title: string; description: string }>(
      'tickets.update',
      { ticketId, title: 'Updated Title', description: 'Updated desc' },
      ownerJwt,
    );
    expect(res.ok).toBe(true);
    expect(res.result.title).toBe('Updated Title');
  });

  it('assigns ticket to member', async () => {
    const res = await wormhole<{ id: string; assignedTo: string[] }>(
      'tickets.assign',
      { ticketId, assignedToUserIds: [memberId] },
      ownerJwt,
    );
    expect(res.ok).toBe(true);
    expect(res.result.assignedTo).toContain(memberId);
  });

  it('assigns ticket to multiple users', async () => {
    const res = await wormhole<{ id: string; assignedTo: string[] }>(
      'tickets.assign',
      { ticketId, assignedToUserIds: [ownerId, memberId] },
      ownerJwt,
    );
    expect(res.ok).toBe(true);
    expect(res.result.assignedTo).toHaveLength(2);
    expect(res.result.assignedTo).toContain(ownerId);
    expect(res.result.assignedTo).toContain(memberId);
  });

  it('unassigns all users from ticket (empty array)', async () => {
    const res = await wormhole<{ id: string; assignedTo: string[] }>(
      'tickets.assign',
      { ticketId, assignedToUserIds: [] },
      ownerJwt,
    );
    expect(res.ok).toBe(true);
    expect(res.result.assignedTo).toEqual([]);
  });

  it('reassigns ticket to different user', async () => {
    // First assign to owner
    await wormhole('tickets.assign', { ticketId, assignedToUserIds: [ownerId] }, ownerJwt);

    // Then reassign to member
    const res = await wormhole<{ id: string; assignedTo: string[] }>(
      'tickets.assign',
      { ticketId, assignedToUserIds: [memberId] },
      ownerJwt,
    );
    expect(res.ok).toBe(true);
    expect(res.result.assignedTo).toHaveLength(1);
    expect(res.result.assignedTo).toContain(memberId);
    expect(res.result.assignedTo).not.toContain(ownerId);
  });

  it('rejects assignment with invalid user ID (empty string)', async () => {
    const res = await wormhole('tickets.assign', { ticketId, assignedToUserIds: [''] }, ownerJwt);
    expect(res.ok).toBe(false);
    expect(res.error).toContain('assignedToUserIds must be an array of user ids');
  });

  it('rejects assignment with non-array value', async () => {
    const res = await wormhole(
      'tickets.assign',
      { ticketId, assignedToUserIds: 'not-an-array' as any },
      ownerJwt,
    );
    expect(res.ok).toBe(false);
    expect(res.error).toContain('assignedToUserIds must be an array of user ids');
  });

  it('rejects assignment with invalid user ID format', async () => {
    const res = await wormhole(
      'tickets.assign',
      { ticketId, assignedToUserIds: ['invalid!@#'] },
      ownerJwt,
    );
    expect(res.ok).toBe(false);
    expect(res.error).toContain('assignedToUserIds must be an array of user ids');
  });

  it('rejects assignment of user not in team', async () => {
    const db = await getDb();
    const outsiderDoc = await db.collection('users').findOne({ 'emails.address': OUTSIDER.email });
    const outsiderId = String(outsiderDoc!._id);

    const res = await wormhole(
      'tickets.assign',
      { ticketId, assignedToUserIds: [outsiderId] },
      ownerJwt,
    );
    expect(res.ok).toBe(false);
    expect(res.error).toContain('All assignees must be team members');
  });

  it('creates a ticket assigned to the chosen team members (M6 dialog)', async () => {
    const res = await wormhole<{ assignedTo: string[] }>(
      'tickets.create',
      { teamId, title: 'Assigned at creation', assignedToUserIds: [memberId] },
      ownerJwt,
    );
    expect(res.ok).toBe(true);
    expect(res.result.assignedTo).toEqual([memberId]);
  });

  it('still assigns the creator when no assignees are given', async () => {
    const res = await wormhole<{ assignedTo: string[] }>(
      'tickets.create',
      { teamId, title: 'Default assignee' },
      memberJwt,
    );
    expect(res.result.assignedTo).toEqual([memberId]);
  });

  it('rejects creating a ticket assigned to someone outside the team', async () => {
    const db = await getDb();
    const outsiderDoc = await db.collection('users').findOne({ 'emails.address': OUTSIDER.email });
    const res = await wormhole(
      'tickets.create',
      { teamId, title: 'Nope', assignedToUserIds: [String(outsiderDoc!._id)] },
      ownerJwt,
    );
    expect(res.ok).toBe(false);
    expect(res.error).toContain('All assignees must be team members');
  });

  it('batch updates status', async () => {
    const res = await wormhole<{ modified: number }>(
      'tickets.batchStatus',
      { ticketIds: [ticketId], teamId, status: 'reviewed' },
      ownerJwt,
    );
    expect(res.ok).toBe(true);
    expect(res.result.modified).toBe(1);
  });

  it('soft-deletes a ticket', async () => {
    const res = await wormhole<{ ok: boolean }>('tickets.delete', { ticketId }, ownerJwt);
    expect(res.ok).toBe(true);
  });

  describe('My Board on create (#636)', () => {
    it('puts a new ticket on its creator\u2019s board, and nobody else\u2019s', async () => {
      const res = await wormhole<{ id: string }>(
        'tickets.create',
        { teamId, title: 'Lands on my board' },
        ownerJwt,
      );
      expect(res.ok).toBe(true);

      const db = await getDb();
      const rows = await db.collection('my_board').find({ ticketId: res.result.id }).toArray();
      expect(rows.map((row) => ({ userId: row.userId, sourceId: row.sourceId }))).toEqual([
        { userId: ownerId, sourceId: 'huddle' },
      ]);
    });

    it('still creates the ticket when the board is full', async () => {
      const db = await getDb();
      const filler = Array.from({ length: 500 }, (_, i) => ({
        _id: new ObjectId(),
        userId: memberId,
        sourceId: 'redmine',
        ticketId: String(900000 + i),
        addedAt: new Date(),
      }));
      // Earlier tests in this file created tickets as the member too.
      await db.collection('my_board').deleteMany({ userId: memberId });
      await db.collection('my_board').insertMany(filler);
      try {
        const res = await wormhole<{ id: string }>(
          'tickets.create',
          { teamId, title: 'Board is full' },
          memberJwt,
        );
        expect(res.ok).toBe(true);
        expect(await db.collection('my_board').countDocuments({ userId: memberId })).toBe(500);
      } finally {
        await db.collection('my_board').deleteMany({ userId: memberId });
      }
    });
  });

  describe('linking to a Redmine issue (#636)', () => {
    let linkTicketId: string;

    const seedLink = async (id: string | null) => {
      const db = await getDb();
      await db
        .collection('tickets')
        .updateOne(
          { _id: new ObjectId(linkTicketId) },
          id
            ? { $set: { linkedIssue: { source: 'redmine', id } } }
            : { $unset: { linkedIssue: '' } },
        );
    };

    beforeAll(async () => {
      const res = await wormhole<{ id: string }>(
        'tickets.create',
        { teamId, title: 'Link me' },
        ownerJwt,
      );
      linkTicketId = res.result.id;
    });

    it('refuses an outsider', async () => {
      const res = await wormhole(
        'tickets.link',
        { ticketId: linkTicketId, issueId: 482, expectedIssueId: null },
        outsiderJwt,
      );
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/not allowed/i);
    });

    it('refuses something that is not an issue number', async () => {
      for (const issueId of [0, -3, 'abc', null]) {
        const res = await wormhole(
          'tickets.link',
          { ticketId: linkTicketId, issueId, expectedIssueId: null },
          ownerJwt,
        );
        expect(res.ok).toBe(false);
        expect(res.error).toMatch(/Redmine issue number/i);
      }
    });

    it('needs the caller to have connected Redmine', async () => {
      const res = await wormhole(
        'tickets.link',
        { ticketId: linkTicketId, issueId: 482, expectedIssueId: null },
        memberJwt,
      );
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/connect your Redmine account/i);
    });

    it('refuses a link made against a link someone else changed', async () => {
      await seedLink('482');
      const res = await wormhole(
        'tickets.link',
        { ticketId: linkTicketId, issueId: 500, expectedIssueId: null },
        memberJwt,
      );
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/changed by someone else/i);
    });

    it('refuses an unlink made against a different link', async () => {
      await seedLink('482');
      const res = await wormhole(
        'tickets.unlink',
        { ticketId: linkTicketId, expectedIssueId: '500' },
        memberJwt,
      );
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/changed by someone else/i);
    });

    it('lets any team member unlink, without a Redmine account, and records it', async () => {
      await seedLink('482');
      const res = await wormhole<{ id: string; linkedIssue?: unknown }>(
        'tickets.unlink',
        { ticketId: linkTicketId, expectedIssueId: '482' },
        memberJwt,
      );
      expect(res.ok).toBe(true);
      expect(res.result.linkedIssue).toBeUndefined();

      const db = await getDb();
      const stored = await db.collection('tickets').findOne({ _id: new ObjectId(linkTicketId) });
      expect(stored?.linkedIssue).toBeUndefined();

      // Ids only: the activity names the issue by number, never by subject.
      const activity = await db
        .collection('activities')
        .findOne({ 'payload.ticketId': linkTicketId, 'payload.action': 'unlinked' });
      expect(activity?.payload).toMatchObject({ previousIssueId: '482' });
      expect(activity?.userId).toBe(memberId);
    });

    it('keeps one link per ticket: no GitHub link while it is linked to Redmine', async () => {
      await seedLink('482');
      const refused = await wormhole(
        'tickets.update',
        { ticketId: linkTicketId, github: 'https://github.com/a/b/issues/1' },
        memberJwt,
      );
      expect(refused.ok).toBe(false);
      expect(refused.error).toMatch(/Remove that link before adding a GitHub link/);

      // Clearing a GitHub link, and editing other fields, stay allowed.
      const cleared = await wormhole(
        'tickets.update',
        { ticketId: linkTicketId, github: '', description: 'Edited while linked' },
        memberJwt,
      );
      expect(cleared.ok).toBe(true);

      await seedLink(null);
      const allowed = await wormhole<{ github: string }>(
        'tickets.update',
        { ticketId: linkTicketId, github: 'https://github.com/a/b/issues/1' },
        memberJwt,
      );
      expect(allowed.result.github).toBe('https://github.com/a/b/issues/1');
    });

    it('only stores an https link, on create and on update', async () => {
      await seedLink(null);
      for (const github of ['javascript:alert(1)', 'data:text/html,x', 'http://github.com/a/b']) {
        const created = await wormhole(
          'tickets.create',
          { teamId, title: 'Bad link', github },
          ownerJwt,
        );
        expect(created.ok, github).toBe(false);
        expect(created.error, github).toMatch(/https:\/\//);
        const updated = await wormhole(
          'tickets.update',
          { ticketId: linkTicketId, github },
          ownerJwt,
        );
        expect(updated.ok, github).toBe(false);
      }
      const ok = await wormhole<{ github: string }>(
        'tickets.update',
        { ticketId: linkTicketId, github: 'https://tracker.example.com/issues/9' },
        ownerJwt,
      );
      expect(ok.result.github).toBe('https://tracker.example.com/issues/9');
      await wormhole('tickets.update', { ticketId: linkTicketId, github: '' }, ownerJwt);
    });

    it('treats unlinking an unlinked ticket as nothing to do', async () => {
      await seedLink(null);
      const res = await wormhole(
        'tickets.unlink',
        { ticketId: linkTicketId, expectedIssueId: '482' },
        ownerJwt,
      );
      expect(res.ok).toBe(true);
    });

    describe('the lock while someone is timing it', () => {
      /** A timer session on the link ticket, inside a shift that is open or already closed. */
      const seedTimer = async (userId: string, { running = true, shiftOpen = true } = {}) => {
        const db = await getDb();
        const shiftId = new ObjectId();
        const workItemId = new ObjectId();
        const now = Date.now();
        await db.collection('clockevents').insertOne({
          _id: shiftId,
          userId,
          teamId,
          startTime: now - 3_600_000,
          endTime: shiftOpen ? null : now - 60_000,
        });
        await db.collection('workitems').insertOne({
          _id: workItemId,
          userId,
          source: 'huddle',
          ticketId: linkTicketId,
          date: '2026-10-04',
        });
        await db.collection('timers').insertOne({
          _id: new ObjectId(),
          userId,
          workItemId: workItemId.toHexString(),
          clockEventId: shiftId.toHexString(),
          date: '2026-10-04',
          startTime: now - 600_000,
          endTime: running ? null : now - 60_000,
          ...(running ? {} : { durationSeconds: 540 }),
        });
      };

      const clearTimers = async () => {
        const db = await getDb();
        const items = await db.collection('workitems').find({ ticketId: linkTicketId }).toArray();
        await db
          .collection('timers')
          .deleteMany({ workItemId: { $in: items.map((item) => item._id.toHexString()) } });
        await db.collection('workitems').deleteMany({ ticketId: linkTicketId });
        await db.collection('clockevents').deleteMany({ teamId });
      };

      afterEach(clearTimers);

      it('refuses every change to a linked ticket, and says whose timer it is', async () => {
        await seedLink('482');
        await seedTimer(memberId);

        const attempts: Array<[string, Record<string, unknown>]> = [
          ['tickets.update', { ticketId: linkTicketId, title: 'Renamed' }],
          ['tickets.updateStatus', { ticketId: linkTicketId, status: 'closed' }],
          ['tickets.assign', { ticketId: linkTicketId, assignedToUserIds: [ownerId] }],
          ['tickets.delete', { ticketId: linkTicketId }],
          ['tickets.unlink', { ticketId: linkTicketId, expectedIssueId: '482' }],
        ];
        for (const [method, params] of attempts) {
          const res = await wormhole(method, params, ownerJwt);
          expect(res.ok, method).toBe(false);
          expect(res.error, method).toMatch(/Ticket Member is timing this ticket/);
        }

        const mine = await wormhole(
          'tickets.update',
          { ticketId: linkTicketId, title: 'Renamed' },
          memberJwt,
        );
        expect(mine.error).toMatch(/You are timing this ticket. Stop your timer/);

        const status = await wormhole<{
          lock: { holders: Array<{ userId: string; name: string }> };
        }>('tickets.lockStatus', { ticketId: linkTicketId }, ownerJwt);
        expect(status.result.lock.holders).toEqual([{ userId: memberId, name: 'Ticket Member' }]);
      });

      it('leaves an unlinked ticket editable, but will not link it mid-timer', async () => {
        await seedLink(null);
        await seedTimer(memberId);

        const edit = await wormhole(
          'tickets.update',
          { ticketId: linkTicketId, description: 'Still editable' },
          ownerJwt,
        );
        expect(edit.ok).toBe(true);

        const link = await wormhole(
          'tickets.link',
          { ticketId: linkTicketId, issueId: 482, expectedIssueId: null },
          ownerJwt,
        );
        expect(link.error).toMatch(/is timing this ticket/);

        const status = await wormhole<{ lock: unknown }>(
          'tickets.linkStatus',
          { ticketId: linkTicketId },
          ownerJwt,
        );
        expect(status.result.lock).toBeNull();
      });

      it('ignores a timer left running after its shift ended', async () => {
        await seedLink('482');
        await seedTimer(memberId, { shiftOpen: false });
        const res = await wormhole(
          'tickets.update',
          { ticketId: linkTicketId, description: 'Orphaned timer does not lock' },
          ownerJwt,
        );
        expect(res.ok).toBe(true);
      });

      it('skips a locked ticket in a batch and reports it', async () => {
        await seedLink('482');
        await seedTimer(memberId);
        const res = await wormhole<{ modified: number; lockedIds: string[] }>(
          'tickets.batchStatus',
          { ticketIds: [linkTicketId], teamId, status: 'closed' },
          ownerJwt,
        );
        expect(res.result).toEqual({ modified: 0, lockedIds: [linkTicketId] });
      });

      it('tells teammates who logged time when the link changes, and not the person who changed it', async () => {
        await seedLink('482');
        await seedTimer(memberId, { running: false });
        await seedTimer(ownerId, { running: false });
        const db = await getDb();
        await db.collection('notifications').deleteMany({ 'data.ticketId': linkTicketId });

        const res = await wormhole(
          'tickets.unlink',
          { ticketId: linkTicketId, expectedIssueId: '482' },
          ownerJwt,
        );
        expect(res.ok).toBe(true);

        const sent = await db
          .collection('notifications')
          .find({ 'data.ticketId': linkTicketId, 'data.type': 'ticket-link-changed' })
          .toArray();
        expect(sent.map((n) => n.userId)).toEqual([memberId]);
        expect(sent[0].body).toBe(
          'Ticket Owner unlinked "Link me", a ticket you worked on, from Redmine #482',
        );
        expect(sent[0].data.url).toBe(`/app/tickets/${linkTicketId}`);
      });
    });

    it('publishes the link on the ticket it reads back', async () => {
      await seedLink('482');
      const res = await wormhole<{ linkedIssue?: { source: string; id: string } }>(
        'tickets.get',
        { ticketId: linkTicketId },
        memberJwt,
      );
      expect(res.result.linkedIssue).toEqual({ source: 'redmine', id: '482' });
    });
  });

  describe('TimeHarbor integration', () => {
    let harborTicketId1: string;
    let harborTicketId2: string;

    it('creates test tickets for TimeHarbor', async () => {
      const res1 = await wormhole<{ id: string }>(
        'tickets.create',
        { teamId, title: 'TimeHarbor Test 1' },
        ownerJwt,
      );
      expect(res1.ok).toBe(true);
      harborTicketId1 = res1.result.id;

      const res2 = await wormhole<{ id: string }>(
        'tickets.create',
        { teamId, title: 'TimeHarbor Test 2' },
        ownerJwt,
      );
      expect(res2.ok).toBe(true);
      harborTicketId2 = res2.result.id;
    });

    it('shares a single ticket with TimeHarbor', async () => {
      const res = await wormhole<{ ok: boolean }>(
        'tickets.shareWithTimeharbor',
        { ticketId: harborTicketId1, shared: true },
        ownerJwt,
      );
      expect(res.ok).toBe(true);

      // Verify database was updated
      const db = await getDb();
      const ticket = await db.collection('tickets').findOne({ _id: new ObjectId(harborTicketId1) });
      expect(ticket?.sharedWithTimeharbor).toBe(true);
    });

    it('unshares a single ticket from TimeHarbor', async () => {
      const res = await wormhole<{ ok: boolean }>(
        'tickets.shareWithTimeharbor',
        { ticketId: harborTicketId1, shared: false },
        ownerJwt,
      );
      expect(res.ok).toBe(true);

      // Verify database was updated
      const db = await getDb();
      const ticket = await db.collection('tickets').findOne({ _id: new ObjectId(harborTicketId1) });
      expect(ticket?.sharedWithTimeharbor).toBe(false);
    });

    it('bulk shares multiple tickets with TimeHarbor', async () => {
      const res = await wormhole<{ modifiedCount: number }>(
        'tickets.bulkShareWithTimeharbor',
        { ticketIds: [harborTicketId1, harborTicketId2], shared: true },
        ownerJwt,
      );
      expect(res.ok).toBe(true);
      expect(res.result.modifiedCount).toBe(2);

      // Verify both tickets were updated
      const db = await getDb();
      const tickets = await db
        .collection('tickets')
        .find({ _id: { $in: [new ObjectId(harborTicketId1), new ObjectId(harborTicketId2)] } })
        .toArray();
      expect(tickets).toHaveLength(2);
      expect(tickets.every((t) => t.sharedWithTimeharbor === true)).toBe(true);
    });

    it('bulk unshares multiple tickets from TimeHarbor', async () => {
      const res = await wormhole<{ modifiedCount: number }>(
        'tickets.bulkShareWithTimeharbor',
        { ticketIds: [harborTicketId1, harborTicketId2], shared: false },
        ownerJwt,
      );
      expect(res.ok).toBe(true);
      expect(res.result.modifiedCount).toBe(2);

      // Verify both tickets were updated
      const db = await getDb();
      const tickets = await db
        .collection('tickets')
        .find({ _id: { $in: [new ObjectId(harborTicketId1), new ObjectId(harborTicketId2)] } })
        .toArray();
      expect(tickets).toHaveLength(2);
      expect(tickets.every((t) => t.sharedWithTimeharbor === false)).toBe(true);
    });

    it('rejects outsider sharing ticket with TimeHarbor', async () => {
      const res = await wormhole(
        'tickets.shareWithTimeharbor',
        { ticketId: harborTicketId1, shared: true },
        outsiderJwt,
      );
      expect(res.ok).toBe(false);
    });

    it('rejects outsider bulk sharing tickets with TimeHarbor', async () => {
      const res = await wormhole(
        'tickets.bulkShareWithTimeharbor',
        { ticketIds: [harborTicketId1, harborTicketId2], shared: true },
        outsiderJwt,
      );
      expect(res.ok).toBe(false);
    });

    it('member can share tickets with TimeHarbor', async () => {
      const res = await wormhole<{ ok: boolean }>(
        'tickets.shareWithTimeharbor',
        { ticketId: harborTicketId1, shared: true },
        memberJwt,
      );
      expect(res.ok).toBe(true);
    });
  });
});

describe('tickets.dashboardSummary (wormhole)', () => {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const HOUR_MS = 60 * 60 * 1000;
  let summaryTeamId: string;

  beforeAll(async () => {
    const db = await getDb();
    const team = {
      _id: new ObjectId(),
      name: 'WH Summary Team',
      members: [ownerId, memberId],
      admins: [ownerId],
      code: 'WHSUMMARY',
      isPersonal: false,
      createdAt: new Date(),
    };
    await db.collection('teams').insertOne(team);
    summaryTeamId = team._id.toHexString();

    const now = new Date();
    const longAgo = new Date(Date.now() - 3 * DAY_MS);
    const ticket = (fields: Record<string, unknown>) => ({
      teamId: summaryTeamId,
      title: 'Summary ticket',
      github: '',
      createdBy: ownerId,
      createdAt: longAgo,
      updatedAt: longAgo,
      ...fields,
    });
    await db
      .collection('tickets')
      .insertMany([
        ticket({ status: 'open', priority: 'high', assignedTo: [ownerId], description: 'Steps' }),
        ticket({ status: 'open', assignedTo: [] }),
        ticket({ status: 'in-progress', priority: 'critical', assignedTo: [memberId] }),
        ticket({ status: 'closed', assignedTo: [ownerId], updatedAt: now }),
        ticket({ status: 'reviewed', priority: 'high', assignedTo: [ownerId], updatedAt: now }),
        ticket({ status: 'closed', assignedTo: [ownerId] }),
        ticket({ status: 'deleted', priority: 'high', assignedTo: [ownerId] }),
      ]);
  });

  afterAll(async () => {
    const db = await getDb();
    await db.collection('teams').deleteMany({ code: 'WHSUMMARY' });
    await db.collection('tickets').deleteMany({ teamId: summaryTeamId });
  });

  const window = () => ({ since: Date.now() - HOUR_MS, until: Date.now() + HOUR_MS });

  it("lists only one assignee's open tickets, without descriptions when brief", async () => {
    const res = await wormhole<
      Array<{ assignedTo: string[]; status: string; description?: string }>
    >(
      'tickets.list',
      { teamId: summaryTeamId, assignedTo: ownerId, activeOnly: true, brief: true },
      memberJwt,
    );
    expect(res.ok).toBe(true);
    expect(res.result).toHaveLength(1);
    expect(res.result[0].assignedTo).toContain(ownerId);
    expect(res.result[0].status).toBe('open');
    expect(res.result[0].description ?? null).toBeNull();
  });

  it('counts team-wide and for the caller, ignoring deleted tickets', async () => {
    const res = await wormhole<Record<string, number>>(
      'tickets.dashboardSummary',
      { teamId: summaryTeamId, ...window() },
      ownerJwt,
    );
    expect(res.ok).toBe(true);
    expect(res.result).toEqual({
      open: 3,
      unassignedOpen: 1,
      closedToday: 2,
      highPriorityOpen: 2,
      myOpen: 1,
      myClosedToday: 2,
      myHighPriorityOpen: 1,
    });
  });

  it('scopes the "my" counts to the caller', async () => {
    const res = await wormhole<Record<string, number>>(
      'tickets.dashboardSummary',
      { teamId: summaryTeamId, ...window() },
      memberJwt,
    );
    expect(res.ok).toBe(true);
    expect(res.result).toMatchObject({
      open: 3,
      myOpen: 1,
      myClosedToday: 0,
      myHighPriorityOpen: 1,
    });
  });

  it('returns zeros for a team with no tickets', async () => {
    const res = await wormhole<Record<string, number>>(
      'tickets.dashboardSummary',
      { teamId, since: Date.now() - HOUR_MS, until: Date.now() + HOUR_MS },
      ownerJwt,
    );
    expect(res.ok).toBe(true);
    expect(Object.keys(res.result)).toHaveLength(7);
  });

  it('rejects outsiders and missing day bounds', async () => {
    const outsider = await wormhole(
      'tickets.dashboardSummary',
      { teamId: summaryTeamId, ...window() },
      outsiderJwt,
    );
    expect(outsider.ok).toBe(false);

    const noBounds = await wormhole(
      'tickets.dashboardSummary',
      { teamId: summaryTeamId },
      ownerJwt,
    );
    expect(noBounds.ok).toBe(false);
  });
});
