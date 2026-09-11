/**
 * Timesheet change approvals — wormhole REST integration tests.
 *
 * Covers the gate (who needs approval and who doesn't), what a submission must
 * carry, and the review lifecycle: nothing changes until an admin approves,
 * declining leaves the entry alone, and the requester is told either way.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  createUserAndGetJwt,
  wormhole,
  getDb,
  closeDb,
  purgeUser,
  ObjectId,
} from './helpers';

const ADMIN = { name: 'TS Admin', email: 'wh-tsa-admin@test.dev', password: 'Password1!' };
const MEMBER = { name: 'TS Member', email: 'wh-tsa-member@test.dev', password: 'Password1!' };

const TEAM_CODE = 'WHTSAP01';
const SOLO_CODE = 'WHTSAP02';

const HOUR = 3_600_000;
const JUSTIFICATION = {
  description: 'Forgot to clock out after the deploy call ran late.',
  videoUrl: '/pulsevault/artifacts/test-video',
};

let adminJwt: string;
let memberJwt: string;
let adminUserId: string;
let memberUserId: string;
let teamId: string;
let soloTeamId: string;

/** A completed clock session for the member, inserted straight into Mongo. */
async function seedSession(onTeamId: string, userId: string) {
  const db = await getDb();
  const start = Date.now() - 4 * HOUR;
  const end = start + 2 * HOUR;
  const doc = {
    _id: new ObjectId(),
    userId,
    teamId: onTeamId,
    startTime: start,
    endTime: end,
    accumulatedTime: Math.floor((end - start) / 1000),
  };
  await db.collection('clockevents').insertOne(doc);
  return { id: doc._id.toHexString(), start, end };
}

async function findSession(id: string) {
  const db = await getDb();
  return db.collection('clockevents').findOne({ _id: new ObjectId(id) });
}

beforeAll(async () => {
  await purgeUser(ADMIN.email);
  await purgeUser(MEMBER.email);
  adminJwt = (await createUserAndGetJwt(ADMIN)).jwt;
  memberJwt = (await createUserAndGetJwt(MEMBER)).jwt;

  const db = await getDb();
  adminUserId = String(
    (await db.collection('users').findOne({ 'emails.address': ADMIN.email }))!._id,
  );
  memberUserId = String(
    (await db.collection('users').findOne({ 'emails.address': MEMBER.email }))!._id,
  );

  const reviewed = {
    _id: new ObjectId(),
    name: 'WH Approval Team',
    members: [adminUserId, memberUserId],
    admins: [adminUserId],
    code: TEAM_CODE,
    isPersonal: false,
    createdAt: new Date(),
  };
  // The member is the only admin here, so there is nobody to review their edits.
  const solo = {
    _id: new ObjectId(),
    name: 'WH Solo Team',
    members: [memberUserId],
    admins: [memberUserId],
    code: SOLO_CODE,
    isPersonal: false,
    createdAt: new Date(),
  };
  await db.collection('teams').insertMany([reviewed, solo]);
  teamId = reviewed._id.toHexString();
  soloTeamId = solo._id.toHexString();
});

// Each test seeds its own session and expects an empty queue, so state from a
// previous test must not leak into the next one.
beforeEach(async () => {
  const db = await getDb();
  await db.collection('timesheetchangerequests').deleteMany({ userId: memberUserId });
  await db.collection('clockevents').deleteMany({ userId: memberUserId });
  await db
    .collection('notifications')
    .deleteMany({ userId: { $in: [adminUserId, memberUserId] } });
});

afterAll(async () => {
  const db = await getDb();
  await db.collection('teams').deleteMany({ code: { $in: [TEAM_CODE, SOLO_CODE] } });
  await db.collection('clockevents').deleteMany({ userId: memberUserId });
  await db.collection('timesheetchangerequests').deleteMany({ userId: memberUserId });
  await purgeUser(ADMIN.email);
  await purgeUser(MEMBER.email);
  await closeDb();
});

