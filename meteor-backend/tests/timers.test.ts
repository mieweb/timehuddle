/**
 * Timers — wormhole REST integration tests.
 *
 * Fixture: USER in a team with a ticket. Tests timer start/stop and work item deduplication.
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
  userId = String((await db.collection('user').findOne({ email: USER.email }))!._id);

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
});

afterAll(async () => {
  const db = await getDb();
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
});
