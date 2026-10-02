/**
 * Clock ↔ ticket-timer integration — wormhole REST tests.
 *
 * Covers the interaction between clock in/out/pause/resume and the ticket
 * timer session in the `timers` collection: clocking out must close any
 * running ticket timer, and going on break must pause it and restart a new
 * session on resume (see #436 — auto-clockout previously left timers running).
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

const USER = { name: 'Clock Timer User', email: 'wh-clock-timer-user@test.dev', password: 'Password1!' };

let jwt: string;
let userId: string;
let teamId: string;
let ticketId: string;

async function startTicketTimer() {
  const today = new Date().toISOString().split('T')[0];
  const res = await wormhole<{ entry: { id: string }; session: { id: string } | null }>(
    'timers.createEntry',
    { ticketId, date: today, startNow: true, notifyAdmins: false },
    jwt,
  );
  expect(res.ok).toBe(true);
  return res.result.entry.id; // workItemId
}

beforeAll(async () => {
  await purgeUser(USER.email);
  const auth = await createUserAndGetJwt(USER);
  jwt = auth.jwt;

  const db = await getDb();
  userId = String((await db.collection('users').findOne({ 'emails.address': USER.email }))!._id);

  const teamDoc = {
    _id: new ObjectId(),
    name: 'WH Clock Timer Team',
    members: [userId],
    admins: [userId],
    code: 'WHCLKTMR',
    isPersonal: false,
    createdAt: new Date(),
  };
  await db.collection('teams').insertOne(teamDoc);
  teamId = teamDoc._id.toHexString();

  const ticketDoc = {
    _id: new ObjectId(),
    teamId,
    title: 'Clock Timer Test Ticket',
    status: 'open',
    priority: 'medium',
    createdBy: userId,
    assignedTo: userId,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  await db.collection('tickets').insertOne(ticketDoc);
  ticketId = ticketDoc._id.toHexString();
});

afterAll(async () => {
  const db = await getDb();
  await db.collection('teams').deleteMany({ code: 'WHCLKTMR' });
  await db.collection('tickets').deleteMany({ teamId });
  await db.collection('workitems').deleteMany({ userId });
  await db.collection('timers').deleteMany({ userId });
  await db.collection('clockevents').deleteMany({ teamId });
  await db.collection('clockbreaks').deleteMany({});
  await purgeUser(USER.email);
  await closeDb();
});

describe('clock out stops the running ticket timer', () => {
  it('closes the running timer session when clocking out', async () => {
    const db = await getDb();

    const clockIn = await wormhole('clock.start', { teamId }, jwt);
    expect(clockIn.ok).toBe(true);

    const workItemId = await startTicketTimer();
    const runningBefore = await db.collection('timers').findOne({ userId, workItemId, endTime: null });
    expect(runningBefore).not.toBeNull();

    const clockOut = await wormhole<{ endTime: number | null }>('clock.stop', { teamId }, jwt);
    expect(clockOut.ok).toBe(true);
    expect(clockOut.result.endTime).not.toBeNull();

    const runningAfter = await db.collection('timers').findOne({ userId, workItemId, endTime: null });
    expect(runningAfter).toBeNull();

    const closedSession = await db.collection('timers').findOne({ userId, workItemId, endTime: { $ne: null } });
    expect(closedSession).not.toBeNull();
    expect(closedSession!.durationSeconds).toBeGreaterThanOrEqual(0);
  });
});

describe('break pauses and resumes the running ticket timer', () => {
  it('pauses the ticket timer on break start and restarts a new session on resume', async () => {
    const db = await getDb();

    const clockIn = await wormhole('clock.start', { teamId }, jwt);
    expect(clockIn.ok).toBe(true);

    const workItemId = await startTicketTimer();
    const runningBeforeBreak = await db
      .collection('timers')
      .findOne({ userId, workItemId, endTime: null });
    expect(runningBeforeBreak).not.toBeNull();
    const firstSessionId = String(runningBeforeBreak!._id);

    // Going on break should pause (close) the running ticket timer.
    const pause = await wormhole('clock.pause', { teamId }, jwt);
    expect(pause.ok).toBe(true);

    const noneRunningOnBreak = await db.collection('timers').findOne({ userId, endTime: null });
    expect(noneRunningOnBreak).toBeNull();

    const firstSessionClosed = await db.collection('timers').findOne({ _id: new ObjectId(firstSessionId) });
    expect(firstSessionClosed!.endTime).not.toBeNull();

    // Resuming should restart a fresh session for the same work item.
    const resume = await wormhole('clock.resume', { teamId }, jwt);
    expect(resume.ok).toBe(true);

    const runningAfterResume = await db
      .collection('timers')
      .findOne({ userId, workItemId, endTime: null });
    expect(runningAfterResume).not.toBeNull();
    expect(String(runningAfterResume!._id)).not.toBe(firstSessionId);

    // Clean up: clocking out should close the resumed session too.
    const clockOut = await wormhole<{ endTime: number | null }>('clock.stop', { teamId }, jwt);
    expect(clockOut.ok).toBe(true);

    const runningAfterClockOut = await db.collection('timers').findOne({ userId, endTime: null });
    expect(runningAfterClockOut).toBeNull();
  });
});

describe('ticket titles follow the viewer', () => {
  const ADMIN = { name: 'Clock Timer Admin', email: 'wh-clock-timer-admin@test.dev', password: 'Password1!' };
  let adminJwt: string;
  let adminId: string;

  type Timesheet = { sessions: { ticketSessions: { ticketId: string; title: string | null }[] }[] };

  const titlesSeenBy = async (viewerJwt: string) => {
    const res = await wormhole<Timesheet>(
      'clock.timesheet',
      { userId, startMs: Date.now() - 24 * 60 * 60 * 1000, endMs: Date.now() + 60 * 1000 },
      viewerJwt,
    );
    expect(res.ok).toBe(true);
    const rows = res.result.sessions.flatMap((s) => s.ticketSessions);
    expect(rows.length).toBeGreaterThan(0);
    return rows.map((row) => row.title);
  };

  const todayTitlesSeenBy = async (viewerJwt: string) => {
    const res = await wormhole<{ entries: { entry: { displayTitle: string | null } }[] }>(
      'timers.getToday',
      { userId },
      viewerJwt,
    );
    expect(res.ok).toBe(true);
    expect(res.result.entries.length).toBeGreaterThan(0);
    return res.result.entries.map(({ entry }) => entry.displayTitle);
  };

  beforeAll(async () => {
    await purgeUser(ADMIN.email);
    adminJwt = (await createUserAndGetJwt(ADMIN)).jwt;
    const db = await getDb();
    adminId = String((await db.collection('users').findOne({ 'emails.address': ADMIN.email }))!._id);
    // The admin shares this team with the user, but not the ticket's team.
    await db.collection('teams').insertOne({
      _id: new ObjectId(),
      name: 'WH Clock Timer Shared Team',
      members: [userId],
      admins: [adminId],
      code: 'WHCLKSHR',
      isPersonal: false,
      createdAt: new Date(),
    });
  });

  afterAll(async () => {
    const db = await getDb();
    await db.collection('teams').deleteMany({ code: 'WHCLKSHR' });
    await db.collection('teams').updateOne({ code: 'WHCLKTMR' }, { $pull: { members: adminId } as never });
    await purgeUser(ADMIN.email);
  });

  it('shows the owner their own ticket titles', async () => {
    expect(await titlesSeenBy(jwt)).toContain('Clock Timer Test Ticket');
  });

  it('hides a title from an admin who is not in the ticket\u2019s team', async () => {
    const titles = await titlesSeenBy(adminJwt);
    expect(titles.every((title) => title === null)).toBe(true);
  });

  it('hides a title from an admin reading the member\u2019s day, too', async () => {
    const titles = await todayTitlesSeenBy(adminJwt);
    expect(titles.every((title) => title === null)).toBe(true);
  });

  it('shows the title once the admin belongs to the ticket\u2019s team', async () => {
    const db = await getDb();
    await db.collection('teams').updateOne({ code: 'WHCLKTMR' }, { $push: { members: adminId } as never });
    expect(await titlesSeenBy(adminJwt)).toContain('Clock Timer Test Ticket');
    expect(await todayTitlesSeenBy(adminJwt)).toContain('Clock Timer Test Ticket');
  });
});
