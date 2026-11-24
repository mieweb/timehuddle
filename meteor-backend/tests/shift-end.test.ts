/**
 * Shift end (#894) — "Continue Working" and the 8h auto clock-out jobs.
 *
 * Fixture: USER, a member of a team run by ADMIN. Each case clocks in, moves
 * the session's start back past 8h, then forces the Agenda jobs to run now
 * instead of waiting. Needs a backend with METEOR_AGENDA_ENABLED=true (the
 * default for npm start).
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { createUserAndGetJwt, wormhole, getDb, closeDb, purgeUser, ObjectId } from './helpers';

const USER = { name: 'Shift End User', email: 'wh-shift-end@test.dev', password: 'Password1!' };
const ADMIN = { name: 'Shift End Admin', email: 'wh-shift-end-admin@test.dev', password: 'Password1!' };
const TEAM_CODE = 'WHSHIFT1';
const PAST_8H_MS = 8 * 3600_000 + 60_000;
const JOB_TIMEOUT = 45_000;

let jwt: string;
let userId: string;
let adminId: string;
let teamId: string;

/** The admin's "member clocked out" notices about USER. */
async function adminClockOutNotices() {
  const db = await getDb();
  return db
    .collection('notifications')
    .find({ userId: adminId, 'data.type': 'clock-out', 'data.userId': userId })
    .toArray();
}

/** Poll until `check` returns a truthy value, or fail after `timeoutMs`. */
async function waitFor<T>(check: () => Promise<T>, what: string, timeoutMs = 30_000): Promise<T> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const value = await check();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

async function clockEvent(clockEventId: string) {
  const db = await getDb();
  return db.collection('clockevents').findOne({ _id: new ObjectId(clockEventId) });
}

async function notificationsOf(clockEventId: string, type: string) {
  const db = await getDb();
  return db
    .collection('notifications')
    .find({ userId, 'data.clockEventId': clockEventId, 'data.type': type })
    .toArray();
}

async function jobOf(name: string, clockEventId: string) {
  const db = await getDb();
  return db.collection('agendajobs').findOne({ name, 'data.clockEventId': clockEventId });
}

/** Make a scheduled job due now, once it exists (scheduling is fire-and-forget). */
async function runJobNow(name: string, clockEventId: string) {
  await waitFor(() => jobOf(name, clockEventId), `${name} to be scheduled`);
  const db = await getDb();
  await db
    .collection('agendajobs')
    .updateOne(
      { name, 'data.clockEventId': clockEventId },
      { $set: { nextRunAt: new Date(), lockedAt: null } },
    );
}

/** Clock in and pretend the session started just over 8 hours ago. */
async function clockInPast8h(): Promise<string> {
  const res = await wormhole<{ id: string }>('clock.start', { teamId }, jwt);
  expect(res.ok).toBe(true);
  const db = await getDb();
  await db
    .collection('clockevents')
    .updateOne(
      { _id: new ObjectId(res.result.id) },
      { $set: { startTime: Date.now() - PAST_8H_MS } },
    );
  return res.result.id;
}

/** Fire the 7h45m reminder and return its notification. */
async function sendReminder(clockEventId: string) {
  await runJobNow('shift-end-reminder', clockEventId);
  const [reminder] = await waitFor(
    async () => {
      const found = await notificationsOf(clockEventId, 'shift-end-reminder');
      return found.length ? found : null;
    },
    'the shift-end reminder',
  );
  return reminder;
}

async function expectSingleAutoClockOutNotice(clockEventId: string) {
  const notices = await waitFor(
    async () => {
      const found = await notificationsOf(clockEventId, 'auto-clock-out');
      return found.length ? found : null;
    },
    'the auto clock-out notice',
  );
  expect(notices).toHaveLength(1);
  expect(notices[0].read).toBe(false);
  expect(notices[0].data.url).toBe('/app/clock');
  expect(await notificationsOf(clockEventId, 'shift-end-reminder')).toHaveLength(0);

  const adminNotices = await waitFor(
    async () => {
      const found = await adminClockOutNotices();
      return found.length ? found : null;
    },
    "the admin's clock-out notice",
  );
  expect(adminNotices).toHaveLength(1);
  expect(adminNotices[0].body).toMatch(/was automatically clocked out of WH Shift End Team after 8 hours/);
  expect(adminNotices[0].data.teamId).toBe(teamId);
}

