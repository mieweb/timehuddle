/**
 * Finding tickets by a typed ID (server/ticket-search-core.js), #736c. The
 * selectors run against the test database, so Mongo itself reads the regexes.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getDb, closeDb, ObjectId } from './helpers';
import { ticketIdsFor } from '../server/ticket-ids';
import { parseTicketRef, ticketRefSelector } from '../server/ticket-search-core';

const tag = `ref736c-${Date.now()}`;
const REDMINE_HOST = 'redmine.test';
const created = { organizations: [] as ObjectId[], teams: [] as ObjectId[], tickets: [] as ObjectId[] };

async function insert(collection: keyof typeof created, fields: Record<string, unknown>) {
  const db = await getDb();
  const _id = new ObjectId();
  await db.collection(collection).insertOne({ _id, ...fields });
  created[collection].push(_id);
  return _id.toHexString();
}

const ticket = (teamId: string, name: string, fields: Record<string, unknown> = {}) =>
  insert('tickets', { teamId, title: `${tag} ${name}`, status: 'open', ...fields });

let teams: { id: string; orgId: string | null }[];
const ids: Record<string, string> = {};

/** The titles of the tickets `query` finds, sorted. */
async function find(query: string) {
  const ref = parseTicketRef(query);
  if (!ref) return null;
  const db = await getDb();
  const idsByOrg = await ticketIdsFor(db, teams.map((team) => team.orgId).filter(Boolean) as string[]);
  const selector = ticketRefSelector(ref, { teams, idsByOrg, redmineHost: REDMINE_HOST });
  if (!selector) return [];
  const docs = await db
    .collection('tickets')
    .find({ $and: [selector, { _id: { $in: created.tickets } }] })
    .toArray();
  return docs.map((doc) => String(doc.title).slice(tag.length + 1)).sort();
}

beforeAll(async () => {
  const thx = await insert('organizations', {
    name: `${tag}-thx`,
    slug: `${tag}-thx`,
    ticketPrefix: 'THX',
    sourcePrefixes: [{ host: REDMINE_HOST, prefix: 'RM0' }],
  });
  const plain = await insert('organizations', { name: `${tag}-plain`, slug: `${tag}-plain` });
  const a1 = await insert('teams', { orgId: thx, name: `${tag}-a1` });
  const a2 = await insert('teams', { orgId: thx, name: `${tag}-a2` });
  const b1 = await insert('teams', { orgId: plain, name: `${tag}-b1` });
  const outside = await insert('teams', { orgId: thx, name: `${tag}-outside` });
  teams = [a1, a2, b1].map((id, i) => ({ id, orgId: i < 2 ? thx : plain }));

  ids.numbered = await ticket(a1, 'numbered', { number: 12 });
  await ticket(a2, 'carrier', { number: 5, linkedIssue: { source: 'redmine', id: '233' } });
  await ticket(a1, 'carrier-with-host', {
    number: 6,
    linkedIssue: { source: 'redmine', id: '233', host: REDMINE_HOST },
  });
  await ticket(a1, 'other-server', {
    number: 9,
    linkedIssue: { source: 'redmine', id: '233', host: 'elsewhere.test' },
  });
  await ticket(b1, 'github', { number: 7, github: 'https://github.com/mieweb/timehuddle/issues/223' });
  await ticket(a2, 'github-fork', { number: 10, github: 'https://github.com/someone/TimeHuddle/pull/223' });
  await ticket(a1, 'redmine-link', { number: 8, github: `https://${REDMINE_HOST}/issues/233#note-2` });
  await ticket(a1, 'number-223', { number: 223 });
  await ticket(a1, 'deleted', { number: 12, status: 'deleted' });
  await ticket(outside, 'not-my-team', { number: 12 });
});

afterAll(async () => {
  const db = await getDb();
  for (const [collection, list] of Object.entries(created)) {
    await db.collection(collection).deleteMany({ _id: { $in: list } });
  }
  await closeDb();
});

describe('parseTicketRef', () => {
  it('reads a bare number, with or without the hash', () => {
    expect(parseTicketRef('223')).toEqual({ name: null, number: 223 });
    expect(parseTicketRef(' #223 ')).toEqual({ name: null, number: 223 });
  });

  it('reads a prefix or a repo name before the number', () => {
    expect(parseTicketRef('THX-12')).toEqual({ name: 'THX', number: 12 });
    expect(parseTicketRef('my.repo_x-223')).toEqual({ name: 'my.repo_x', number: 223 });
  });

  it('reads anything else as no ID', () => {
    for (const raw of ['', 'fix login', '@alex', 'THX-', 'THX-0', '0', 'https://x.test/1', null]) {
      expect(parseTicketRef(raw as never)).toBeNull();
    }
  });
});

describe('ticketRefSelector', () => {
  it("finds a ticket by its org's prefix and number, in any of the caller's teams", async () => {
    expect(await find('THX-12')).toEqual(['numbered']);
    expect(await find('thx-12')).toEqual(['numbered']);
  });

  it('uses the default prefix for an org that set none', async () => {
    expect(await find('TH-7')).toEqual(['github']);
    expect(await find('TH-12')).toEqual([]);
  });

  it("finds every ticket carrying, or linking to, an issue on the org's named server", async () => {
    expect(await find('RM0-233')).toEqual(['carrier', 'carrier-with-host', 'redmine-link']);
  });

  it('finds tickets linked to a GitHub issue or PR by repo name, in any owner, any case', async () => {
    expect(await find('timehuddle-223')).toEqual(['github', 'github-fork']);
    expect(await find('TimeHuddle-22')).toEqual([]);
  });

  it('finds every ticket where a bare number appears', async () => {
    expect(await find('223')).toEqual(['github', 'github-fork', 'number-223']);
    expect(await find('#233')).toEqual(['carrier', 'carrier-with-host', 'other-server', 'redmine-link']);
  });

  it('leaves out deleted tickets and teams the caller is not in', async () => {
    expect(await find('12')).toEqual(['numbered']);
  });

  it('finds nothing for a prefix nobody uses', async () => {
    expect(await find('ZZZ-12')).toEqual([]);
  });
});
