/**
 * Tickets — wormhole REST integration tests.
 *
 * Fixture: OWNER (team admin), MEMBER (regular), OUTSIDER (not in team).
 * Tests exercise the full wormhole stack: REST → Meteor method → MongoDB.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  createUserAndGetJwt,
  wormhole,
  getDb,
  closeDb,
  purgeUser,
  ObjectId,
} from './helpers';

const OWNER = { name: 'Ticket Owner', email: 'wh-ticket-owner@test.dev', password: 'Password1!' };
const MEMBER = { name: 'Ticket Member', email: 'wh-ticket-member@test.dev', password: 'Password1!' };
const OUTSIDER = { name: 'Ticket Outsider', email: 'wh-ticket-outsider@test.dev', password: 'Password1!' };

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
  memberId = String((await db.collection('users').findOne({ 'emails.address': MEMBER.email }))!._id);

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
    );    if (!res.ok) console.error('Update failed:', res.error);    expect(res.ok).toBe(true);
    expect(res.result.status).toBe('in-progress');
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
    const res = await wormhole(
      'tickets.assign',
      { ticketId, assignedToUserIds: [''] },
      ownerJwt,
    );
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
