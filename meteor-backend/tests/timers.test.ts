/**
 * Timers — wormhole REST integration tests.
 *
 * Fixture: USER in a team with a ticket, clocked in for the whole file. The
 * clock-in is not incidental: since M3 a ticket timer may only start while a
 * shift is running, so every `startNow: true` below depends on it. The gate
 * itself is asserted in "requires an active shift".
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

const USER = { name: 'Timer User', email: 'wh-timer-user@test.dev', password: 'Password1!' };

let jwt: string;
let userId: string;
let teamId: string;
let ticketId: string;

beforeAll(async () => {
  await purgeUser(USER.email);
  const auth = await createUserAndGetJwt(USER);
  jwt = auth.jwt;

  const db = await getDb();
  userId = String((await db.collection('users').findOne({ 'emails.address': USER.email }))!._id);

  // Create team
  const teamDoc = {
    _id: new ObjectId(),
    name: 'WH Timer Team',
    members: [userId],
    admins: [userId],
    code: 'WHTIMER',
    isPersonal: false,
    createdAt: new Date(),
  };
  await db.collection('teams').insertOne(teamDoc);
  teamId = teamDoc._id.toHexString();

  // Create ticket
  const ticketDoc = {
    _id: new ObjectId(),
    teamId,
    title: 'Timer Test Ticket',
    status: 'open',
    priority: 'medium',
    createdBy: userId,
    assignedTo: userId,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  await db.collection('tickets').insertOne(ticketDoc);
  ticketId = ticketDoc._id.toHexString();

  const clockIn = await wormhole('clock.start', { teamId }, jwt);
  expect(clockIn.ok).toBe(true);
});

afterAll(async () => {
  await wormhole('clock.stop', { teamId }, jwt);
  const db = await getDb();
  await db.collection('clockevents').deleteMany({ userId });
  await db.collection('teams').deleteMany({ code: 'WHTIMER' });
  await db.collection('tickets').deleteMany({ teamId });
  await db.collection('workitems').deleteMany({ userId });
  await db.collection('timers').deleteMany({ userId });
  await purgeUser(USER.email);
  await closeDb();
});

describe('timers (wormhole)', () => {
  it('creates a work item when starting timer for the first time', async () => {
    const today = new Date().toISOString().split('T')[0];
    
    const res = await wormhole<{ entry: { id: string }; session: { id: string } | null }>(
      'timers.createEntry',
      {
        ticketId,
        date: today,
        startNow: true,
        notifyAdmins: false,
      },
      jwt
    );

    expect(res.ok).toBe(true);
    expect(res.result.entry).toBeDefined();
    expect(res.result.entry.id).toBeDefined();
    expect(res.result.session).toBeDefined();
    expect(res.result.session?.id).toBeDefined();

    // Verify work item exists in database
    const db = await getDb();
    const workItems = await db
      .collection('workitems')
      .find({ userId, ticketId, date: today })
      .toArray();
    expect(workItems).toHaveLength(1);

    // Verify timer session exists
    const sessions = await db
      .collection('timers')
      .find({ userId, workItemId: res.result.entry.id })
      .toArray();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].endTime).toBeNull();
  });

  it('reuses existing work item when starting timer multiple times (no duplicates)', async () => {
    const today = new Date().toISOString().split('T')[0];
    const db = await getDb();

    // Get count of work items before
    const beforeCount = await db.collection('workitems').countDocuments({
      userId,
      ticketId,
      date: today,
    });

    // Start timer (this should reuse the existing work item)
    const res1 = await wormhole<{ entry: { id: string }; session: { id: string } | null }>(
      'timers.createEntry',
      {
        ticketId,
        date: today,
        startNow: true,
        notifyAdmins: false,
      },
      jwt
    );
    expect(res1.ok).toBe(true);
    const entryId1 = res1.result.entry.id;

    // Stop the timer
    if (res1.result.session?.id) {
      await wormhole('timers.stopSession', { sessionId: res1.result.session.id }, jwt);
    }

    // Start timer again (should reuse the same work item)
    const res2 = await wormhole<{ entry: { id: string }; session: { id: string } | null }>(
      'timers.createEntry',
      {
        ticketId,
        date: today,
        startNow: true,
        notifyAdmins: false,
      },
      jwt
    );
    expect(res2.ok).toBe(true);
    const entryId2 = res2.result.entry.id;

    // Stop the timer
    if (res2.result.session?.id) {
      await wormhole('timers.stopSession', { sessionId: res2.result.session.id }, jwt);
    }

    // Start timer a third time (should still reuse the same work item)
    const res3 = await wormhole<{ entry: { id: string }; session: { id: string } | null }>(
      'timers.createEntry',
      {
        ticketId,
        date: today,
        startNow: true,
        notifyAdmins: false,
      },
      jwt
    );
    expect(res3.ok).toBe(true);
    const entryId3 = res3.result.entry.id;

    // All three calls should return the SAME work item ID
    expect(entryId1).toBe(entryId2);
    expect(entryId2).toBe(entryId3);

    // Verify still only ONE work item exists for this ticket+date
    const afterCount = await db.collection('workitems').countDocuments({
      userId,
      ticketId,
      date: today,
    });
    expect(afterCount).toBe(beforeCount); // No new work items created

    // Verify multiple timer sessions were created for the same work item
    const sessions = await db
      .collection('timers')
      .find({ userId, workItemId: entryId1 })
      .toArray();
    expect(sessions.length).toBeGreaterThanOrEqual(3); // At least 3 timer sessions
  });

  it('creates separate work items for different dates', async () => {
    const db = await getDb();
    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    // Create work item for yesterday (without starting timer to avoid date validation error)
    const res1 = await wormhole<{ entry: { id: string } }>(
      'timers.createEntry',
      {
        ticketId,
        date: yesterday,
        startNow: false,
        notifyAdmins: false,
      },
      jwt
    );
    expect(res1.ok).toBe(true);

    // Create work item for today
    const res2 = await wormhole<{ entry: { id: string } }>(
      'timers.createEntry',
      {
        ticketId,
        date: today,
        startNow: false,
        notifyAdmins: false,
      },
      jwt
    );
    expect(res2.ok).toBe(true);

    // Should have different entry IDs
    expect(res1.result.entry.id).not.toBe(res2.result.entry.id);

    // Verify two separate work items exist
    const workItems = await db
      .collection('workitems')
      .find({ userId, ticketId })
      .toArray();
    const dates = workItems.map((w) => w.date).sort();
    expect(dates).toContain(yesterday);
    expect(dates).toContain(today);
  });

  it('updates note on existing work item when provided', async () => {
    const db = await getDb();
    const today = new Date().toISOString().split('T')[0];
    const testNote = 'Updated timer note';

    // Get existing work item (should exist from previous tests)
    const existing = await db.collection('workitems').findOne({ userId, ticketId, date: today });
    expect(existing).toBeDefined();

    // Create entry with note (should update existing work item)
    const res = await wormhole<{ entry: { id: string; note?: string } }>(
      'timers.createEntry',
      {
        ticketId,
        date: today,
        note: testNote,
        startNow: false,
        notifyAdmins: false,
      },
      jwt
    );
    expect(res.ok).toBe(true);

    // Verify the work item was updated, not duplicated
    const workItems = await db
      .collection('workitems')
      .find({ userId, ticketId, date: today })
      .toArray();
    expect(workItems).toHaveLength(1);
    expect(workItems[0].note).toBe(testNote);
  });

  it('stamps the running shift on each session and tags the entry as Huddle-sourced', async () => {
    const db = await getDb();
    const today = new Date().toISOString().split('T')[0];

    const shift = await db.collection('clockevents').findOne({ userId, endTime: null });
    expect(shift).not.toBeNull();

    const res = await wormhole<{
      entry: { id: string; source: string; displayTitle: string | null };
      session: { id: string; clockEventId: string | null } | null;
    }>('timers.createEntry', { ticketId, date: today, startNow: true, notifyAdmins: false }, jwt);

    expect(res.ok).toBe(true);
    expect(res.result.entry.source).toBe('huddle');
    expect(res.result.entry.displayTitle).toBe('Timer Test Ticket');
    expect(res.result.session?.clockEventId).toBe(String(shift!._id));

    await wormhole('timers.stopSession', { sessionId: res.result.session!.id }, jwt);
  });

  it('keeps a Redmine issue id in its own namespace, separate from a Huddle ticket', async () => {
    const db = await getDb();
    const today = new Date().toISOString().split('T')[0];

    // Unlinked account, so the source-aware path stops at the Redmine
    // connection check — which already proves the id did not fall through to
    // the Huddle `Tickets` lookup that would have 404'd on a numeric id.
    const res = await wormhole('timers.createEntry', {
      ticketId: '424242',
      source: 'redmine',
      date: today,
      startNow: false,
      notifyAdmins: false,
    }, jwt);

    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Redmine/i);

    const created = await db.collection('workitems').findOne({ userId, ticketId: '424242' });
    expect(created).toBeNull();
  });

  it('requires an active shift to start a timer', async () => {
    const today = new Date().toISOString().split('T')[0];
    const clockOut = await wormhole('clock.stop', { teamId }, jwt);
    expect(clockOut.ok).toBe(true);

    try {
      const res = await wormhole('timers.createEntry', {
        ticketId,
        date: today,
        startNow: true,
        notifyAdmins: false,
      }, jwt);
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/Clock in to start a ticket timer/i);

      // The WorkItem itself is still fine to create — only the session is gated.
      const entryOnly = await wormhole('timers.createEntry', {
        ticketId,
        date: today,
        startNow: false,
        notifyAdmins: false,
      }, jwt);
      expect(entryOnly.ok).toBe(true);
    } finally {
      await wormhole('clock.start', { teamId }, jwt);
    }
  });

  it('totals only the caller’s own time on a ticket', async () => {
    const db = await getDb();
    const sharedTicketId = new ObjectId().toHexString();
    const otherUserId = 'wh-timer-other-user';
    const date = new Date().toISOString().split('T')[0];

    const insertClosedSession = async (ownerId: string, durationSeconds: number) => {
      const workItemId = new ObjectId();
      await db.collection('workitems').insertOne({
        _id: workItemId,
        userId: ownerId,
        ticketId: sharedTicketId,
        source: 'huddle',
        date,
      });
      await db.collection('timers').insertOne({
        userId: ownerId,
        workItemId: workItemId.toHexString(),
        startTime: new Date(Date.now() - durationSeconds * 1000),
        endTime: new Date(),
        durationSeconds,
      });
    };

    try {
      await insertClosedSession(userId, 120);
      await insertClosedSession(otherUserId, 3600);

      const res = await wormhole<{ totalSeconds: number }>(
        'timers.getTicketTotal',
        { ticketId: sharedTicketId },
        jwt,
      );
      expect(res.ok).toBe(true);
      expect(res.result.totalSeconds).toBe(120);
    } finally {
      await db.collection('workitems').deleteMany({ userId: otherUserId });
      await db.collection('timers').deleteMany({ userId: otherUserId });
    }
  });
});
