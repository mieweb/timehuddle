/**
 * Sending time to Redmine, end to end on the server (#688) — wormhole REST
 * integration tests against a stand-in Redmine.
 *
 * A sent entry is permanent, so these cover what no stub at the browser can:
 * what the server actually posts (hours, activity, comment), that it records
 * the entry, and that the two ways of sending — one ticket-day when a timer
 * ends, and the bulk push — cannot both send the same time.
 *
 * The stand-in is a small HTTP server in this process. The test backend must
 * be started pointing at it, and able to read the test's stored key:
 *   REDMINE_BASE_URL=http://127.0.0.1:3998 REDMINE_ENCRYPTION_KEY=<any>
 * with the same two values in this process. Without them the suite is skipped.
 */
import { createServer, type Server } from 'node:http';

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import { deriveKey, encryptSecret } from '../server/redmine-crypto';

import { createUserAndGetJwt, wormhole, getDb, closeDb, purgeUser, ObjectId } from './helpers';

const KEY = process.env.REDMINE_ENCRYPTION_KEY;
const BASE_URL = process.env.REDMINE_BASE_URL;
const USER = { name: 'Send User', email: 'wh-redmine-send@test.dev', password: 'Password1!' };
const today = new Date().toISOString().split('T')[0];
const MINUTE = 60 * 1000;
const DEVELOPMENT = { id: 9, name: 'Development', is_default: true, active: true };
const QA = { id: 10, name: 'QA', active: true };
/** The issue whose project requires Billable on its time entries (#686). */
const BILLABLE_ISSUE = 915;
const BILLABLE = { id: 7, name: 'Billable status', value: '1' };

type Outcome = {
  ok: boolean;
  reason?: string;
  detail?: string[];
  entryId?: number;
  activityName?: string;
};
type Created = {
  issue_id: number;
  hours: number;
  activity_id: number;
  spent_on: string;
  comments?: string;
  custom_fields?: { id: number; value: string }[];
};

