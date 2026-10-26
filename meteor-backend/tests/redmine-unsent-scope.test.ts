/**
 * The unsent time worked out for one ticket-day (#688) — wormhole REST
 * integration tests.
 *
 * When a timer ends, the server reads only that issue's day to decide what is
 * left to send, not the user's whole Redmine history. These tests give a user
 * history on other days and other issues and check two things: the narrow read
 * ignores all of it, and it agrees with the full read the push dialog does.
 *
 * Needs a linked Redmine account, which is stored encrypted, so the test
 * backend must run with the same `REDMINE_ENCRYPTION_KEY` as this process.
 * Without it the suite is skipped. Nothing here reaches Redmine: what is unsent
 * is local data, and the preview reports an unreachable Redmine row by row.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { deriveKey, encryptSecret } from '../server/redmine-crypto';

import { createUserAndGetJwt, wormhole, getDb, closeDb, purgeUser, ObjectId } from './helpers';

const KEY = process.env.REDMINE_ENCRYPTION_KEY;
const USER = { name: 'Scope User', email: 'wh-unsent-scope@test.dev', password: 'Password1!' };

const day = (offset: number) =>
  new Date(Date.now() + offset * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
const today = day(0);
const yesterday = day(-1);
const MINUTE = 60 * 1000;

type Unsent = { ticketId: string; date: string; hours: number } | null;
type PreviewRow = { ticketId: string; date: string; hours: number; seconds: number };

describe.skipIf(!KEY)('unsent Redmine time for one ticket-day', () => {
  let jwt: string;
  let userId: string;
  let teamId: string;
  let todayEntryId: string;

  /** A work item on a Redmine issue, with one closed session of `minutes`. */
  async function loggedTime(ticketId: string, date: string, minutes: number): Promise<string> {
    const db = await getDb();
    const item = { _id: new ObjectId(), userId, source: 'redmine', ticketId, date, createdAt: new Date() };
    await db.collection('workitems').insertOne(item);
    const end = Date.now() - MINUTE;
    await db.collection('timers').insertOne({
      _id: new ObjectId(),
      workItemId: item._id.toHexString(),
      userId,
      date,
      startTime: end - minutes * MINUTE,
      endTime: end,
      durationSeconds: minutes * 60,
      createdAt: new Date(),
    });
    return item._id.toHexString();
  }

  beforeAll(async () => {
    await purgeUser(USER.email);
    jwt = (await createUserAndGetJwt(USER)).jwt;
    const db = await getDb();
    userId = String((await db.collection('users').findOne({ 'emails.address': USER.email }))!._id);

    const team = {
      _id: new ObjectId(),
      name: 'WH Scope Team',
      members: [userId],
      admins: [userId],
      code: 'WHSCOPE',
      isPersonal: false,
      createdAt: new Date(),
    };
    await db.collection('teams').insertOne(team);
    teamId = team._id.toHexString();

    await db.collection('redmine_links').insertOne({
      _id: new ObjectId(),
      userId,
      apiKey: encryptSecret('not-a-real-key', deriveKey(KEY!)),
      redmineUserId: 1,
      createdAt: new Date(),
    });

    // Issue 900 today: 10 minutes logged, 4 of them already sent.
    todayEntryId = await loggedTime('900', today, 10);
    await db.collection('redmine_time_syncs').insertOne({
      _id: new ObjectId(),
      userId,
      ticketId: '900',
      date: today,
      syncedSeconds: 240,
      syncedHours: 0.07,
      redmineTimeEntryId: 5,
      createdAt: new Date(),
    });
    // History the answer must not pick up: the same issue on another day, and
    // another issue on the same day.
    await loggedTime('900', yesterday, 30);
    await loggedTime('901', today, 20);

    expect((await wormhole('clock.start', { teamId }, jwt)).ok).toBe(true);
  });

  afterAll(async () => {
    await wormhole('clock.stop', { teamId }, jwt);
    const db = await getDb();
    await db.collection('redmine_links').deleteMany({ userId });
    await db.collection('redmine_time_syncs').deleteMany({ userId });
    await db.collection('timers').deleteMany({ userId });
    await db.collection('workitems').deleteMany({ userId });
    await db.collection('clockevents').deleteMany({ userId });
    await db.collection('teams').deleteMany({ code: 'WHSCOPE' });
    await purgeUser(USER.email);
    await closeDb();
  });

  it('a stop reports that issue’s day alone, less what was already sent', async () => {
    const started = await wormhole<{ session: { id: string } }>(
      'timers.startSession',
      { entryId: todayEntryId },
      jwt,
    );
    expect(started.ok).toBe(true);
    // Two more minutes on issue 900 today.
    const db = await getDb();
    await db
      .collection('timers')
      .updateOne(
        { _id: new ObjectId(started.result.session.id) },
        { $set: { startTime: Date.now() - 2 * MINUTE } },
      );

    const stopped = await wormhole<{ unsentRedmine: Unsent }>(
      'timers.stopSession',
      { sessionId: started.result.session.id },
      jwt,
    );

    expect(stopped.ok).toBe(true);
    // 12 minutes logged, 4 sent: 8 left. Not the 30 of yesterday, nor the 20 on #901.
    expect(stopped.result.unsentRedmine).toEqual({ ticketId: '900', date: today, hours: 0.13 });
  });

  it('agrees with the full read the push dialog does', async () => {
    const all = await wormhole<{ rows: PreviewRow[] }>('redmine.timeEntries.preview', {}, jwt);
    const one = await wormhole<{ rows: PreviewRow[] }>(
      'redmine.timeEntries.preview',
      { ticketId: '900', date: today },
      jwt,
    );
    expect(all.ok).toBe(true);
    expect(one.ok).toBe(true);

    // The full read sees all three ticket-days; the narrow one, only its own.
    expect(all.result.rows).toHaveLength(3);
    expect(one.result.rows).toHaveLength(1);

    const inFull = all.result.rows.find((row) => row.ticketId === '900' && row.date === today);
    expect(one.result.rows[0]).toEqual(inFull);
    expect(inFull!.hours).toBe(0.13);
  });

  it('discarding one ticket-day leaves the others unsent', async () => {
    const discarded = await wormhole<{ discardedSeconds: number }>(
      'redmine.timeEntries.discard',
      { ticketId: '901', date: today },
      jwt,
    );
    expect(discarded.ok).toBe(true);
    expect(discarded.result.discardedSeconds).toBe(20 * 60);

    const all = await wormhole<{ rows: PreviewRow[] }>('redmine.timeEntries.preview', {}, jwt);
    expect(all.result.rows.map((row) => `${row.ticketId}@${row.date}`).sort()).toEqual(
      [`900@${today}`, `900@${yesterday}`].sort(),
    );
  });
});