describe('timesheet approvals — the gate', () => {
  it('applies the edit directly when the editor is the only admin', async () => {
    const session = await seedSession(soloTeamId, memberUserId);
    const res = await wormhole('clock.updateTimes', {
      clockEventId: session.id,
      startTime: session.start + HOUR,
    }, memberJwt);

    expect(res.ok).toBe(true);
    expect((res.result as { pending?: boolean }).pending).toBeUndefined();
    expect((await findSession(session.id))!.startTime).toBe(session.start + HOUR);
  });

  it('queues the edit for review on a team with another admin', async () => {
    const session = await seedSession(teamId, memberUserId);
    const res = await wormhole<{ pending: boolean; request: { status: string } }>(
      'clock.updateTimes',
      { clockEventId: session.id, startTime: session.start + HOUR, ...JUSTIFICATION },
      memberJwt,
    );

    expect(res.ok).toBe(true);
    expect(res.result.pending).toBe(true);
    expect(res.result.request.status).toBe('pending');
    // Crucially, the session itself is untouched until someone approves.
    expect((await findSession(session.id))!.startTime).toBe(session.start);
  });

  it('notifies the reviewing admin, not the requester', async () => {
    const session = await seedSession(teamId, memberUserId);
    await wormhole(
      'clock.updateTimes',
      { clockEventId: session.id, startTime: session.start + HOUR, ...JUSTIFICATION },
      memberJwt,
    );

    const db = await getDb();
    const notifications = await db
      .collection('notifications')
      .find({ 'data.type': 'timesheet-change-request' })
      .toArray();
    expect(notifications).toHaveLength(1);
    expect(notifications[0].userId).toBe(adminUserId);
  });
});

describe('timesheet approvals — what a submission must carry', () => {
  it('rejects a change with no explanation', async () => {
    const session = await seedSession(teamId, memberUserId);
    const res = await wormhole(
      'clock.updateTimes',
      { clockEventId: session.id, startTime: session.start + HOUR, videoUrl: JUSTIFICATION.videoUrl },
      memberJwt,
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/describ|explain|10 characters/i);
  });

  it('rejects a time change with no video', async () => {
    const session = await seedSession(teamId, memberUserId);
    const res = await wormhole(
      'clock.updateTimes',
      {
        clockEventId: session.id,
        startTime: session.start + HOUR,
        description: JUSTIFICATION.description,
      },
      memberJwt,
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/video/i);
  });

  it('accepts a delete with an explanation and no video', async () => {
    const session = await seedSession(teamId, memberUserId);
    const res = await wormhole<{ pending: boolean }>(
      'clock.deleteEvent',
      { clockEventId: session.id, description: JUSTIFICATION.description },
      memberJwt,
    );
    expect(res.ok).toBe(true);
    expect(res.result.pending).toBe(true);
    expect(await findSession(session.id)).not.toBeNull();
  });

  it('refuses a second pending request against the same entry', async () => {
    const session = await seedSession(teamId, memberUserId);
    const payload = {
      clockEventId: session.id,
      startTime: session.start + HOUR,
      ...JUSTIFICATION,
    };
    expect((await wormhole('clock.updateTimes', payload, memberJwt)).ok).toBe(true);

    const second = await wormhole('clock.updateTimes', payload, memberJwt);
    expect(second.ok).toBe(false);
    expect(second.error).toMatch(/already/i);
  });
});

