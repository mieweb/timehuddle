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
let adminJwt: string;
let userId: string;
let adminId: string;
let teamId: string;
const sessionPostIds: Record<string, string> = {};

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

/** Clock in and pretend the session started `agoMs` ago (just over 8 hours by default), with its Huddle post. */
async function clockInPast8h(agoMs = PAST_8H_MS): Promise<string> {
  const res = await wormhole<{ id: string }>('clock.start', { teamId }, jwt);
  expect(res.ok).toBe(true);
  const db = await getDb();
  sessionPostIds[res.result.id] = (
    await db
      .collection('huddlePosts')
      .insertOne({ teamId, userId, clockEventId: res.result.id, createdAt: new Date() })
  ).insertedId.toHexString();
  await db
    .collection('clockevents')
    .updateOne(
      { _id: new ObjectId(res.result.id) },
      { $set: { startTime: Date.now() - agoMs } },
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
  expect(notices[0].data.url).toBe(
    `/app/huddle?postId=${sessionPostIds[clockEventId]}&teamId=${teamId}`,
  );
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
  adminJwt = (await createUserAndGetJwt(ADMIN)).jwt;
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
  await db.collection('huddlePosts').deleteMany({ teamId });
  await db.collection('teams').deleteMany({ code: TEAM_CODE });
  await purgeUser(USER.email);
  await purgeUser(ADMIN.email);
  await closeDb();
});

