/**
 * Sibling WorkItem rows — wormhole REST integration test.
 *
 * This pins the fact that drives the whole sync-state design. The M4/M5 spec
 * originally proposed hanging `redmineTimeEntryId` off the `WorkItem` row,
 * claiming a WorkItem is already exactly one per user + source + ticket + date.
 * It is not, and this test demonstrates the organic path that breaks it:
 *
 *   1. yesterday the ticket was worked with a note,
 *   2. today `timers.createEntry` opens a row for the same ticket with no note,
 *   3. `timers.copyPrevious` compares on a signature that includes the note
 *      (timers.js:508), sees no match, and inserts a *second* row for today.
 *
 * Two sibling rows would each carry their own remote entry id, so sync state
 * cannot live on WorkItems. It lives in `redmine_time_syncs`, one row per entry
 * created in Redmine, and the push sums every sibling's sessions for a
 * ticket-day before subtracting what earlier entries already covered (D5).
 *
 * The mechanic is source-agnostic (`sourceSelector` treats a missing `source` as
 * huddle), so this uses a Huddle ticket: creating a Redmine-sourced entry would
 * require a linked Redmine account, which no test account has.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { createUserAndGetJwt, wormhole, getDb, closeDb, purgeUser, ObjectId } from './helpers';

const USER = {
  name: 'Sync Grain User',
  email: 'wh-sync-grain-user@test.dev',
  password: 'Password1!',
};
const TEAM_CODE = 'WHSYNCGRAIN';

let jwt: string;
let userId: string;
let teamId: string;
let ticketId: string;

/** `YYYY-MM-DD`, `offsetDays` before today. */
const dateString = (offsetDays: number) => {
  const d = new Date();
  d.setDate(d.getDate() - offsetDays);
  return d.toISOString().split('T')[0];
};

beforeAll(async () => {
  await purgeUser(USER.email);
  const auth = await createUserAndGetJwt(USER);
  jwt = auth.jwt;

  const db = await getDb();
  userId = String((await db.collection('users').findOne({ 'emails.address': USER.email }))!._id);

  const teamDoc = {
    _id: new ObjectId(),
    name: 'WH Sync Grain Team',
    members: [userId],
    admins: [userId],
    code: TEAM_CODE,
    isPersonal: false,
    createdAt: new Date(),
  };
  await db.collection('teams').insertOne(teamDoc);
  teamId = teamDoc._id.toHexString();

  const ticketDoc = {
    _id: new ObjectId(),
    teamId,
    title: 'Sync Grain Ticket',
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
  await db.collection('teams').deleteMany({ code: TEAM_CODE });
  await db.collection('tickets').deleteMany({ teamId });
  await db.collection('workitems').deleteMany({ userId });
  await db.collection('timers').deleteMany({ userId });
  await purgeUser(USER.email);
  await closeDb();
});

describe('WorkItem grain (why redmine_time_syncs is its own collection)', () => {
  it('copyPrevious can leave two WorkItems for the same user + ticket + date', async () => {
    const yesterday = dateString(1);
    const today = dateString(0);
    const db = await getDb();

    // Yesterday's row carries a note. Seeded directly because createEntry would
    // also need a shift to exist; only the row's shape matters here.
    await db.collection('workitems').insertOne({
      _id: new ObjectId(),
      userId,
      source: 'huddle',
      ticketId,
      date: yesterday,
      note: 'Investigating',
      createdAt: new Date(),
    });

    // Today the user starts the same ticket with no note.
    const created = await wormhole(
      'timers.createEntry',
      { ticketId, date: today, startNow: false, notifyAdmins: false },
      jwt,
    );
    expect(created.ok).toBe(true);

    const copied = await wormhole<{ created: number }>(
      'timers.copyPrevious',
      { toDate: today },
      jwt,
    );
    expect(copied.ok).toBe(true);
    // The note makes the signatures differ, so the copy does not dedupe.
    expect(copied.result.created).toBe(1);

    const rows = await db.collection('workitems').find({ userId, ticketId, date: today }).toArray();

    // Same user, same ticket, same date — two rows, told apart only by the note.
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.note ?? null))).toEqual(new Set([null, 'Investigating']));
  });
});
