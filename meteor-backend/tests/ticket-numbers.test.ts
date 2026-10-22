/**
 * Ticket numbers (server/ticket-numbers.js), #689: each organization numbers
 * its tickets from one counter, and existing tickets are numbered oldest first.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { getDb, closeDb, ObjectId } from './helpers';
import {
  DEFAULT_TICKET_PREFIX,
  nextTicketNumber,
  normalizeTicketPrefix,
  numberExistingTickets,
  ticketPrefixesFor,
} from '../server/ticket-numbers';

const tag = `num689-${Date.now()}`;
const createdOrgs: ObjectId[] = [];
const createdTeams: ObjectId[] = [];
const createdTickets: ObjectId[] = [];

async function insertOrg(fields: Record<string, unknown> = {}) {
  const db = await getDb();
  const _id = new ObjectId();
  await db.collection('organizations').insertOne({ _id, name: `${tag}-org`, slug: `${tag}-${_id}`, ...fields });
  createdOrgs.push(_id);
  return _id.toHexString();
}

async function insertTeam(orgId: string) {
  const db = await getDb();
  const _id = new ObjectId();
  await db.collection('teams').insertOne({ _id, orgId, name: `${tag}-team`, members: [], admins: [] });
  createdTeams.push(_id);
  return _id.toHexString();
}

async function insertTicket(teamId: string, createdAt: Date, fields: Record<string, unknown> = {}) {
  const db = await getDb();
  const _id = new ObjectId();
  await db.collection('tickets').insertOne({ _id, teamId, title: `${tag}-ticket`, createdAt, ...fields });
  createdTickets.push(_id);
  return _id;
}

async function numberOf(ticketId: ObjectId) {
  const db = await getDb();
  return (await db.collection('tickets').findOne({ _id: ticketId }))?.number;
}

afterAll(async () => {
  const db = await getDb();
  await db.collection('tickets').deleteMany({ _id: { $in: createdTickets } });
  await db.collection('teams').deleteMany({ _id: { $in: createdTeams } });
  await db.collection('organizations').deleteMany({ _id: { $in: createdOrgs } });
  await db
    .collection('ticket_counters')
    .deleteMany({ _id: { $in: createdOrgs.map((id) => id.toHexString()) } as never });
  await closeDb();
});

describe('normalizeTicketPrefix', () => {
  it('uppercases and trims a valid prefix', () => {
    expect(normalizeTicketPrefix(' tj ')).toBe('TJ');
    expect(normalizeTicketPrefix('A1B2C3')).toBe('A1B2C3');
  });

  it('refuses what is not a letter followed by up to five letters or digits', () => {
    for (const bad of ['', '1TH', 'TOOLONG', 'T-H', 'T H', 42, null, undefined]) {
      expect(normalizeTicketPrefix(bad)).toBeNull();
    }
  });
});

describe('nextTicketNumber', () => {
  it('counts per organization, and never hands out the same number twice', async () => {
    const db = await getDb();
    const [a, b] = await Promise.all([insertOrg(), insertOrg()]);
    const fromA = await Promise.all(Array.from({ length: 5 }, () => nextTicketNumber(db, a)));
    expect([...fromA].sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5]);
    expect(await nextTicketNumber(db, b)).toBe(1);
  });
});

describe('ticketPrefixesFor', () => {
  it("gives each org its own prefix, and the default to one that has none", async () => {
    const db = await getDb();
    const [custom, plain] = await Promise.all([insertOrg({ ticketPrefix: 'TJ' }), insertOrg()]);
    const prefixes = await ticketPrefixesFor(db, [custom, plain, null]);
    expect(prefixes.get(custom)).toBe('TJ');
    expect(prefixes.get(plain)).toBe(DEFAULT_TICKET_PREFIX);
  });
});

describe('numberExistingTickets', () => {
  it('numbers tickets oldest first within their organization, and only once', async () => {
    const db = await getDb();
    const orgId = await insertOrg();
    const [teamA, teamB] = await Promise.all([insertTeam(orgId), insertTeam(orgId)]);
    const oldest = await insertTicket(teamB, new Date('2024-01-01'));
    const middle = await insertTicket(teamA, new Date('2024-02-01'));
    const newest = await insertTicket(teamA, new Date('2024-03-01'));
    const alreadyNumbered = await insertTicket(teamA, new Date('2023-01-01'), { number: 99 });

    await numberExistingTickets(db);
    expect(await numberOf(oldest)).toBe(1);
    expect(await numberOf(middle)).toBe(2);
    expect(await numberOf(newest)).toBe(3);
    expect(await numberOf(alreadyNumbered)).toBe(99);

    // A second run changes nothing, and the counter carries on after the backfill.
    await numberExistingTickets(db);
    expect(await numberOf(newest)).toBe(3);
    expect(await nextTicketNumber(db, orgId)).toBe(4);
  });
});
