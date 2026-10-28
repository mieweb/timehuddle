/**
 * Finding tickets by a typed ID (server/ticket-search-core.js), #736c. The
 * selectors run against the test database, so Mongo itself reads the regexes.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getDb, closeDb, ObjectId } from './helpers';
import { ticketIdsFor } from '../server/ticket-ids';
import {
  parseTicketQuery,
  parseTicketRef,
  ticketAssigneeSelector,
  ticketLinkSelector,
  ticketRefSelector,
  ticketTextSelector,
} from '../server/ticket-search-core';

const tag = `ref736c-${Date.now()}`;
const REDMINE_HOST = 'redmine.test';
const created = {
  organizations: [] as ObjectId[],
  teams: [] as ObjectId[],
  tickets: [] as ObjectId[],
};

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

/** The titles of the tickets `selector` finds among this file's, sorted. */
async function titles(selector: Record<string, unknown> | null) {
  if (!selector) return [];
  const db = await getDb();
  const docs = await db
    .collection('tickets')
    .find({ $and: [selector, { _id: { $in: created.tickets } }] })
    .toArray();
  return docs.map((doc) => String(doc.title).slice(tag.length + 1)).sort();
}

/** The titles of the tickets `query` finds, sorted. */
async function find(query: string, { exact = false } = {}) {
  const ref = parseTicketRef(query);
  if (!ref) return null;
  const db = await getDb();
  const idsByOrg = await ticketIdsFor(
    db,
    teams.map((team) => team.orgId).filter(Boolean) as string[],
  );
  const selector = ticketRefSelector(
    ref,
    { teams, idsByOrg, redmineHost: REDMINE_HOST },
    { exact },
  );
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

  ids.numbered = await ticket(a1, 'numbered', { number: 12, assignedTo: ['ada-id'] });
  await ticket(a2, 'carrier', { number: 5, linkedIssue: { source: 'redmine', id: '233' } });
  await ticket(a1, 'carrier-with-host', {
    number: 6,
    linkedIssue: { source: 'redmine', id: '233', host: REDMINE_HOST },
  });
  await ticket(a1, 'other-server', {
    number: 9,
    linkedIssue: { source: 'redmine', id: '233', host: 'elsewhere.test' },
  });
  await ticket(b1, 'github', {
    number: 7,
    github: 'https://github.com/mieweb/timehuddle/issues/223',
  });
  await ticket(a2, 'github-fork', {
    number: 10,
    github: 'https://github.com/someone/TimeHuddle/pull/223',
  });
  await ticket(a1, 'redmine-link', {
    number: 8,
    github: `https://${REDMINE_HOST}/issues/233#note-2`,
  });
  await ticket(a1, 'number-223', { number: 223 });
  await ticket(b1, 'dashed-repo', {
    number: 11,
    github: 'https://github.com/mieweb/pulse-vault/issues/41',
  });
  await ticket(a1, 'http-link', { number: 30, github: `http://${REDMINE_HOST}/issues/233` });
  await ticket(b1, 'pr-subpage', {
    number: 31,
    github: 'https://github.com/mieweb/pulse/pull/554/files#diff',
  });
  // Numbers outside the issue's own path: never a match for them.
  await ticket(a2, 'back-url', {
    github: `https://${REDMINE_HOST}/issues/150?back_url=/issues/233`,
  });
  await ticket(b1, 'not-github', {
    github: 'https://notgithub.com/mieweb/timehuddle/issues/223',
  });
  // Saved as just a link: the ticket goes by none of the IDs it names.
  await ticket(b1, 'plain-github', {
    github: 'https://github.com/mieweb/pulse/issues/88',
    linkIsIssue: false,
  });
  await ticket(a1, 'plain-server', {
    github: `https://${REDMINE_HOST}/issues/890`,
    linkIsIssue: false,
  });
  await ticket(b1, 'converted', {
    github: 'https://github.com/mieweb/pulse/issues/89',
    linkIsIssue: true,
  });
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
    expect(parseTicketRef('223')).toEqual({ name: null, digits: '223' });
    expect(parseTicketRef(' #223 ')).toEqual({ name: null, digits: '223' });
  });

  it('reads a prefix or a repo name, and the start of a number or none of it', () => {
    expect(parseTicketRef('THX-12')).toEqual({ name: 'THX', digits: '12' });
    expect(parseTicketRef('THX-')).toEqual({ name: 'THX', digits: '' });
    expect(parseTicketRef('my.repo_x-2')).toEqual({ name: 'my.repo_x', digits: '2' });
    expect(parseTicketRef('pulse-vault-41')).toEqual({ name: 'pulse-vault', digits: '41' });
    expect(parseTicketRef('pulse-vault-')).toEqual({ name: 'pulse-vault', digits: '' });
    expect(parseTicketRef('.github-2')).toEqual({ name: '.github', digits: '2' });
  });

  it('reads anything else as no ID', () => {
    for (const raw of [
      '',
      'fix login',
      '@alex',
      'THX',
      'pulse-vault',
      '0',
      'https://x.test/1',
      null,
    ]) {
      expect(parseTicketRef(raw as never)).toBeNull();
    }
  });
});

