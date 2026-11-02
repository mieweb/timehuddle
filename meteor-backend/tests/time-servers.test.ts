/**
 * Time names its server (#734 step 6), end to end: a member with time on issue
 * 233 on the deployment's own Redmine and on issue 233 on another registered
 * server sends each to its own server, with their key there, and the ledger
 * keeps them apart.
 *
 * Two stand-in Redmines run in this process. The test backend must be started
 * with REDMINE_BASE_URL pointing at the first (TIME_TEST_MAIN, e.g.
 * http://main-redmine.test:3995) and able to reach the second
 * (TIME_TEST_OTHER, e.g. http://other-redmine.test:3996), two different
 * hostnames for this machine (`--add-host <name>:host-gateway` in Docker).
 * Without both the suite is skipped.
 */
import { createServer, type Server } from 'node:http';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeDb, createUserAndGetJwt, getDb, ObjectId, purgeUser, wormhole } from './helpers';

const MAIN = process.env.TIME_TEST_MAIN;
const OTHER = process.env.TIME_TEST_OTHER;
const USER = { name: 'Time Servers User', email: 'wh-time-servers@test.dev', password: 'Password1!' };
const KEY = { main: 'main-key', other: 'other-key' };
const today = new Date().toISOString().split('T')[0];
const MINUTE = 60 * 1000;
const DEVELOPMENT = { id: 9, name: 'Development', is_default: true, active: true };

type Row = { ticketId: string; date: string; hours: number; host?: string; blockedReason?: string | null };
type Created = { issue_id: number; hours: number };

/** A stand-in Redmine that accepts `key` and records the entries it is sent. */
function startRedmine(
  address: string,
  key: string,
  created: Created[],
  firstEntryId = 100,
): Promise<Server> {
  let lastEntryId = firstEntryId;
  const hours = new Map<number, number>();
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', address);
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.headers['x-redmine-api-key'] !== key) return json(401, {});
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      if (req.method === 'POST' && url.pathname === '/time_entries.json') {
        const entry = JSON.parse(raw).time_entry as Created;
        created.push(entry);
        hours.set(++lastEntryId, entry.hours);
        return json(201, { time_entry: { id: lastEntryId, hours: entry.hours } });
      }
      const readBack = url.pathname.match(/^\/time_entries\/(\d+)\.json$/);
      if (readBack) return json(200, { time_entry: { id: Number(readBack[1]), hours: hours.get(Number(readBack[1])) } });
      if (url.pathname === '/time_entries.json') {
        // One entry someone logged in Redmine, whose id main's first send also gets.
        const foreign = url.searchParams.get('issue_id') && firstEntryId !== 100;
        const entry = (id: number, comments: string) => ({
          id,
          issue: { id: 233 },
          hours: 1,
          comments,
          spent_on: today,
          user: { id: 2, name: 'Grace' },
          activity: { id: 9, name: 'Development' },
        });
        return json(200, {
          time_entries: foreign
            ? [...hours.keys()]
                .map((id) => entry(id, 'sent from TimeHuddle'))
                .concat(entry(101, 'logged in Redmine'))
            : [],
          total_count: foreign ? hours.size + 1 : 0,
        });
      }
      if (url.pathname === '/issues/233.json') {
        return json(200, {
          issue: {
            id: 233,
            subject: 'Issue 233',
            status: { id: 1, name: 'New' },
            project: { id: 1, name: 'Ops' },
            tracker: { id: 1, name: 'Bug' },
            author: { id: 2, name: 'Grace' },
            journals: [],
            attachments: [],
            allowed_statuses: [],
          },
        });
      }
      if (url.pathname === '/issues.json') {
        const ids = (url.searchParams.get('issue_id') ?? '').split(',').filter(Boolean);
        return json(200, {
          issues: ids.map((id) => ({ id: Number(id), subject: `Issue ${id}`, project: { id: 1 }, tracker: { name: 'Task' } })),
          total_count: ids.length,
        });
      }
      if (url.pathname === '/enumerations/time_entry_activities.json') {
        return json(200, { time_entry_activities: [DEVELOPMENT] });
      }
      if (/^\/projects\/\d+\.json$/.test(url.pathname)) {
        return json(200, { project: { id: 1, time_entry_activities: [DEVELOPMENT] } });
      }
      if (url.pathname === '/users/current.json') return json(200, { user: { id: 1, login: 'ada' } });
      return json(404, {});
    });
  });
  return new Promise((resolve) => server.listen(Number(new URL(address).port), () => resolve(server)));
}