describe.skipIf(!KEY || !BASE_URL)('sending time to Redmine', () => {
  let redmine: Server;
  let jwt: string;
  let userId: string;
  /** Every time entry the stand-in was asked to create in this test, in order. */
  const created: Created[] = [];
  // Entry ids, as Redmine gives them: never reused, here or across runs (the
  // ledger holds each id once).
  let lastEntryId = Date.now() % 1_000_000_000;
  const hoursById = new Map<number, number>();
  /** How long the stand-in takes to create an entry, to hold a send open. */
  let createDelayMs = 0;

  const issue = (id: number) => ({
    id,
    subject: `Issue ${id}`,
    project: { id: 1, name: 'Test project' },
    tracker: { id: 1, name: 'Bug' },
    status: { id: 1, name: 'New', is_closed: false },
    priority: { id: 2, name: 'Normal' },
    created_on: '2026-10-01T00:00:00Z',
    updated_on: '2026-10-01T00:00:00Z',
  });

  /** Redmine, as far as sending time needs it. */
  function startRedmine(): Promise<Server> {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', BASE_URL);
      const json = (status: number, body: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      let raw = '';
      req.on('data', (chunk) => (raw += chunk));
      req.on('end', () => {
        if (req.method === 'POST' && url.pathname === '/time_entries.json') {
          const entry = JSON.parse(raw).time_entry as Created;
          // The enterprise instance's rule, on the one issue that has Billable.
          if (entry.issue_id === BILLABLE_ISSUE && !entry.custom_fields?.length) {
            return json(422, { errors: ['Billable status cannot be blank'] });
          }
          created.push(entry);
          const id = ++lastEntryId;
          hoursById.set(id, entry.hours);
          setTimeout(() => json(201, { time_entry: { id, hours: entry.hours } }), createDelayMs);
          return;
        }
        const readBack = url.pathname.match(/^\/time_entries\/(\d+)\.json$/);
        if (readBack) {
          const id = Number(readBack[1]);
          return json(200, { time_entry: { id, hours: hoursById.get(id) } });
        }
        if (url.pathname === '/time_entries.json') {
          // Earlier entries on the Billable issue carry the field; nothing else has one.
          const onIssue = url.searchParams.get('issue_id') === String(BILLABLE_ISSUE);
          return json(200, {
            time_entries: onIssue
              ? [
                  {
                    id: 1,
                    issue: { id: BILLABLE_ISSUE },
                    comments: 'Patient Jane Doe',
                    custom_fields: [BILLABLE],
                  },
                ]
              : [],
          });
        }
        if (url.pathname === '/issues.json') {
          const ids = (url.searchParams.get('issue_id') ?? '').split(',').filter(Boolean);
          return json(200, { issues: ids.map((id) => issue(Number(id))), total_count: ids.length });
        }
        if (url.pathname === '/enumerations/time_entry_activities.json') {
          return json(200, { time_entry_activities: [DEVELOPMENT, QA] });
        }
        if (/^\/projects\/\d+\.json$/.test(url.pathname)) {
          return json(200, { project: { id: 1, time_entry_activities: [DEVELOPMENT, QA] } });
        }
        if (url.pathname === '/users/current.json') return json(200, { user: { id: 1 } });
        return json(404, {});
      });
    });
    return new Promise((resolve) =>
      server.listen(Number(new URL(BASE_URL!).port), () => resolve(server)),
    );
  }

  /** Ten minutes of closed time on a Redmine issue today. */
  async function loggedTime(ticketId: string, minutes = 10) {
    const db = await getDb();
    const item = {
      _id: new ObjectId(),
      userId,
      source: 'redmine',
      ticketId,
      date: today,
      createdAt: new Date(),
    };
    await db.collection('workitems').insertOne(item);
    const end = Date.now() - MINUTE;
    await db.collection('timers').insertOne({
      _id: new ObjectId(),
      workItemId: item._id.toHexString(),
      userId,
      date: today,
      startTime: end - minutes * MINUTE,
      endTime: end,
      durationSeconds: minutes * 60,
      createdAt: new Date(),
    });
  }

  const send = (ticketId: string, extra: Record<string, unknown> = {}) =>
    wormhole<Outcome>(
      'redmine.timeEntries.sendTicketDay',
      { ticketId, date: today, ...extra },
      jwt,
    );

  const ledger = async (ticketId: string) =>
    (await getDb())
      .collection('redmine_time_syncs')
      .find({ userId, ticketId, redmineTimeEntryId: { $type: 'number' } })
      .toArray();

  beforeAll(async () => {
    redmine = await startRedmine();
    await purgeUser(USER.email);
    jwt = (await createUserAndGetJwt(USER)).jwt;
    const db = await getDb();
    userId = String((await db.collection('users').findOne({ 'emails.address': USER.email }))!._id);
    await db.collection('redmine_links').insertOne({
      _id: new ObjectId(),
      userId,
      apiKey: encryptSecret('not-a-real-key', deriveKey(KEY!)),
      redmineUserId: 1,
      createdAt: new Date(),
    });
  });

  beforeEach(() => {
    created.length = 0;
    createDelayMs = 0;
  });

  afterAll(async () => {
    const db = await getDb();
    await db.collection('redmine_links').deleteMany({ userId });
    await db.collection('redmine_time_syncs').deleteMany({ userId });
    await db.collection('timers').deleteMany({ userId });
    await db.collection('workitems').deleteMany({ userId });
    await purgeUser(USER.email);
    await closeDb();
    await new Promise((resolve) => redmine.close(resolve));
  });

  it('sends one entry with the hours, the project’s activity and the trimmed comment, and records it', async () => {
    await loggedTime('910');

    const res = await send('910', { comment: '  Fixed the intake form  ' });

    expect(res.ok).toBe(true);
    expect(res.result).toMatchObject({
      ok: true,
      entryId: lastEntryId,
      activityName: 'Development',
    });
    expect(created).toEqual([
      {
        issue_id: 910,
        hours: 0.17,
        activity_id: 9,
        spent_on: today,
        comments: 'Fixed the intake form',
      },
    ]);
    expect(await ledger('910')).toHaveLength(1);
  });

  it('sends nothing the second time: the time is no longer unsent', async () => {
    const again = await send('910', { comment: 'Again' });

    expect(again.result).toMatchObject({ ok: false, reason: 'already-synced-or-gone' });
    expect(created).toEqual([]);
    expect(await ledger('910')).toHaveLength(1);
  });

  it('says it was logged by TimeHuddle when no comment is written', async () => {
    await loggedTime('911');

    await send('911');

    expect(created[0].comments).toBe('Logged by TimeHuddle');
  });

  it('sends under another activity the project allows, and refuses one it does not', async () => {
    await loggedTime('912');

    const refused = await send('912', { activityId: 999 });
    expect(refused.result).toMatchObject({ ok: false, reason: 'invalid-activity' });
    expect(created).toEqual([]);

    const sent = await send('912', { activityId: QA.id });
    expect(sent.result).toMatchObject({ ok: true, activityName: 'QA' });
    expect(created[0].activity_id).toBe(QA.id);
  });

  it('copies Billable from an earlier entry on the issue, shows it, and sends it', async () => {
    await loggedTime(String(BILLABLE_ISSUE));

    const preview = await wormhole<{ rows: { billable: unknown }[] }>(
      'redmine.timeEntries.preview',
      { ticketId: String(BILLABLE_ISSUE), date: today },
      jwt,
    );
    expect(preview.ok && preview.result.rows[0].billable).toEqual(BILLABLE);

    const res = await send(String(BILLABLE_ISSUE));

    expect(res.result).toMatchObject({ ok: true });
    expect(created[0].custom_fields).toEqual([{ id: BILLABLE.id, value: BILLABLE.value }]);
    // Only the field travels: not the earlier entry's comment.
    expect(JSON.stringify(preview)).not.toContain('Patient');
  });

  it('sends when the Billable it was shown is still the one Redmine has', async () => {
    await loggedTime(String(BILLABLE_ISSUE));

    const res = await send(String(BILLABLE_ISSUE), {
      billable: { id: BILLABLE.id, value: BILLABLE.value },
    });

    expect(res.result).toMatchObject({ ok: true });
    expect(created).toHaveLength(1);
  });

  it('sends nothing when the Billable shown is not the one Redmine has now', async () => {
    await loggedTime(String(BILLABLE_ISSUE));
    const recordedBefore = (await ledger(String(BILLABLE_ISSUE))).length;

    const res = await send(String(BILLABLE_ISSUE), { billable: { id: BILLABLE.id, value: '0' } });

    expect(res.result).toMatchObject({ ok: false, reason: 'billable-changed' });
    expect(created).toHaveLength(0);
    // Still unsent, so the next preview offers it again with the new value.
    expect(await ledger(String(BILLABLE_ISSUE))).toHaveLength(recordedBefore);
  });

  it('sends nothing when no Billable was shown but Redmine has one now', async () => {
    await loggedTime(String(BILLABLE_ISSUE));

    const res = await send(String(BILLABLE_ISSUE), { billable: null });

    expect(res.result).toMatchObject({ ok: false, reason: 'billable-changed' });
    expect(created).toHaveLength(0);
  });

  it('sends when none was shown and Redmine has none', async () => {
    await loggedTime('916');

    const res = await send('916', { billable: null });

    expect(res.result).toMatchObject({ ok: true });
    expect(created).toHaveLength(1);
    expect(created[0].custom_fields).toBeUndefined();
  });

  it('the bulk push also turns away an entry whose Billable moved, and sends the rest', async () => {
    await loggedTime(String(BILLABLE_ISSUE));
    await loggedTime('917');

    const bulk = await wormhole<{ results: Outcome[] }>(
      'redmine.timeEntries.push',
      {
        entries: [
          {
            ticketId: String(BILLABLE_ISSUE),
            date: today,
            billable: { id: BILLABLE.id, value: '0' },
          },
          { ticketId: '917', date: today, billable: null },
        ],
      },
      jwt,
    );

    expect(bulk.ok && bulk.result.results.map((r) => [r.ticketId, r.ok, r.reason])).toEqual([
      [String(BILLABLE_ISSUE), false, 'billable-changed'],
      ['917', true, undefined],
    ]);
    expect(created).toHaveLength(1);
  });

  it('refuses a Billable that is not an id and a value', async () => {
    await loggedTime('918');

    const res = await send('918', { billable: { id: 'seven', value: 1 } });

    expect(res.ok).toBe(false);
    expect(created).toHaveLength(0);
  });

  it('a send and a bulk push at the same moment create one entry between them', async () => {
    await loggedTime('913');
    // Long enough for the second request to arrive while the first holds the lock.
    createDelayMs = 400;

    const [one, bulk] = await Promise.all([
      send('913', { comment: 'From the prompt' }),
      wormhole<{ results: Outcome[] }>(
        'redmine.timeEntries.push',
        { entries: [{ ticketId: '913', date: today, comment: 'From the dialog' }] },
        jwt,
      ),
    ]);

    // Exactly one of them wrote it. The other was turned away by the lock, or
    // found nothing left once it got in.
    expect(created).toHaveLength(1);
    expect(await ledger('913')).toHaveLength(1);
    const sentByOne = one.ok && one.result.ok === true;
    const sentByBulk = bulk.ok && bulk.result.results[0]?.ok === true;
    expect([sentByOne, sentByBulk].filter(Boolean)).toHaveLength(1);
  });

  it('two sends of the same ticket-day at the same moment create one entry', async () => {
    await loggedTime('914');
    createDelayMs = 400;

    await Promise.all([send('914'), send('914')]);

    expect(created).toHaveLength(1);
    expect(await ledger('914')).toHaveLength(1);
  });
});