describe('ticketRefSelector', () => {
  it("finds a ticket by its org's prefix and number, in any of the caller's teams", async () => {
    expect(await find('THX-12', { exact: true })).toEqual(['numbered']);
    expect(await find('thx-12', { exact: true })).toEqual(['numbered']);
  });

  it('searches a name and a dash by prefix', async () => {
    expect(await find('THX-')).toEqual([
      'carrier',
      'carrier-with-host',
      'github-fork',
      'http-link',
      'number-223',
      'numbered',
      'other-server',
      'redmine-link',
    ]);
    expect(await find('THX-1')).toEqual(['github-fork', 'numbered']);
    expect(await find('THX-2')).toEqual(['number-223']);
  });

  it('uses the default prefix for an org that set none', async () => {
    expect(await find('TH-7', { exact: true })).toEqual(['github']);
    expect(await find('TH-')).toEqual(['dashed-repo', 'github', 'pr-subpage']);
    expect(await find('TH-12', { exact: true })).toEqual([]);
  });

  it("finds every ticket carrying, or linking to, an issue on the org's named server", async () => {
    // An `http` link from before only `https` was accepted counts too.
    const onServer = ['carrier', 'carrier-with-host', 'http-link', 'redmine-link'];
    expect(await find('RM0-233', { exact: true })).toEqual(onServer);
    // Issue 150 on that server: in its prefix, and never found as 233 from its query.
    expect(await find('RM0-')).toEqual(['back-url', ...onServer]);
    expect(await find('RM0-23')).toEqual(onServer);
    expect(await find('RM0-23', { exact: true })).toEqual([]);
  });

  it('finds tickets linked to a GitHub issue or PR by repo name, in any owner, any case', async () => {
    // Not a link on another host that only looks like GitHub's.
    expect(await find('timehuddle-223', { exact: true })).toEqual(['github', 'github-fork']);
    expect(await find('TimeHuddle-22', { exact: true })).toEqual([]);
    expect(await find('TimeHuddle-')).toEqual(['github', 'github-fork']);
    expect(await find('pulse-vault-4')).toEqual(['dashed-repo']);
    // A page under a PR still names it.
    expect(await find('pulse-554', { exact: true })).toEqual(['pr-subpage']);
  });

  it('finds every ticket where a bare number appears, whole', async () => {
    // Any link whose path ends in the number, on any host.
    expect(await find('223')).toEqual(['github', 'github-fork', 'not-github', 'number-223']);
    expect(await find('#233')).toEqual([
      'carrier',
      'carrier-with-host',
      'http-link',
      'other-server',
      'redmine-link',
    ]);
    expect(await find('554')).toEqual(['pr-subpage']);
    expect(await find('22')).toEqual([]);
  });

  it('leaves out deleted tickets and teams the caller is not in', async () => {
    expect(await find('12')).toEqual(['numbered']);
  });

  it('finds a link saved as just a link by none of the IDs it names', async () => {
    expect(await find('pulse-88', { exact: true })).toEqual([]);
    expect(await find('88')).toEqual([]);
    expect(await find('RM0-890', { exact: true })).toEqual([]);
    expect(await find('pulse-89', { exact: true })).toEqual(['converted']);
  });

  it('finds nothing for a prefix nobody uses', async () => {
    expect(await find('ZZZ-12')).toEqual([]);
    expect(await find('ZZZ-')).toEqual([]);
  });
});

describe('parseTicketQuery', () => {
  it('reads an ID, a link, @name, or words', () => {
    expect(parseTicketQuery('TH-')).toEqual({ kind: 'id', ref: { name: 'TH', digits: '' } });
    expect(parseTicketQuery('https://github.com/mieweb/pulse/issues/250')).toEqual({
      kind: 'url',
      link: { github: { owner: 'mieweb', repo: 'pulse', digits: '250' } },
    });
    expect(parseTicketQuery('https://github.com/mieweb/pulse/pull/554/files#diff')).toEqual({
      kind: 'url',
      link: { github: { owner: 'mieweb', repo: 'pulse', digits: '554' } },
    });
    expect(parseTicketQuery('https://redmine.test/issues/233#note-1')).toEqual({
      kind: 'url',
      link: { host: 'redmine.test', digits: '233' },
    });
    expect(parseTicketQuery('@ada')).toEqual({ kind: 'assignee', name: 'ada' });
    expect(parseTicketQuery('  Pulse  Integration pulse ')).toEqual({
      kind: 'text',
      words: ['pulse', 'integration'],
    });
  });

  it('asks nothing for what is too short or not an issue link', () => {
    for (const raw of [
      '',
      'ab',
      '@a',
      '@',
      'https://github.com/mieweb/pulse',
      'https://x.test/about',
    ]) {
      expect(parseTicketQuery(raw)).toBeNull();
    }
  });
});

describe('the other selectors', () => {
  it('finds tickets with every word in the title, in any case', async () => {
    expect(await titles(ticketTextSelector(['CARRIER'], teams))).toEqual([
      'carrier',
      'carrier-with-host',
    ]);
    expect(await titles(ticketTextSelector(['carrier', 'host'], teams))).toEqual([
      'carrier-with-host',
    ]);
    expect(await titles(ticketTextSelector(['carrier'], []))).toEqual([]);
  });

  it('finds tickets assigned to the people named', async () => {
    expect(await titles(ticketAssigneeSelector(['ada-id'], teams))).toEqual(['numbered']);
    expect(ticketAssigneeSelector([], teams)).toBeNull();
  });

  it('finds the tickets a pasted link names', async () => {
    const scope = { teams, redmineHost: REDMINE_HOST };
    expect(
      await titles(
        ticketLinkSelector(
          { github: { owner: 'mieweb', repo: 'timehuddle', digits: '223' } },
          scope,
        ),
      ),
    ).toEqual(['github']);
    expect(await titles(ticketLinkSelector({ host: REDMINE_HOST, digits: '233' }, scope))).toEqual([
      'carrier',
      'carrier-with-host',
      'http-link',
      'redmine-link',
    ]);
    // A plain link is still found by its address.
    expect(
      await titles(
        ticketLinkSelector({ github: { owner: 'mieweb', repo: 'pulse', digits: '88' } }, scope),
      ),
    ).toEqual(['plain-github']);
  });
});