describe.skipIf(!MAIN || !OTHER)('time on two servers', () => {
  const sentToMain: Created[] = [];
  const sentToOther: Created[] = [];
  let main: Server;
  let other: Server;
  let jwt: string;
  let userId: string;
  const orgId = new ObjectId();
  const teamId = new ObjectId();
  const shiftId = new ObjectId();
  const otherHost = OTHER ? new URL(OTHER).hostname : '';

  /** `minutes` of closed time on issue 233, on `host` (none for the deployment's own). */
  async function loggedOn233(minutes: number, host?: string) {
    const end = Date.now() - MINUTE;
    await (await getDb()).collection('timers').insertOne({
      _id: new ObjectId(),
      workItemId: new ObjectId().toHexString(),
      userId,
      date: today,
      startTime: end - minutes * MINUTE,
      endTime: end,
      durationSeconds: minutes * 60,
      redmineIssueId: '233',
      ...(host ? { redmineHost: host } : {}),
      createdAt: new Date(),
    });
  }

  beforeAll(async () => {
    main = await startRedmine(MAIN!, KEY.main, sentToMain);
    other = await startRedmine(OTHER!, KEY.other, sentToOther, 200);
    await purgeUser(USER.email);
    ({ jwt, userId } = await createUserAndGetJwt(USER));
    const db = await getDb();
    await db.collection('organizations').insertOne({
      _id: orgId,
      name: 'time-servers-org',
      slug: `time-servers-${orgId}`,
      sourcePrefixes: [{ host: otherHost, prefix: 'OT', type: 'redmine', baseUrl: OTHER }],
    });
    await db
      .collection('teams')
      .insertOne({ _id: teamId, orgId: orgId.toHexString(), name: 'time-servers-team', members: [userId], admins: [] });

    expect((await wormhole('redmine.connect', { apiKey: KEY.main }, jwt)).ok).toBe(true);
    expect((await wormhole('sources.connect', { server: OTHER, apiKey: KEY.other }, jwt)).ok).toBe(true);

    await loggedOn233(30);
    await loggedOn233(60, otherHost);
  });

  afterAll(async () => {
    const db = await getDb();
    await db.collection('redmine_links').deleteMany({ userId });
    await db.collection('tickets').deleteMany({ teamId: teamId.toHexString() });
    await db.collection('clockevents').deleteOne({ _id: shiftId });
    await db.collection('redmine_time_syncs').deleteMany({ userId });
    await db.collection('timers').deleteMany({ userId });
    await db.collection('teams').deleteOne({ _id: teamId });
    await db.collection('organizations').deleteOne({ _id: orgId });
    await purgeUser(USER.email);
    await closeDb();
    await Promise.all([main, other].map((s) => new Promise((resolve) => s.close(resolve))));
  });

  it('offers issue 233 once per server, each with its own time', async () => {
    const res = await wormhole<{ rows: Row[] }>('redmine.timeEntries.preview', {}, jwt);
    expect(res.error).toBeUndefined();
    const rows = res.result.rows.map(({ ticketId, hours, host }) => ({ ticketId, hours, host }));
    expect(rows).toHaveLength(2);
    expect(rows).toContainEqual({ ticketId: '233', hours: 0.5, host: undefined });
    expect(rows).toContainEqual({ ticketId: '233', hours: 1, host: otherHost });
  });

  it('sends each to its own server, and records them apart', async () => {
    const res = await wormhole<{ results: { ok: boolean; host?: string }[] }>(
      'redmine.timeEntries.push',
      {
        entries: [
          { ticketId: '233', date: today },
          { ticketId: '233', date: today, host: otherHost },
        ],
      },
      jwt,
    );
    expect(res.error).toBeUndefined();
    expect(res.result.results.map((r) => r.ok)).toEqual([true, true]);
    expect(sentToMain).toMatchObject([{ issue_id: 233, hours: 0.5 }]);
    expect(sentToOther).toMatchObject([{ issue_id: 233, hours: 1 }]);

    const rows = await (await getDb())
      .collection('redmine_time_syncs')
      .find({ userId }, { projection: { _id: 0, ticketId: 1, host: 1, syncedSeconds: 1 } })
      .toArray();
    expect(rows).toHaveLength(2);
    expect(rows).toContainEqual({ ticketId: '233', syncedSeconds: 1800 });
    expect(rows).toContainEqual({ ticketId: '233', host: otherHost, syncedSeconds: 3600 });
  });

  it('offers nothing again on either server', async () => {
    const res = await wormhole<{ rows: Row[] }>('redmine.timeEntries.preview', {}, jwt);
    expect(res.result.rows).toEqual([]);
  });

  it("shows a second server's activity without what was sent there, or hiding what wasn't", async () => {
    const db = await getDb();
    const ticketId = new ObjectId();
    await db.collection('tickets').insertOne({
      _id: ticketId,
      teamId: teamId.toHexString(),
      title: 'on the other server',
      createdAt: new Date(),
      linkedIssue: { source: 'redmine', id: '233', host: otherHost },
    });
    const res = await wormhole<unknown>('tickets.outsideRecord', { ticketId: ticketId.toHexString() }, jwt);
    expect(res.error).toBeUndefined();
    const text = JSON.stringify(res.result);
    // Entry 101 is also what main's send was numbered: it's not the same entry.
    expect(text).toContain('logged in Redmine');
    expect(text).not.toContain('sent from TimeHuddle');
  });

  it("rounds a second server's time by that server's rule, and counts its timer runs", async () => {
    const db = await getDb();
    await db.collection('organizations').updateOne(
      { _id: orgId },
      { $set: { sourcePrefixes: [{ host: otherHost, prefix: 'OT', type: 'redmine', baseUrl: OTHER, rounding: 'up15' }] } },
    );
    await db.collection('clockevents').insertOne({ _id: shiftId, userId, teamId: teamId.toHexString() });
    const end = Date.now() - MINUTE;
    for (const [minutes, gap] of [[3, 0], [4, 10]]) {
      await db.collection('timers').insertOne({
        _id: new ObjectId(),
        workItemId: new ObjectId().toHexString(),
        userId,
        date: today,
        startTime: end - (gap + minutes) * MINUTE,
        endTime: end - gap * MINUTE,
        durationSeconds: minutes * 60,
        redmineIssueId: '240',
        redmineHost: otherHost,
        clockEventId: shiftId.toHexString(),
        createdAt: new Date(),
      });
    }
    const res = await wormhole<{ rows: (Row & { runSeconds: number[] })[] }>('redmine.timeEntries.preview', {}, jwt);
    expect(res.error).toBeUndefined();
    expect(res.result.rows).toHaveLength(1);
    expect(res.result.rows[0]).toMatchObject({ ticketId: '240', host: otherHost, hours: 0.25 });
    expect([...res.result.rows[0].runSeconds].sort()).toEqual([180, 240]);
  });
});