beforeAll(async () => {
  await purgeUser(USER.email);
  await purgeUser(ADMIN.email);
  jwt = (await createUserAndGetJwt(USER)).jwt;
  await createUserAndGetJwt(ADMIN);
  const db = await getDb();
  userId = String((await db.collection('users').findOne({ 'emails.address': USER.email }))!._id);
  adminId = String((await db.collection('users').findOne({ 'emails.address': ADMIN.email }))!._id);
  const team = {
    _id: new ObjectId(),
    name: 'WH Shift End Team',
    members: [userId, adminId],
    admins: [adminId],
    code: TEAM_CODE,
    isPersonal: false,
    settings: { requirePlanForClock: false },
    createdAt: new Date(),
  };
  await db.collection('teams').insertOne(team);
  teamId = team._id.toHexString();
});

beforeEach(async () => {
  const db = await getDb();
  await db.collection('notifications').deleteMany({ userId: adminId });
});

afterAll(async () => {
  const db = await getDb();
  await db.collection('agendajobs').deleteMany({ 'data.userId': userId });
  await db.collection('notifications').deleteMany({ userId: { $in: [userId, adminId] } });
  await db.collection('clockbreaks').deleteMany({ teamId });
  await db.collection('clockevents').deleteMany({ teamId });
  await db.collection('teams').deleteMany({ code: TEAM_CODE });
  await purgeUser(USER.email);
  await purgeUser(ADMIN.email);
  await closeDb();
});

describe('Continue Working', () => {
  it(
    'keeps the user clocked in past 8 hours',
    async () => {
      const clockEventId = await clockInPast8h();
      const reminder = await sendReminder(clockEventId);
      await waitFor(() => jobOf('shift-missed-clockout', clockEventId), 'the 8h job');

      const res = await wormhole<{ ok: boolean }>(
        'clock.respondShiftReminder',
        { notificationId: String(reminder._id), action: 'disagree' },
        jwt,
      );
      expect(res.ok).toBe(true);

      const event = await clockEvent(clockEventId);
      expect(event?.shiftReminderResponse).toBe('disagreed');
      expect(event?.endTime).toBeNull();
      await waitFor(
        async () => !(await jobOf('shift-missed-clockout', clockEventId)),
        'the 8h job to be cancelled',
      );
      expect(await notificationsOf(clockEventId, 'shift-end-reminder')).toHaveLength(0);

      // A manual clock-out still sends the usual notices, not the automatic ones.
      const stop = await wormhole('clock.stop', { teamId }, jwt);
      expect(stop.ok).toBe(true);
      const [adminNotice] = await waitFor(
        async () => {
          const found = await adminClockOutNotices();
          return found.length ? found : null;
        },
        "the admin's clock-out notice",
      );
      expect(adminNotice.body).toMatch(/^Shift End User clocked out of WH Shift End Team \(/);
    },
    JOB_TIMEOUT,
  );
});

describe('auto clock-out notice', () => {
  it(
    'tells the user when they agreed to be clocked out',
    async () => {
      const clockEventId = await clockInPast8h();
      await sendReminder(clockEventId);
      const res = await wormhole('clock.agreeAutoClockout', { clockEventId }, jwt);
      expect(res.ok).toBe(true);

      await runJobNow('shift-auto-clockout', clockEventId);
      await waitFor(async () => (await clockEvent(clockEventId))?.endTime, 'the clock-out');
      await expectSingleAutoClockOutNotice(clockEventId);
    },
    JOB_TIMEOUT,
  );

  it(
    'tells the user when the reminder went unanswered',
    async () => {
      const clockEventId = await clockInPast8h();
      await sendReminder(clockEventId);

      await runJobNow('shift-missed-clockout', clockEventId);
      await waitFor(async () => (await clockEvent(clockEventId))?.endTime, 'the clock-out');
      await expectSingleAutoClockOutNotice(clockEventId);
    },
    JOB_TIMEOUT,
  );

  it(
    'says nothing when the session had already ended',
    async () => {
      const clockEventId = await clockInPast8h();
      await sendReminder(clockEventId);
      await waitFor(() => jobOf('shift-missed-clockout', clockEventId), 'the 8h job');
      // Ended without cancelling the job — the race the job must tolerate.
      const db = await getDb();
      await db
        .collection('clockevents')
        .updateOne({ _id: new ObjectId(clockEventId) }, { $set: { endTime: Date.now() } });

      await runJobNow('shift-missed-clockout', clockEventId);
      await waitFor(
        async () => (await jobOf('shift-missed-clockout', clockEventId))?.lastFinishedAt,
        'the 8h job to run',
      );
      expect(await notificationsOf(clockEventId, 'auto-clock-out')).toHaveLength(0);
      expect(await adminClockOutNotices()).toHaveLength(0);
    },
    JOB_TIMEOUT,
  );
});
