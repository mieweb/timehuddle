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
const VIDEO_ID = 'wh-tsa-test-video';
const JUSTIFICATION = {
  description: 'Forgot to clock out after the deploy call ran late.',
  videoUrl: `/pulsevault/artifacts/${VIDEO_ID}`,
};

let adminJwt: string;
let memberJwt: string;
let adminUserId: string;
let memberUserId: string;
let teamId: string;
let soloTeamId: string;
let ticketId: string;
let soloTicketId: string;

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

/** A work item with one hour already logged against it. */
async function seedWorkItem(onTicketId: string, userId: string) {
  const db = await getDb();
  const date = new Date().toISOString().slice(0, 10);
  const item = {
    _id: new ObjectId(),
    userId,
    ticketId: onTicketId,
    date,
    note: 'Original note',
    createdAt: new Date(),
  };
  await db.collection('workitems').insertOne(item);
  const workItemId = item._id.toHexString();
  await db.collection('timers').insertOne({
    _id: new ObjectId(),
    workItemId,
    userId,
    date,
    startTime: Date.now() - 2 * HOUR,
    endTime: Date.now() - HOUR,
    durationSeconds: 3600,
    createdAt: new Date(),
  });
  return { id: workItemId, date };
}

async function loggedSeconds(workItemId: string) {
  const db = await getDb();
  const sessions = await db
    .collection('timers')
    .find({ workItemId, endTime: { $ne: null } })
    .toArray();
  return sessions.reduce((sum, s) => sum + (s.durationSeconds ?? 0), 0);
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

  const ticket = (onTeamId: string, title: string) => ({
    _id: new ObjectId(),
    teamId: onTeamId,
    title,
    status: 'open',
    priority: 'medium',
    createdBy: memberUserId,
    assignedTo: memberUserId,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const reviewedTicket = ticket(teamId, 'Reviewed Ticket');
  const soloTicket = ticket(soloTeamId, 'Solo Ticket');
  await db.collection('tickets').insertMany([reviewedTicket, soloTicket]);
  ticketId = reviewedTicket._id.toHexString();
  soloTicketId = soloTicket._id.toHexString();

  // The server only accepts a video it can trace back to the requester, so the
  // evidence these tests cite has to actually be theirs.
  await db.collection('mediaitems').insertOne({
    _id: new ObjectId(),
    userId: memberUserId,
    type: 'video',
    videoid: VIDEO_ID,
    url: JUSTIFICATION.videoUrl,
    uploadedAt: new Date(),
  });
});

// Each test seeds its own session and expects an empty queue, so state from a
// previous test must not leak into the next one.
beforeEach(async () => {
  const db = await getDb();
  await db.collection('timesheetchangerequests').deleteMany({ userId: memberUserId });
  await db.collection('clockevents').deleteMany({ userId: memberUserId });
  await db.collection('workitems').deleteMany({ userId: memberUserId });
  await db.collection('timers').deleteMany({ userId: memberUserId });
  await db
    .collection('notifications')
    .deleteMany({ userId: { $in: [adminUserId, memberUserId] } });
});

afterAll(async () => {
  const db = await getDb();
  await db.collection('teams').deleteMany({ code: { $in: [TEAM_CODE, SOLO_CODE] } });
  await db.collection('tickets').deleteMany({ teamId: { $in: [teamId, soloTeamId] } });
  await db.collection('clockevents').deleteMany({ userId: memberUserId });
  await db.collection('workitems').deleteMany({ userId: memberUserId });
  await db.collection('timers').deleteMany({ userId: memberUserId });
  await db.collection('mediaitems').deleteMany({ videoid: VIDEO_ID });
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

  it('accepts an edit with an explanation and no video — only a new entry needs one', async () => {
    const session = await seedSession(teamId, memberUserId);
    const res = await wormhole<{ pending: boolean }>(
      'clock.updateTimes',
      {
        clockEventId: session.id,
        startTime: session.start + HOUR,
        description: JUSTIFICATION.description,
      },
      memberJwt,
    );
    expect(res.ok).toBe(true);
    expect(res.result.pending).toBe(true);
  });

  it('rejects a brand-new entry with no video', async () => {
    const res = await wormhole(
      'clock.createManual',
      {
        teamId,
        startTime: Date.now() - 4 * HOUR,
        endTime: Date.now() - 2 * HOUR,
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

  it('refuses a video that is not a recording made here', async () => {
    const session = await seedSession(teamId, memberUserId);
    const res = await wormhole(
      'clock.updateTimes',
      {
        clockEventId: session.id,
        startTime: session.start + HOUR,
        description: JUSTIFICATION.description,
        videoUrl: 'https://attacker.example/evidence.mp4',
      },
      memberJwt,
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/video/i);
  });

  it('refuses a video belonging to somebody else', async () => {
    const session = await seedSession(teamId, memberUserId);
    const res = await wormhole(
      'clock.updateTimes',
      {
        clockEventId: session.id,
        startTime: session.start + HOUR,
        description: JUSTIFICATION.description,
        videoUrl: '/pulsevault/artifacts/somebody-elses-clip',
      },
      memberJwt,
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/video/i);
  });

  it('refuses an edit whose end lands before its start', async () => {
    // Queueing it would put a change in front of a reviewer that no approval
    // could apply.
    const session = await seedSession(teamId, memberUserId);
    const res = await wormhole(
      'clock.updateTimes',
      { clockEventId: session.id, endTime: session.start - HOUR, ...JUSTIFICATION },
      memberJwt,
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/before start/i);
  });

  it('refuses a new entry that overlaps one already on the timesheet', async () => {
    // Queueing it would put a change in front of a reviewer that could never
    // be applied however they ruled.
    const session = await seedSession(teamId, memberUserId);
    const res = await wormhole(
      'clock.createManual',
      {
        teamId,
        startTime: session.start + HOUR,
        endTime: session.end - HOUR / 2,
        ...JUSTIFICATION,
      },
      memberJwt,
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/overlap/i);
  });
});

describe('timesheet approvals — leaving the team is not a way out', () => {
  it('still requires approval to edit a session in a team the editor has left', async () => {
    const session = await seedSession(teamId, memberUserId);
    const db = await getDb();
    await db
      .collection('teams')
      .updateOne({ code: TEAM_CODE }, { $pull: { members: memberUserId } as never });

    try {
      const res = await wormhole<{ pending: boolean }>(
        'clock.updateTimes',
        { clockEventId: session.id, startTime: session.start + HOUR, ...JUSTIFICATION },
        memberJwt,
      );
      expect(res.ok).toBe(true);
      expect(res.result.pending).toBe(true);
      expect((await findSession(session.id))!.startTime).toBe(session.start);
    } finally {
      await db
        .collection('teams')
        .updateOne({ code: TEAM_CODE }, { $addToSet: { members: memberUserId } as never });
    }
  });
});

describe('timesheet approvals — timer entries', () => {
  it('lets a relabel through without review', async () => {
    const entry = await seedWorkItem(ticketId, memberUserId);
    const res = await wormhole<{ entry: { note: string } }>(
      'timers.updateEntry',
      { entryId: entry.id, note: 'Tidied up the wording' },
      memberJwt,
    );
    expect(res.ok).toBe(true);
    expect(res.result.entry.note).toBe('Tidied up the wording');
  });

  it('queues a duration change and applies it on approval', async () => {
    const entry = await seedWorkItem(ticketId, memberUserId);
    const submitted = await wormhole<{ pending: boolean; request: { id: string } }>(
      'timers.updateEntry',
      { entryId: entry.id, durationSeconds: 7200, ...JUSTIFICATION },
      memberJwt,
    );
    expect(submitted.ok).toBe(true);
    expect(submitted.result.pending).toBe(true);
    expect(await loggedSeconds(entry.id)).toBe(3600);

    const decided = await wormhole(
      'timesheetApprovals.approve',
      { requestId: submitted.result.request.id },
      adminJwt,
    );
    expect(decided.ok).toBe(true);
    expect(await loggedSeconds(entry.id)).toBe(7200);
  });

  it('queues a delete and only removes the entry once approved', async () => {
    const entry = await seedWorkItem(ticketId, memberUserId);
    const submitted = await wormhole<{ pending: boolean; request: { id: string } }>(
      'timers.deleteEntry',
      { entryId: entry.id, ...JUSTIFICATION },
      memberJwt,
    );
    expect(submitted.ok).toBe(true);
    const db = await getDb();
    expect(await db.collection('workitems').countDocuments({ _id: new ObjectId(entry.id) })).toBe(
      1,
    );

    await wormhole(
      'timesheetApprovals.approve',
      { requestId: submitted.result.request.id },
      adminJwt,
    );
    expect(await db.collection('workitems').countDocuments({ _id: new ObjectId(entry.id) })).toBe(
      0,
    );
  });

  it('applies a solo-admin team\u2019s duration change directly', async () => {
    const entry = await seedWorkItem(soloTicketId, memberUserId);
    const res = await wormhole<{ pending?: boolean }>(
      'timers.updateEntry',
      { entryId: entry.id, durationSeconds: 7200 },
      memberJwt,
    );
    expect(res.ok).toBe(true);
    expect(res.result.pending).toBeUndefined();
    expect(await loggedSeconds(entry.id)).toBe(7200);
  });

  it('reviews a move out of a solo-admin team into a reviewed one, and applies it', async () => {
    // The time lands on the destination team's timesheet, so gating on the
    // source alone would make the solo team a staging area. The destination is
    // what gets recorded as the reviewing team, so replay must not expect the
    // entry to already be there.
    const entry = await seedWorkItem(soloTicketId, memberUserId);
    const submitted = await wormhole<{ pending: boolean; request: { id: string } }>(
      'timers.updateEntry',
      { entryId: entry.id, durationSeconds: 7200, ticketId, ...JUSTIFICATION },
      memberJwt,
    );
    expect(submitted.ok).toBe(true);
    expect(submitted.result.pending).toBe(true);
    expect(await loggedSeconds(entry.id)).toBe(3600);

    const decided = await wormhole(
      'timesheetApprovals.approve',
      { requestId: submitted.result.request.id },
      adminJwt,
    );
    expect(decided.ok).toBe(true);
    expect(await loggedSeconds(entry.id)).toBe(7200);

    const db = await getDb();
    const moved = await db.collection('workitems').findOne({ _id: new ObjectId(entry.id) });
    expect(moved!.ticketId).toBe(ticketId);
  });

  it('refuses to replay over an edit made while the request was pending', async () => {
    const entry = await seedWorkItem(ticketId, memberUserId);
    const submitted = await wormhole<{ request: { id: string } }>(
      'timers.updateEntry',
      { entryId: entry.id, durationSeconds: 7200, ...JUSTIFICATION },
      memberJwt,
    );
    // Relabelling stays direct, so this lands while the duration change waits.
    await wormhole('timers.updateEntry', { entryId: entry.id, note: 'Newer note' }, memberJwt);

    const decided = await wormhole(
      'timesheetApprovals.approve',
      { requestId: submitted.result.request.id },
      adminJwt,
    );
    expect(decided.ok).toBe(false);
    expect(decided.error).toMatch(/edited|again/i);

    const db = await getDb();
    const entryDoc = await db.collection('workitems').findOne({ _id: new ObjectId(entry.id) });
    expect(entryDoc!.note).toBe('Newer note');
    const request = await db
      .collection('timesheetchangerequests')
      .findOne({ _id: new ObjectId(submitted.result.request.id) });
    expect(request!.status).toBe('pending');
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
