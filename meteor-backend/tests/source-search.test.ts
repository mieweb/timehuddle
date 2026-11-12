/**
 * Searching every connected server (#734 step 8), end to end against stand-in
 * Redmines: each is asked with the member's key for it, one slow or failing
 * server doesn't hold up the others, results stay slim, and an issue's number
 * means a different issue on each server.
 *
 * The test backend's REDMINE_BASE_URL must be TIME_TEST_MAIN, and it must reach
 * TIME_TEST_OTHER and SOURCES_TEST_SERVER, as in time-servers.test.ts. Without
 * all three the suite is skipped.
 */
import { createServer, type Server } from 'node:http';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeDb, createUserAndGetJwt, getDb, ObjectId, purgeUser, wormhole } from './helpers';

const MAIN = process.env.TIME_TEST_MAIN;
const OTHER = process.env.TIME_TEST_OTHER;
const FLAKY = process.env.SOURCES_TEST_SERVER;
const USER = { name: 'Source Search User', email: 'wh-source-search@test.dev', password: 'Password1!' };
const KEY = { main: 'main-key', other: 'other-key', flaky: 'flaky-key' };

type Issue = { id: number; subject: string; url: string; tickets: { id: string; teamId: string }[] };
type Answer = { host: string; prefix: string; failed: boolean; issues: Issue[] };
type Search = { servers: Answer[] };

/** What every stand-in calls its closed status; a test renames it to see the cache drop. */
let closedWord = 'closed';

/** A stand-in Redmine with issue 233, titled by `name`. `broken` answers searches with a 500. */
function startRedmine(address: string, key: string, name: string, broken = false): Promise<Server> {
  const issue = {
    id: 233,
    subject: `${name} printer jams`,
    description: 'SECRET DESCRIPTION',
    project: { id: 1, name },
    tracker: { id: 1, name: 'Bug' },
    status: { id: 1, name: 'New' },
    custom_fields: [{ id: 3, name: 'Billable', value: 'Yes' }],
    author: { id: 7, name: 'Ada L' },
    created_on: '2026-10-01T10:00:00Z',
    updated_on: '2026-10-02T10:00:00Z',
    journals: [
      {
        id: 1,
        user: { id: 7, name: 'Ada L' },
        created_on: '2026-10-02T10:00:00Z',
        details: [{ property: 'attr', name: 'status_id', old_value: '1', new_value: '2' }],
      },
    ],
    attachments: [],
    allowed_statuses: [],
  };
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', address);
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.headers['x-redmine-api-key'] !== key) return json(401, {});
    if (url.pathname === '/users/current.json') {
      return json(200, { user: { id: 7, login: 'ada', firstname: 'Ada', lastname: 'L' } });
    }
    if (broken && url.searchParams.get('q') === 'slowword') return; // never answers
    if (broken && url.pathname !== '/users/current.json') return json(500, {});
    if (url.pathname === '/issues/233.json') return json(200, { issue });
    if (url.pathname === '/projects/1.json') return json(200, { project: { id: 1, trackers: [] } });
    if (url.pathname === '/projects/1/memberships.json') return json(200, { memberships: [] });
    if (url.pathname === '/enumerations/issue_priorities.json') {
      return json(200, { issue_priorities: [] });
    }
    if (url.pathname === '/issue_statuses.json') {
      return json(200, {
        issue_statuses: [
          { id: 1, name: `${name} opened` },
          { id: 2, name: `${name} ${closedWord}` },
        ],
      });
    }
    if (url.pathname === '/search.json') return json(200, { results: [{ id: 233, type: 'issue' }] });
    if (url.pathname === '/issues.json') return json(200, { issues: [issue], total_count: 1 });
    return json(404, {});
  });
  return new Promise((resolve) => server.listen(Number(new URL(address).port), () => resolve(server)));
}

