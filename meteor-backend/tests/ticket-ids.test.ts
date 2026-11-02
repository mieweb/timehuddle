/**
 * Ticket IDs (server/ticket-ids.js), #689: each organization numbers its
 * tickets from one counter, existing tickets are numbered oldest first, and
 * an org names the servers its outside issues live on.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { getDb, closeDb, ObjectId } from './helpers';
import {
  DEFAULT_TICKET_PREFIX,
  hostOf,
  normalizeSourcePrefixes,
  nextTicketNumber,
  normalizeTicketPrefix,
  numberExistingTickets,
  ticketIdsFor,
} from '../server/ticket-ids';

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

describe('ticketIdsFor', () => {
  it("gives each org its own prefixes, and the defaults to one that has set none", async () => {
    const db = await getDb();
    const servers = [{ host: 'redmine.example.com', prefix: 'PM' }];
    const [custom, plain] = await Promise.all([
      insertOrg({ ticketPrefix: 'TJ', sourcePrefixes: servers }),
      insertOrg(),
    ]);
    const ids = await ticketIdsFor(db, [custom, plain, null]);
    expect(ids.get(custom)).toEqual({ ticketPrefix: 'TJ', sourcePrefixes: servers });
    expect(ids.get(plain)).toEqual({ ticketPrefix: DEFAULT_TICKET_PREFIX, sourcePrefixes: [] });
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

describe('hostOf', () => {
  it('takes the lowercase host from a URL or a bare hostname', () => {
    expect(hostOf('https://Redmine.Example.com/issues/12?x=1')).toBe('redmine.example.com');
    expect(hostOf('redmine.example.com')).toBe('redmine.example.com');
    expect(hostOf('http://localhost:3200')).toBe('localhost');
  });

  it('refuses what is not a server address', () => {
    for (const bad of ['', '   ', 'not a host', 'nodot', null]) expect(hostOf(bad)).toBeNull();
  });
});

describe('normalizeSourcePrefixes', () => {
  it('stores bare hosts, the address, and uppercase prefixes', () => {
    expect(
      normalizeSourcePrefixes([{ host: 'https://redmine.example.com/projects', prefix: 'pm' }], 'TH'),
    ).toEqual([
      {
        host: 'redmine.example.com',
        prefix: 'PM',
        type: 'redmine',
        baseUrl: 'https://redmine.example.com/projects',
      },
    ]);
  });

  it('keeps a server\'s rounding, storing exact as nothing', () => {
    const [rounded, exact] = normalizeSourcePrefixes(
      [
        { host: 'a.example.com', prefix: 'AA', rounding: 'up10' },
        { host: 'b.example.com', prefix: 'BB', rounding: 'exact' },
      ],
      'TH',
    );
    expect(rounded.rounding).toBe('up10');
    expect(exact).not.toHaveProperty('rounding');
    expect(() =>
      normalizeSourcePrefixes([{ host: 'a.example.com', prefix: 'AA', rounding: 'up30' }], 'TH'),
    ).toThrow(/not a rounding/);
    for (const inherited of ['up3', 'constructor', '__proto__', 'toString']) {
      expect(() =>
        normalizeSourcePrefixes([{ host: 'a.example.com', prefix: 'AA', rounding: inherited }], 'TH'),
      ).toThrow(/not a rounding/);
    }
  });

  it('refuses a repeated host, a repeated prefix, or the org ticket prefix', () => {
    const row = { host: 'a.example.com', prefix: 'AA' };
    expect(() => normalizeSourcePrefixes([row, { ...row, prefix: 'BB' }], 'TH')).toThrow(/twice/);
    expect(() => normalizeSourcePrefixes([row, { host: 'b.example.com', prefix: 'aa' }], 'TH')).toThrow(
      /already in use/,
    );
    expect(() => normalizeSourcePrefixes([{ host: 'c.example.com', prefix: 'TH' }], 'TH')).toThrow(
      /already in use/,
    );
  });

  it('refuses a bad host, a bad prefix, or something that is not a list', () => {
    expect(() => normalizeSourcePrefixes([{ host: 'nope', prefix: 'PM' }], 'TH')).toThrow(/server address/);
    expect(() => normalizeSourcePrefixes([{ host: 'a.example.com', prefix: '9' }], 'TH')).toThrow(/prefix/);
    expect(() => normalizeSourcePrefixes('PM', 'TH')).toThrow(/list/);
  });
});
