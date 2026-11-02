/**
 * GitHub through the engine (#734 step 4), end to end against a stand-in GitHub:
 * connecting in one click, confirmed by the member who started it; search;
 * issues and PRs becoming tickets; reading and editing; refreshing and losing
 * a token; and a member with no connection still seeing a plain link.
 *
 * The test backend must run with GITHUB_API_URL and GITHUB_WEB_URL pointing at
 * GITHUB_TEST_SERVER (e.g. http://host.docker.internal:3998), which this process
 * serves on GITHUB_TEST_PORT, plus any GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET.
 * Without them the suite is skipped.
 */
import { createServer, type Server } from 'node:http';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeDb, createUserAndGetJwt, getDb, ObjectId, purgeUser, wormhole } from './helpers';

const SERVER = process.env.GITHUB_TEST_SERVER;
const PORT = Number(process.env.GITHUB_TEST_PORT ?? 0);
const METEOR = process.env.METEOR_URL ?? 'http://localhost:3101';
const MEMBER = {
  name: 'GitHub Member',
  email: 'wh-github-member@test.dev',
  password: 'Password1!',
};
const OTHER = { name: 'GitHub Other', email: 'wh-github-other@test.dev', password: 'Password1!' };
const ISSUE_URL = 'https://github.com/acme/pulse/issues/223';
const PR_URL = 'https://github.com/acme/pulse/pull/224';
const TWIN_URL = 'https://github.com/someone/pulse/issues/223';

type Slim = { id: number; ref: string; url: string; pull: boolean; tickets: { id: string }[] };
type Search = { servers: { host: string; failed: boolean; issues: Slim[] }[] };
type Carried = { ticket: { id: string; title: string; github: string }; created: boolean };