describe('timesheet approvals — review', () => {
  async function submitEdit() {
    const session = await seedSession(teamId, memberUserId);
    const res = await wormhole<{ request: { id: string } }>(
      'clock.updateTimes',
      { clockEventId: session.id, startTime: session.start + HOUR, ...JUSTIFICATION },
      memberJwt,
    );
    return { session, requestId: res.result.request.id };
  }

  it('applies the change once an admin approves', async () => {
    const { session, requestId } = await submitEdit();

    const res = await wormhole('timesheetApprovals.approve', { requestId }, adminJwt);
    expect(res.ok).toBe(true);
    expect((await findSession(session.id))!.startTime).toBe(session.start + HOUR);
  });

  it('leaves the entry alone when declined, and records the reason', async () => {
    const { session, requestId } = await submitEdit();

    const res = await wormhole<{ status: string; responseNote: string }>(
      'timesheetApprovals.reject',
      { requestId, note: 'Your shift ended at the original time.' },
      adminJwt,
    );
    expect(res.ok).toBe(true);
    expect(res.result.status).toBe('rejected');
    expect(res.result.responseNote).toMatch(/original time/);
    expect((await findSession(session.id))!.startTime).toBe(session.start);
  });

  it('requires a reason to decline', async () => {
    const { requestId } = await submitEdit();
    const res = await wormhole('timesheetApprovals.reject', { requestId }, adminJwt);
    expect(res.ok).toBe(false);
  });

  it('will not let the requester approve their own change', async () => {
    const { requestId } = await submitEdit();
    const res = await wormhole('timesheetApprovals.approve', { requestId }, memberJwt);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/your own|forbidden|admin/i);
  });

  it('tells the requester the outcome', async () => {
    const { requestId } = await submitEdit();
    await wormhole('timesheetApprovals.approve', { requestId }, adminJwt);

    const db = await getDb();
    const notification = await db
      .collection('notifications')
      .findOne({ userId: memberUserId, 'data.type': 'timesheet-change-approved' });
    expect(notification).not.toBeNull();
  });

  it('clears the reviewer prompt once a decision is made', async () => {
    const { requestId } = await submitEdit();
    await wormhole('timesheetApprovals.approve', { requestId }, adminJwt);

    const db = await getDb();
    const remaining = await db
      .collection('notifications')
      .countDocuments({ 'data.type': 'timesheet-change-request', 'data.requestId': requestId });
    expect(remaining).toBe(0);
  });

  it('cannot be reviewed twice', async () => {
    const { requestId } = await submitEdit();
    await wormhole('timesheetApprovals.approve', { requestId }, adminJwt);

    const second = await wormhole('timesheetApprovals.approve', { requestId }, adminJwt);
    expect(second.ok).toBe(false);
    expect(second.error).toMatch(/already/i);
  });

  it('stays pending when the entry it targets has since been removed', async () => {
    const { session, requestId } = await submitEdit();
    const db = await getDb();
    await db.collection('clockevents').deleteOne({ _id: new ObjectId(session.id) });

    const res = await wormhole('timesheetApprovals.approve', { requestId }, adminJwt);
    expect(res.ok).toBe(false);
    const request = await db
      .collection('timesheetchangerequests')
      .findOne({ _id: new ObjectId(requestId) });
    expect(request!.status).toBe('pending');
  });
});

describe('timesheet approvals — listings', () => {
  it('shows the requester their own pending request', async () => {
    const session = await seedSession(teamId, memberUserId);
    await wormhole(
      'clock.updateTimes',
      { clockEventId: session.id, startTime: session.start + HOUR, ...JUSTIFICATION },
      memberJwt,
    );

    const res = await wormhole<{ requests: Array<{ targetId: string }> }>(
      'timesheetApprovals.listMine',
      {},
      memberJwt,
    );
    expect(res.ok).toBe(true);
    expect(res.result.requests.some((r) => r.targetId === session.id)).toBe(true);
  });

  it('shows the admin the queue, and the requester nothing to review', async () => {
    const session = await seedSession(teamId, memberUserId);
    await wormhole(
      'clock.updateTimes',
      { clockEventId: session.id, startTime: session.start + HOUR, ...JUSTIFICATION },
      memberJwt,
    );

    const forAdmin = await wormhole<{ requests: unknown[] }>(
      'timesheetApprovals.listPending',
      { teamId },
      adminJwt,
    );
    expect(forAdmin.result.requests).toHaveLength(1);

    const forMember = await wormhole<{ requests: unknown[] }>(
      'timesheetApprovals.listPending',
      { teamId },
      memberJwt,
    );
    expect(forMember.result.requests).toHaveLength(0);
  });

  it('lets the requester withdraw a request nobody has ruled on', async () => {
    const session = await seedSession(teamId, memberUserId);
    const submitted = await wormhole<{ request: { id: string } }>(
      'clock.updateTimes',
      { clockEventId: session.id, startTime: session.start + HOUR, ...JUSTIFICATION },
      memberJwt,
    );

    const res = await wormhole(
      'timesheetApprovals.cancel',
      { requestId: submitted.result.request.id },
      memberJwt,
    );
    expect(res.ok).toBe(true);

    const mine = await wormhole<{ requests: unknown[] }>(
      'timesheetApprovals.listMine',
      {},
      memberJwt,
    );
    expect(mine.result.requests).toHaveLength(0);
  });
});
