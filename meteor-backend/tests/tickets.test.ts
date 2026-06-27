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

  ownerId = String((await db.collection('user').findOne({ email: OWNER.email }))!._id);
  memberId = String((await db.collection('user').findOne({ email: MEMBER.email }))!._id);

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
    expect(res.ok).toBe(true);
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
});