describe.skipIf(!MAIN || !OTHER || !FLAKY)('searching every connected server', () => {
  let servers: Server[];
  let jwt: string;
  let userId: string;
  const orgId = new ObjectId();
  const teamId = new ObjectId();
  const otherHost = OTHER ? new URL(OTHER).hostname : '';
  const flakyHost = FLAKY ? new URL(FLAKY).hostname : '';
  const team = teamId.toHexString();
  const search = (query: string) => wormhole<Search>('sources.search', { query }, jwt);
  const answerOf = (res: { result: Search }, host: string) =>
    res.result.servers.find((server) => server.host === host);
  /** The ticket on `host` (else the main server's) as read from its server, as text. */
  const historyOf = async (host?: string) => {
    const db = await getDb();
    const ticket = await db.collection('tickets').findOne({
      teamId: team,
      'linkedIssue.host': host ?? { $ne: otherHost },
    });
    const res = await wormhole('tickets.outsideRecord', { ticketId: ticket!._id.toHexString() }, jwt);
    expect(res.error).toBeUndefined();
    return JSON.stringify(res.result);
  };

  beforeAll(async () => {
    servers = await Promise.all([
      startRedmine(MAIN!, KEY.main, 'Main'),
      startRedmine(OTHER!, KEY.other, 'Other'),
      startRedmine(FLAKY!, KEY.flaky, 'Flaky', true),
    ]);
    await purgeUser(USER.email);
    ({ jwt, userId } = await createUserAndGetJwt(USER));
    const db = await getDb();
    await db.collection('organizations').insertOne({
      _id: orgId,
      name: 'source-search-org',
      slug: `source-search-${orgId}`,
      sourcePrefixes: [
        { host: otherHost, prefix: 'OT', type: 'redmine', baseUrl: OTHER },
        { host: flakyHost, prefix: 'FL', type: 'redmine', baseUrl: FLAKY },
      ],
    });
    await db.collection('teams').insertOne({
      _id: teamId,
      orgId: orgId.toHexString(),
      name: 'source-search-team',
      members: [userId],
      admins: [userId],
    });
    expect((await wormhole('redmine.connect', { apiKey: KEY.main }, jwt)).ok).toBe(true);
  });

  afterAll(async () => {
    const db = await getDb();
    await db.collection('redmine_links').deleteMany({ userId });
    await db.collection('tickets').deleteMany({ teamId: team });
    await db.collection('teams').deleteOne({ _id: teamId });
    await db.collection('organizations').deleteOne({ _id: orgId });
    await purgeUser(USER.email);
    await closeDb();
    await Promise.all(servers.map((s) => new Promise((resolve) => s.close(resolve))));
  });

  it('asks no server the member has not connected', async () => {
    const res = await search('233');
    expect(res.ok).toBe(true);
    expect(res.result.servers).toEqual([]);
  });

  it('finds an issue by number on a connected server, slim, with a link to it', async () => {
    const connected = await wormhole('sources.connect', { server: OTHER, apiKey: KEY.other }, jwt);
    expect(connected.ok).toBe(true);
    const res = await search('233');
    const answer = answerOf(res, otherHost)!;
    expect(answer).toMatchObject({ prefix: 'OT', failed: false });
    expect(answer.issues).toEqual([
      expect.objectContaining({
        id: 233,
        subject: 'Other printer jams',
        url: `${OTHER}/issues/233`,
        tickets: [],
      }),
    ]);
    expect(JSON.stringify(res.result)).not.toContain('SECRET DESCRIPTION');
    expect(JSON.stringify(res.result)).not.toContain('Billable');
  });

  it('finds an issue by words too', async () => {
    expect(answerOf(await search('printer'), otherHost)!.issues[0].id).toBe(233);
  });

  it('keeps the same number on two servers apart when it becomes a ticket', async () => {
    const carry = (host?: string) =>
      wormhole<{ ticket: { id: string; linkedIssue: { host?: string } }; created: boolean }>(
        'tickets.carryIssue',
        { teamId: team, issueId: 233, ...(host ? { host } : {}) },
        jwt,
      );
    const onOther = await carry(otherHost);
    expect(onOther.error).toBeUndefined();
    expect(onOther.result.created).toBe(true);
    expect(onOther.result.ticket.linkedIssue.host).toBe(otherHost);

    const onMain = await carry();
    expect(onMain.error).toBeUndefined();
    expect(onMain.result.created).toBe(true);
    expect(onMain.result.ticket.id).not.toBe(onOther.result.ticket.id);

    const again = await carry(otherHost);
    expect(again.result).toMatchObject({ created: false, ticket: { id: onOther.result.ticket.id } });
  });

  it("names a server's statuses from that server, not the one read first", async () => {
    expect(await historyOf()).toContain('Main closed');
    const onOther = await historyOf(otherHost);
    expect(onOther).toContain('Other closed');
    expect(onOther).not.toContain('Main closed');
  });

  it('reads the names afresh once the member reconnects', async () => {
    closedWord = 'done';
    try {
      expect(await historyOf(otherHost)).toContain('Other closed'); // still cached
      expect((await wormhole('sources.connect', { server: OTHER, apiKey: KEY.other }, jwt)).ok).toBe(true);
      expect(await historyOf(otherHost)).toContain('Other done');
    } finally {
      closedWord = 'closed';
    }
  });

  it('marks a result that is already a ticket', async () => {
    const [issue] = answerOf(await search('233'), otherHost)!.issues;
    expect(issue.tickets).toEqual([{ id: expect.any(String), teamId: team }]);
  });

  it("reads the live status of the other server's issue its ticket carries, not the main one's", async () => {
    const res = await wormhole<{ issues: Array<Record<string, unknown>> }>('sources.linkedIssues', {}, jwt);
    expect(res.error).toBeUndefined();
    // The main server's #233 comes with `redmine.issues.relevant`, as before.
    expect(res.result.issues).toEqual([
      {
        source: 'redmine',
        host: otherHost,
        id: '233',
        status: { id: '1', native: 'New', isClosed: false },
        assignees: [],
      },
    ]);
  });

  it("offers the other server's assigned issues before anything is typed", async () => {
    const answer = answerOf(await search(''), otherHost)!;
    expect(answer.failed).toBe(false);
    expect(answer.issues.map((issue) => issue.id)).toEqual([233]);
  });

  it('answers from the others when one server fails', async () => {
    const connected = await wormhole('sources.connect', { server: FLAKY, apiKey: KEY.flaky }, jwt);
    expect(connected.ok).toBe(true);
    const res = await search('233');
    expect(answerOf(res, flakyHost)).toMatchObject({ failed: true, issues: [] });
    expect(answerOf(res, otherHost)!.issues).toHaveLength(1);
  });

  it('answers from the others when one server is slow', async () => {
    const started = Date.now();
    const res = await search('slowword');
    expect(answerOf(res, flakyHost)).toMatchObject({ failed: true, issues: [] });
    expect(answerOf(res, otherHost)!.issues).toHaveLength(1);
    expect(Date.now() - started).toBeLessThan(12000);
  }, 20000);

  it('stops asking a server once disconnected', async () => {
    await wormhole('sources.disconnect', { server: FLAKY }, jwt);
    const res = await search('233');
    expect(answerOf(res, flakyHost)).toBeUndefined();
  });

  it('stops listing and searching a server its org no longer registers', async () => {
    const db = await getDb();
    await db
      .collection('organizations')
      .updateOne({ _id: orgId }, { $pull: { sourcePrefixes: { host: otherHost } } as never });
    try {
      const listed = await wormhole<{ servers: { host: string }[] }>('sources.list', {}, jwt);
      expect(listed.result.servers.map((server) => server.host)).not.toContain(otherHost);
      expect(answerOf(await search('233'), otherHost)).toBeUndefined();
      // Reconnecting is refused too.
      const again = await wormhole('sources.connect', { server: OTHER, apiKey: KEY.other }, jwt);
      expect(again.ok).toBe(false);
    } finally {
      await db.collection('organizations').updateOne(
        { _id: orgId },
        { $push: { sourcePrefixes: { host: otherHost, prefix: 'OT', type: 'redmine', baseUrl: OTHER } } as never },
      );
    }
  });

  it("follows the member's membership: out of the team, none of its servers are listed or asked", async () => {
    const db = await getDb();
    await db.collection('teams').updateOne({ _id: teamId }, { $pull: { members: userId, admins: userId } as never });
    try {
      const listed = await wormhole<{ servers: { host: string }[] }>('sources.list', {}, jwt);
      expect(listed.result.servers.map((server) => server.host)).not.toContain(otherHost);
      expect(answerOf(await search('233'), otherHost)).toBeUndefined();
      // The team's tickets are closed to them, so are the issues behind them.
      const ticket = await db.collection('tickets').findOne({ teamId: team, 'linkedIssue.host': otherHost });
      const read = await wormhole('tickets.outsideRecord', { ticketId: ticket!._id.toHexString() }, jwt);
      expect(read.ok).toBe(false);
    } finally {
      await db.collection('teams').updateOne({ _id: teamId }, { $set: { members: [userId], admins: [userId] } });
    }
  });
});