describe.skipIf(!SERVER || !PORT)('GitHub through the engine', () => {
  let github: Server;
  let jwt: string;
  let userId: string;
  let otherJwt: string;
  let otherId: string;
  const orgId = new ObjectId();
  const teamId = new ObjectId();
  const team = teamId.toHexString();
  // What the stand-in has been asked, and what it will accept.
  const searched: string[] = [];
  const patched: unknown[] = [];
  const revoked: unknown[] = [];
  const tokens = { valid: new Set(['token-1']), next: 'token-2' };
  let issueState = 'open';
  let twinRepo = false;
  let rateLimited = false;
  let updatedAt = '2026-10-01T10:00:00Z';

  const item = (number: number, pull = false) => ({
    number,
    id: number,
    title: pull ? 'Fix the printer' : 'Printer jams',
    body: 'SECRET BODY',
    state: number === 223 ? issueState : 'open',
    html_url: pull ? PR_URL : ISSUE_URL,
    url: `${SERVER}/repos/acme/pulse/issues/${number}`,
    repository_url: `${SERVER}/repos/acme/pulse`,
    comments: 1,
    comments_url: `${SERVER}/repos/acme/pulse/issues/${number}/comments`,
    user: { id: 9, login: 'grace' },
    assignees: [{ id: 7, login: 'ada' }],
    labels: [{ name: 'bug', color: 'd73a4a' }],
    milestone: { id: 1, title: 'Sprint 12' },
    created_at: '2026-10-01T09:00:00Z',
    updated_at: updatedAt,
    ...(pull ? { pull_request: {} } : {}),
  });

  function startGithub(): Promise<Server> {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://stand-in');
      const json = (status: number, body: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      let raw = '';
      req.on('data', (chunk) => (raw += chunk));
      req.on('end', () => {
        if (url.pathname === '/login/oauth/access_token') {
          const body = JSON.parse(raw);
          if (body.grant_type === 'refresh_token') {
            tokens.valid.add(tokens.next);
            return json(200, {
              access_token: tokens.next,
              refresh_token: 'refresh-2',
              expires_in: 28800,
            });
          }
          return json(200, {
            access_token: 'token-1',
            refresh_token: 'refresh-1',
            expires_in: 28800,
          });
        }
        if (url.pathname.startsWith('/applications/')) {
          revoked.push(JSON.parse(raw));
          return json(204, {});
        }
        const token = (req.headers.authorization ?? '').replace('Bearer ', '');
        if (!tokens.valid.has(token)) return json(401, {});
        if (url.pathname === '/user') return json(200, { id: 7, login: 'ada' });
        // A collaborator, not a member: GitHub lists no org, and only `repo` was granted.
        if (url.pathname === '/user/orgs') return json(403, {});
        if (url.pathname === '/user/repos') {
          return json(200, [
            { name: 'pulse', full_name: 'acme/pulse', owner: { login: 'acme' } },
            ...(twinRepo
              ? [{ name: 'pulse', full_name: 'someone/pulse', owner: { login: 'someone' } }]
              : []),
          ]);
        }
        if ((url.pathname === '/search/issues' || url.pathname.startsWith('/repos/')) && rateLimited) {
          res.setHeader('x-ratelimit-remaining', '0');
          return json(403, { message: 'API rate limit exceeded' });
        }
        if (url.pathname === '/search/issues') {
          const q = url.searchParams.get('q') ?? '';
          searched.push(q);
          return json(200, {
            items: q.includes('is:pull-request') ? [item(224, true)] : [item(223)],
          });
        }
        if (url.pathname === '/issues') return json(200, [item(223)]);
        if (url.pathname.endsWith('/comments')) {
          return json(200, [
            {
              id: 1,
              body: 'Me too',
              user: { id: 9, login: 'grace' },
              created_at: '2026-10-02T09:00:00Z',
            },
          ]);
        }
        // A renamed repo: GitHub's API sends the old name on to the new one.
        if (url.pathname.startsWith('/repos/acme/old-pulse/')) {
          res.writeHead(301, { location: `${SERVER}${url.pathname.replace('old-pulse', 'pulse')}` });
          return res.end();
        }
        const issue = url.pathname.match(/^\/repos\/acme\/pulse\/issues\/(\d+)$/);
        if (issue && Number(issue[1]) === 223 && req.method === 'PATCH') {
          const body = JSON.parse(raw);
          patched.push(body);
          if (body.state) issueState = body.state;
          return json(200, { ...item(223), ...body });
        }
        if (issue && Number(issue[1]) === 223) return json(200, item(223));
        if (issue && Number(issue[1]) === 224) return json(200, item(224, true));
        if (twinRepo && url.pathname === '/repos/someone/pulse/issues/223') {
          return json(200, {
            ...item(223),
            title: 'Their printer',
            html_url: TWIN_URL,
            repository_url: `${SERVER}/repos/someone/pulse`,
          });
        }
        return json(404, {});
      });
    });
    return new Promise((resolve) => server.listen(PORT, () => resolve(server)));
  }

  /** The trip through GitHub's page, as the browser makes it. */
  async function throughGithub(connectToken: string) {
    const start = await fetch(`${METEOR}/auth/github?connect=${connectToken}`, {
      redirect: 'manual',
    });
    const authorize = new URL(start.headers.get('location') ?? '');
    expect(authorize.searchParams.get('scope')).toBe('repo');
    const back = await fetch(
      `${METEOR}/auth/github/callback?code=abc&state=${authorize.searchParams.get('state')}`,
      { redirect: 'manual' },
    );
    return new URL(back.headers.get('location') ?? '');
  }

  const connectToken = async (as: string) =>
    (await wormhole<{ token: string }>('sources.githubConnectToken', {}, as)).result.token;

  async function connect() {
    const back = await throughGithub(await connectToken(jwt));
    const res = await wormhole(
      'sources.confirmGithub',
      { code: back.searchParams.get('github_connect') },
      jwt,
    );
    expect(res.error).toBeUndefined();
  }

  const search = (query: string) => wormhole<Search>('sources.search', { query }, jwt);
  const github0 = (res: { result: Search }) =>
    res.result.servers.find((s) => s.host === 'github.com');
  const carry = (url: string) => wormhole<Carried>('tickets.carryLink', { teamId: team, url }, jwt);

  beforeAll(async () => {
    github = await startGithub();
    await Promise.all([purgeUser(MEMBER.email), purgeUser(OTHER.email)]);
    ({ jwt, userId } = await createUserAndGetJwt(MEMBER));
    ({ jwt: otherJwt, userId: otherId } = await createUserAndGetJwt(OTHER));
    const db = await getDb();
    await db
      .collection('organizations')
      .insertOne({ _id: orgId, name: 'github-org', slug: `github-${orgId}` });
    await db.collection('teams').insertOne({
      _id: teamId,
      orgId: orgId.toHexString(),
      name: 'github-team',
      members: [userId, otherId],
      admins: [userId],
    });
  });

  afterAll(async () => {
    const db = await getDb();
    await db.collection('redmine_links').deleteMany({ userId: { $in: [userId, otherId] } });
    await db.collection('tickets').deleteMany({ teamId: team });
    await Promise.all(
      ['timers', 'workitems', 'clockevents'].map((name) =>
        db.collection(name).deleteMany({ userId }),
      ),
    );
    await db.collection('teams').deleteOne({ _id: teamId });
    await db.collection('organizations').deleteOne({ _id: orgId });
    await Promise.all([purgeUser(MEMBER.email), purgeUser(OTHER.email)]);
    await closeDb();
    await new Promise((resolve) => github.close(resolve));
  });

  it('lists GitHub for every member, not yet connected', async () => {
    const res = await wormhole<{ github: Record<string, unknown> }>('sources.list', {}, jwt);
    expect(res.result.github).toMatchObject({
      host: 'github.com',
      configured: true,
      connected: false,
    });
  });

  it('asks nothing of GitHub before connecting', async () => {
    expect(github0(await search('printer'))).toBeUndefined();
  });

  it("won't land on someone else's account: only the member who started it can finish", async () => {
    const back = await throughGithub(await connectToken(jwt));
    const code = back.searchParams.get('github_connect');
    expect(code).toBeTruthy();
    const stolen = await wormhole('sources.confirmGithub', { code }, otherJwt);
    expect(stolen.ok).toBe(false);
    const db = await getDb();
    expect(await db.collection('redmine_links').countDocuments({ userId: otherId })).toBe(0);
  });

  it('refuses a replayed connect token', async () => {
    const token = await connectToken(jwt);
    await throughGithub(token);
    const again = await throughGithub(token);
    expect(again.searchParams.get('github_failed')).toBe('expired');
  });

  it('connects in one click, with no token reaching the browser or stored in the clear', async () => {
    await connect();
    const res = await wormhole<{ github: Record<string, unknown> }>('sources.list', {}, jwt);
    expect(res.result.github).toMatchObject({ connected: true, login: 'ada' });
    expect(JSON.stringify(res.result)).not.toContain('token-1');
    const link = await (
      await getDb()
    )
      .collection('redmine_links')
      .findOne({ userId, host: 'github.com' });
    expect(JSON.stringify(link)).not.toContain('token-1');
    expect(JSON.stringify(link)).not.toContain('refresh-1');
  });

  it('checks the connection', async () => {
    const res = await wormhole('sources.check', { server: 'https://github.com' }, jwt);
    expect(res.ok).toBe(true);
    expect(res.result).toMatchObject({ connected: true, login: 'ada' });
  });

  it('searches by words in titles, within the member and their orgs, issues and PRs both', async () => {
    searched.length = 0;
    const answer = github0(await search('printer'))!;
    expect(answer.issues.map((issue) => issue.ref).sort()).toEqual(['pulse-223', 'pulse-224']);
    expect(answer.issues.find((issue) => issue.pull)?.url).toBe(PR_URL);
    expect(JSON.stringify(answer)).not.toContain('SECRET BODY');
    expect(searched).toHaveLength(2);
    for (const q of searched) {
      expect(q).toContain('in:title');
      expect(q).toContain('user:ada');
      expect(q).toContain('user:acme');
    }
  });

  it('finds an issue by its repo ID, in an org the member only collaborates in, and by its address', async () => {
    expect(github0(await search('pulse-223'))!.issues.map((i) => i.ref)).toEqual(['pulse-223']);
    expect(github0(await search('PULSE-223'))!.issues.map((i) => i.ref)).toEqual(['pulse-223']);
    expect(github0(await search(PR_URL))!.issues.map((i) => i.ref)).toEqual(['pulse-224']);
  });

  it('lists both repos that share a name, each labelled with its owner', async () => {
    twinRepo = true;
    try {
      // The repo list is cached per member; reconnecting reads it afresh.
      await connect();
      const found = github0(await search('pulse-223'))!.issues;
      expect(found.map((i) => [i.ref, i.url])).toEqual([
        ['acme/pulse-223', ISSUE_URL],
        ['someone/pulse-223', TWIN_URL],
      ]);
    } finally {
      twinRepo = false;
      await connect();
    }
  });

  it('offers assigned issues before anything is typed', async () => {
    expect(github0(await search(''))!.issues.map((i) => i.ref)).toEqual(['pulse-223']);
  });

  it('makes a ticket on first action, for an issue and its PR apart, and reuses each', async () => {
    const issue = await carry(ISSUE_URL);
    expect(issue.error).toBeUndefined();
    expect(issue.result).toMatchObject({
      created: true,
      ticket: { title: 'Printer jams', github: ISSUE_URL },
    });
    const pull = await carry(PR_URL);
    expect(pull.result.created).toBe(true);
    expect(pull.result.ticket.id).not.toBe(issue.result.ticket.id);
    const again = await carry(ISSUE_URL);
    expect(again.result).toMatchObject({ created: false, ticket: { id: issue.result.ticket.id } });
  });

  it('times a GitHub ticket in TimeHuddle, and never offers it to Redmine', async () => {
    const { ticket } = (await carry(ISSUE_URL)).result;
    expect((await wormhole('clock.start', { teamId: team }, jwt)).ok).toBe(true);
    try {
      const date = new Date().toISOString().split('T')[0];
      const started = await wormhole(
        'timers.createEntry',
        { ticketId: ticket.id, date, startNow: true, notifyAdmins: false },
        jwt,
      );
      expect(started.error).toBeUndefined();
      const db = await getDb();
      const entry = await db.collection('workitems').findOne({ userId, ticketId: ticket.id });
      const session = await db
        .collection('timers')
        .findOne({ workItemId: entry!._id.toHexString() });
      expect(session).not.toBeNull();
      // The unsent list and the send prompt only take sessions with a Redmine issue.
      expect(session!.redmineIssueId ?? null).toBeNull();
    } finally {
      await wormhole('clock.stop', { teamId: team }, jwt);
    }
  });

  it('marks a search result that is already a ticket', async () => {
    const [found] = github0(await search('pulse-223'))!.issues;
    expect(found.tickets).toHaveLength(1);
  });

  it('reads the ticket from GitHub with its comments', async () => {
    const { ticket } = (await carry(ISSUE_URL)).result;
    const res = await wormhole<{
      kind: string;
      record: {
        title: string;
        labels: unknown[];
        conversation: unknown[];
        status: { native: string };
      };
    }>('tickets.outsideRecord', { ticketId: ticket.id }, jwt);
    expect(res.error).toBeUndefined();
    expect(res.result.kind).toBe('github');
    expect(res.result.record).toMatchObject({ title: 'Printer jams', status: { native: 'open' } });
    expect(res.result.record.labels).toEqual([{ name: 'bug', color: 'd73a4a' }]);
    expect(res.result.record.conversation).toHaveLength(1);
  });

  it('writes an edit back, and refuses one when the issue changed meanwhile', async () => {
    const { ticket } = (await carry(ISSUE_URL)).result;
    const expectedIssue = 'github:github.com:acme/pulse#223';
    const edit = (expectedUpdatedAt: string) =>
      wormhole(
        'tickets.writeOutside',
        { ticketId: ticket.id, expectedIssue, expectedUpdatedAt, edits: { status: 'closed' } },
        jwt,
      );
    const stale = await edit('2020-01-01T00:00:00.000Z');
    expect(stale.ok).toBe(false);
    expect(patched).toEqual([]);
    const done = await edit('2026-10-01T10:00:00.000Z');
    expect(done.error).toBeUndefined();
    expect(patched).toEqual([{ state: 'closed' }]);
    issueState = 'open';
  });

  it('shows a ticket whose issue the member can no longer open as a plain link, keeping its own title', async () => {
    const db = await getDb();
    const gone = new ObjectId();
    await db.collection('tickets').insertOne({
      _id: gone,
      teamId: team,
      title: 'Our own title',
      github: 'https://github.com/acme/pulse/issues/225',
      createdAt: new Date(),
    });
    const res = await wormhole('tickets.outsideRecord', { ticketId: gone.toHexString() }, jwt);
    expect(res.error).toMatch(/plain link/);
    const ticket = await wormhole<{ title: string }>(
      'tickets.get',
      { ticketId: gone.toHexString() },
      jwt,
    );
    expect(ticket.result.title).toBe('Our own title');
  });

  it('shows a ticket on a renamed or moved repo as a plain link, without following GitHub elsewhere', async () => {
    const db = await getDb();
    const moved = new ObjectId();
    await db.collection('tickets').insertOne({
      _id: moved,
      teamId: team,
      title: 'Filed before the rename',
      github: 'https://github.com/acme/old-pulse/issues/223',
      createdAt: new Date(),
    });
    const res = await wormhole('tickets.outsideRecord', { ticketId: moved.toHexString() }, jwt);
    expect(res.error).toMatch(/plain link/);
  });

  it('says GitHub failed when its rate limit is hit, rather than that nothing matched', async () => {
    rateLimited = true;
    try {
      expect(github0(await search('printer'))).toMatchObject({ failed: true, rateLimited: true, issues: [] });
      // On the ticket page too: said as the rate limit, not as no access.
      const { ticket } = (await carry(ISSUE_URL)).result;
      const read = await wormhole('tickets.outsideRecord', { ticketId: ticket.id }, jwt);
      expect(read.error).toMatch(/rate limit was hit/);
    } finally {
      rateLimited = false;
    }
  });

  it('shows a member with no connection a plain link, not a refusal', async () => {
    const { ticket } = (await carry(ISSUE_URL)).result;
    const res = await wormhole('tickets.outsideRecord', { ticketId: ticket.id }, otherJwt);
    expect(res.ok).toBe(false);
    // Shown as a plain link, saying a connection would show the issue.
    expect(res.error).toMatch(/Connect this source/);
  });

  it('refreshes a token that ran out', async () => {
    const db = await getDb();
    await db
      .collection('redmine_links')
      .updateOne(
        { userId, host: 'github.com' },
        { $set: { tokenExpiresAt: new Date(Date.now() - 1000) } },
      );
    const before = await db.collection('redmine_links').findOne({ userId, host: 'github.com' });
    const res = await wormhole('sources.check', { server: 'https://github.com' }, jwt);
    expect(res.ok).toBe(true);
    const after = await db.collection('redmine_links').findOne({ userId, host: 'github.com' });
    expect(after?.apiKey).not.toBe(before?.apiKey);
    expect(after?.tokenExpiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('marks a connection rejected once GitHub stops accepting it, and stops asking', async () => {
    const db = await getDb();
    tokens.valid.clear();
    await db
      .collection('redmine_links')
      .updateOne(
        { userId, host: 'github.com' },
        { $unset: { refreshKey: '', tokenExpiresAt: '' } },
      );
    const res = await wormhole('sources.check', { server: 'https://github.com' }, jwt);
    expect(res.ok).toBe(false);
    const list = await wormhole<{ github: Record<string, unknown> }>('sources.list', {}, jwt);
    expect(list.result.github).toMatchObject({ connected: false, rejected: true });
    expect(github0(await search('printer'))).toBeUndefined();
    tokens.valid.add('token-1');
  });

  it('disconnects, revoking the token at GitHub', async () => {
    await connect();
    revoked.length = 0;
    const res = await wormhole('sources.disconnect', { server: 'https://github.com' }, jwt);
    expect(res.ok).toBe(true);
    expect(revoked).toEqual([{ access_token: 'token-1' }]);
    const list = await wormhole<{ github: Record<string, unknown> }>('sources.list', {}, jwt);
    expect(list.result.github).toMatchObject({ connected: false, rejected: false });
  });
});
