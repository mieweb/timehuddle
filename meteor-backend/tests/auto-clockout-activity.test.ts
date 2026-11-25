/**
 * Auto clock-out activity (#897) — an 8h auto clock-out shows in the user's
 * activity feed, labelled `auto`, just as a manual clock-out does.
 *
 * Needs a backend with METEOR_AGENDA_ENABLED=true (the default for npm start):
 * the test makes the job due now instead of waiting 8 hours.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createUserAndGetJwt, wormhole, getDb, closeDb, purgeUser, ObjectId } from './helpers';

const USER = { name: 'Auto Out User', email: 'wh-auto-out@test.dev', password: 'Password1!' };
const TEAM = { name: 'WH Auto Out Team', code: 'WHAUTO97' };
const PAST_8H_MS = 8 * 3600_000 + 60_000;

let jwt: string;
let userId: string;
let teamId: string;


async function waitFor<T>(check: () => Promise<T>, what: string, timeoutMs = 45_000): Promise<T> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const value = await check();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

/** The user's clock.out activities, once there is at least one. */
function waitForClockOut() {
  return waitFor(async () => {
    const db = await getDb();
    const found = await db.collection('activities').find({ userId, type: 'clock.out' }).toArray();
    return found.length ? found : null;
  }, 'the clock.out activity');
}

beforeAll(async () => {
  await purgeUser(USER.email);
  jwt = (await createUserAndGetJwt(USER)).jwt;
  const db = await getDb();
  userId = String((await db.collection('users').findOne({ 'emails.address': USER.email }))!._id);
  const { insertedId } = await db.collection('teams').insertOne({
    ...TEAM,
    members: [userId],
    admins: [],
    isPersonal: false,
    settings: { requirePlanForClock: false },
    createdAt: new Date(),
  });
  teamId = insertedId.toHexString();
});

afterAll(async () => {
  const db = await getDb();
  await db.collection('agendajobs').deleteMany({ 'data.userId': userId });
  await db.collection('activities').deleteMany({ userId });
  await db.collection('notifications').deleteMany({ userId });
  await db.collection('clockevents').deleteMany({ teamId });
  await db.collection('teams').deleteMany({ code: TEAM.code });
  await purgeUser(USER.email);
  await closeDb();
});

describe('clock.out activity', () => {
  it('is recorded once, marked auto, when the 8h job clocks the user out', async () => {
    const start = await wormhole<{ id: string }>('clock.start', { teamId }, jwt);
    expect(start.ok).toBe(true);
    const clockEventId = start.result.id;
    const db = await getDb();
    await db
      .collection('clockevents')
      .updateOne({ _id: new ObjectId(clockEventId) }, { $set: { startTime: Date.now() - PAST_8H_MS } });

    expect((await wormhole('clock.agreeAutoClockout', { clockEventId }, jwt)).ok).toBe(true);
    const job = { name: 'shift-auto-clockout', 'data.clockEventId': clockEventId };
    await waitFor(() => db.collection('agendajobs').findOne(job), 'the 8h job to be scheduled');
    await db.collection('agendajobs').updateOne(job, { $set: { nextRunAt: new Date(), lockedAt: null } });

    const [activity, ...extra] = await waitForClockOut();
    expect(extra).toHaveLength(0);
    expect(activity.teamId).toBe(teamId);
    expect(activity.payload).toMatchObject({ teamId, teamName: TEAM.name, auto: true });
    expect(activity.payload.durationSeconds).toBeGreaterThanOrEqual(8 * 3600);
  });

  it('is not marked auto for a manual clock-out', async () => {
    const db = await getDb();
    await db.collection('activities').deleteMany({ userId });
    expect((await wormhole('clock.start', { teamId }, jwt)).ok).toBe(true);
    expect((await wormhole('clock.stop', { teamId }, jwt)).ok).toBe(true);

    const [activity] = await waitForClockOut();
    expect(activity.payload.teamName).toBe(TEAM.name);
    expect(activity.payload.auto).toBeUndefined();
  });
});