describe('Continue Working', () => {
  it(
    'still saves when the reminder was already cleared elsewhere',
    async () => {
      const clockEventId = await clockInPast8h(7 * 3600_000 + 50 * 60_000);
      const reminder = await sendReminder(clockEventId);
      await waitFor(() => jobOf('shift-missed-clockout', clockEventId), 'the 8h job');
      const db = await getDb();
      await db.collection('notifications').deleteOne({ _id: reminder._id });

      // Only the session's owner may answer for it.
      const intruder = await wormhole(
        'clock.respondShiftReminder',
        { notificationId: String(reminder._id), clockEventId, action: 'disagree' },
        adminJwt,
      );
      expect(intruder.ok).toBe(false);
      expect((await clockEvent(clockEventId))?.shiftReminderResponse).toBeUndefined();

      const res = await wormhole(
        'clock.respondShiftReminder',
        { notificationId: String(reminder._id), clockEventId, action: 'disagree' },
        jwt,
      );
      expect(res.ok).toBe(true);
      expect((await clockEvent(clockEventId))?.shiftReminderResponse).toBe('disagreed');
      await waitFor(
        async () => !(await jobOf('shift-missed-clockout', clockEventId)),
        'the 8h job to be cancelled',
      );
      await wormhole('clock.stop', { teamId }, jwt);
    },
    JOB_TIMEOUT,
  );

  it(
    'also withdraws an earlier agreement to be clocked out',
    async () => {
      // Just under 8h in, so the agreed job is still queued rather than due at once.
      const clockEventId = await clockInPast8h(7 * 3600_000 + 50 * 60_000);
      const reminder = await sendReminder(clockEventId);
      const agreed = await wormhole('clock.agreeAutoClockout', { clockEventId }, jwt);
      expect(agreed.ok).toBe(true);
      await waitFor(() => jobOf('shift-auto-clockout', clockEventId), 'the agreed 8h job');

      const res = await wormhole(
        'clock.respondShiftReminder',
        { notificationId: String(reminder._id), action: 'disagree' },
        jwt,
      );
      expect(res.ok).toBe(true);

      const event = await clockEvent(clockEventId);
      expect(event?.autoClockoutAgreed).toBeFalsy();
      expect(event?.shiftReminderResponse).toBe('disagreed');
      expect(event?.endTime).toBeNull();
      await waitFor(
        async () => !(await jobOf('shift-auto-clockout', clockEventId)),
        'the agreed 8h job to be cancelled',
      );
      await wormhole('clock.stop', { teamId }, jwt);
    },
    JOB_TIMEOUT,
  );

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

describe('manual clock-out', () => {
  it(
    'is finished by the next try if it stopped after closing the session, without repeating notices',
    async () => {
      const clockEventId = await clockInPast8h();
      expect((await wormhole('clock.pause', { teamId }, jwt)).ok).toBe(true);
      const db = await getDb();
      await db.collection('clockevents').updateOne(
        { _id: new ObjectId(clockEventId) },
        { $set: { endTime: Date.now(), accumulatedTime: PAST_8H_MS / 1000, manualClockoutPending: true } },
      );
      // The admin was already told before the run stopped.
      await db.collection('notifications').insertOne({
        userId: adminId,
        title: 'Huddle',
        body: 'earlier notice',
        data: { type: 'clock-out', userId, clockEventId, teamId },
        read: false,
        createdAt: new Date(),
      });

      const res = await wormhole('clock.stop', { teamId }, jwt);
      expect(res.ok).toBe(true);
      const event = await clockEvent(clockEventId);
      expect(event?.manualClockoutPending).toBeUndefined();
      const breaks = await db.collection('clockbreaks').find({ clockEventId }).toArray();
      expect(typeof breaks[0].endTime).toBe('number');
      expect(await adminClockOutNotices()).toHaveLength(1);
      // Done: a further try finds nothing to clock out of.
      expect((await wormhole('clock.stop', { teamId }, jwt)).ok).toBe(false);
    },
    JOB_TIMEOUT,
  );
});

describe('finishing a clock-out held by another run', () => {
  const HELD_FOR_MS = 120_000;
  const OTHER_RUN = 'other-run-token';

  it(
    'does not finish a manual clock-out another stop is finishing, until its lease ends',
    async () => {
      const clockEventId = await clockInPast8h();
      const db = await getDb();
      await db.collection('clockevents').updateOne(
        { _id: new ObjectId(clockEventId) },
        {
          $set: {
            endTime: Date.now(),
            accumulatedTime: PAST_8H_MS / 1000,
            manualClockoutPending: true,
            closeLeaseUntil: Date.now() + HELD_FOR_MS,
            closeLeaseToken: OTHER_RUN,
          },
        },
      );

      expect((await wormhole('clock.stop', { teamId }, jwt)).ok).toBe(false);
      const held = await clockEvent(clockEventId);
      expect(held?.manualClockoutPending).toBe(true);
      // The run that owns the lease keeps it: a run that lost out leaves it alone.
      expect(held?.closeLeaseToken).toBe(OTHER_RUN);
      expect(await adminClockOutNotices()).toHaveLength(0);

      await db
        .collection('clockevents')
        .updateOne({ _id: new ObjectId(clockEventId) }, { $set: { closeLeaseUntil: Date.now() - 1 } });
      expect((await wormhole('clock.stop', { teamId }, jwt)).ok).toBe(true);
      expect((await clockEvent(clockEventId))?.manualClockoutPending).toBeUndefined();
      expect(await adminClockOutNotices()).toHaveLength(1);
    },
    JOB_TIMEOUT,
  );

  it(
    'does not finish an auto clock-out another job is finishing, but comes back for it',
    async () => {
      const clockEventId = await clockInPast8h();
      await sendReminder(clockEventId);
      await waitFor(() => jobOf('shift-missed-clockout', clockEventId), 'the 8h job');
      const db = await getDb();
      await db.collection('clockevents').updateOne(
        { _id: new ObjectId(clockEventId) },
        {
          $set: {
            endTime: Date.now(),
            accumulatedTime: PAST_8H_MS / 1000,
            autoClockoutPending: true,
            closeLeaseUntil: Date.now() + HELD_FOR_MS,
            closeLeaseToken: OTHER_RUN,
          },
        },
      );

      await runJobNow('shift-missed-clockout', clockEventId);
      // Deferred, not dropped: it is scheduled to come back.
      await waitFor(
        async () => {
          const job = await jobOf('shift-missed-clockout', clockEventId);
          return job && new Date(job.nextRunAt).getTime() > Date.now() + 30_000;
        },
        'the job to be put back',
      );
      const held = await clockEvent(clockEventId);
      expect(held?.autoClockoutPending).toBe(true);
      expect(held?.closeLeaseToken).toBe(OTHER_RUN);
      expect(await notificationsOf(clockEventId, 'auto-clock-out')).toHaveLength(0);

      await db
        .collection('clockevents')
        .updateOne({ _id: new ObjectId(clockEventId) }, { $set: { closeLeaseUntil: Date.now() - 1 } });
      await runJobNow('shift-missed-clockout', clockEventId);
      await waitFor(
        async () => !(await clockEvent(clockEventId))?.autoClockoutPending,
        'the clock-out to be finished',
      );
      await expectSingleAutoClockOutNotice(clockEventId);
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
    'still tells a user who agreed even if reminders were turned off afterwards',
    async () => {
      const clockEventId = await clockInPast8h();
      await sendReminder(clockEventId);
      const res = await wormhole('clock.agreeAutoClockout', { clockEventId }, jwt);
      expect(res.ok).toBe(true);

      const db = await getDb();
      const teams = db.collection('teams');
      await teams.updateOne(
        { _id: new ObjectId(teamId) },
        { $set: { 'settings.shiftEndReminders': false } },
      );
      try {
        await runJobNow('shift-auto-clockout', clockEventId);
        await waitFor(async () => (await clockEvent(clockEventId))?.endTime, 'the clock-out');
        await expectSingleAutoClockOutNotice(clockEventId);
      } finally {
        await teams.updateOne(
          { _id: new ObjectId(teamId) },
          { $unset: { 'settings.shiftEndReminders': '' } },
        );
      }
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
    'closes a break that is still open when it clocks the user out',
    async () => {
      const clockEventId = await clockInPast8h();
      await sendReminder(clockEventId);
      expect((await wormhole('clock.pause', { teamId }, jwt)).ok).toBe(true);

      await runJobNow('shift-missed-clockout', clockEventId);
      const event = await waitFor(
        async () => (await clockEvent(clockEventId))?.endTime && (await clockEvent(clockEventId)),
        'the clock-out',
      );
      const db = await getDb();
      const breaks = await db.collection('clockbreaks').find({ clockEventId }).toArray();
      expect(breaks).toHaveLength(1);
      expect(typeof breaks[0].endTime).toBe('number');
      expect(event.accumulatedTime).toBeGreaterThan(8 * 3600);
      await expectSingleAutoClockOutNotice(clockEventId);
    },
    JOB_TIMEOUT,
  );

  it(
    'finishes a clock-out that was interrupted after the session was closed',
    async () => {
      const clockEventId = await clockInPast8h();
      await sendReminder(clockEventId);
      expect((await wormhole('clock.pause', { teamId }, jwt)).ok).toBe(true);
      await waitFor(() => jobOf('shift-missed-clockout', clockEventId), 'the 8h job');

      // The state a run leaves if it stops right after claiming the session.
      const db = await getDb();
      const closedAt = Date.now();
      await db.collection('clockevents').updateOne(
        { _id: new ObjectId(clockEventId) },
        { $set: { endTime: closedAt, accumulatedTime: PAST_8H_MS / 1000, autoClockoutPending: true } },
      );
      // A timer of a shift started since must be left running.
      const laterTimer = await db
        .collection('timers')
        .insertOne({ userId, startTime: closedAt + 60_000, endTime: null });

      
      await runJobNow('shift-missed-clockout', clockEventId);
      await waitFor(
        async () => !(await clockEvent(clockEventId))?.autoClockoutPending,
        'the clock-out to be finished',
      );
      const breaks = await db.collection('clockbreaks').find({ clockEventId }).toArray();
      expect(typeof breaks[0].endTime).toBe('number');
      expect((await db.collection('timers').findOne({ _id: laterTimer.insertedId }))?.endTime).toBeNull();
      await db.collection('timers').deleteOne({ _id: laterTimer.insertedId });
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
        async () => !(await jobOf('shift-missed-clockout', clockEventId)),
        'the 8h job to run and remove itself',
      );
      expect(await notificationsOf(clockEventId, 'auto-clock-out')).toHaveLength(0);
      expect(await adminClockOutNotices()).toHaveLength(0);
    },
    JOB_TIMEOUT,
  );
});
