#!/usr/bin/env node
/**
 * Read-only report for #436 — finds ticket timer sessions stuck open
 * (`timers.endTime === null`) that were orphaned by the auto-clockout bug
 * (fixed in server/clock-core.js: stopActiveClock now closes running timers,
 * same as manual clock.stop always did).
 *
 * A running timer is flagged ORPHANED when either:
 *   - the user has no active clock event at all right now, or
 *   - the user's current clock event started AFTER the timer did (the timer
 *     is a leftover from a previous, already-ended shift).
 *
 * Makes no writes. Run this before deciding how to correct accumulated hours.
 */

import { MongoClient, ObjectId } from 'mongodb';

const MONGO_URL = process.env.MONGO_URL || 'mongodb://127.0.0.1:27017/timehuddle';

function formatHours(ms) {
  return (ms / (1000 * 60 * 60)).toFixed(1);
}

function isValidId(id) {
  return typeof id === 'string' && ObjectId.isValid(id);
}

async function main() {
  const client = new MongoClient(MONGO_URL);
  await client.connect();
  console.log(`Connected to ${MONGO_URL}\n`);

  try {
    const db = client.db();
    const now = Date.now();

    const runningTimers = await db.collection('timers').find({ endTime: null }).toArray();

    if (runningTimers.length === 0) {
      console.log('No running timer sessions found. Nothing to report.');
      return;
    }

    const userIds = [...new Set(runningTimers.map((t) => t.userId))];
    const workItemIds = [...new Set(runningTimers.map((t) => t.workItemId).filter(isValidId))];

    const [users, workItems, activeClockEvents] = await Promise.all([
      db.collection('users').find({ _id: { $in: userIds } }).toArray(),
      db.collection('workitems').find({ _id: { $in: workItemIds.map((id) => new ObjectId(id)) } }).toArray(),
      db.collection('clockevents').find({ userId: { $in: userIds }, endTime: null }).toArray(),
    ]);

    const userById = new Map(users.map((u) => [String(u._id), u]));
    const workItemById = new Map(workItems.map((w) => [String(w._id), w]));
    const activeClockByUser = new Map(activeClockEvents.map((c) => [c.userId, c]));

    const ticketIds = [...new Set(
      [...workItemById.values()].map((w) => w.ticketId).filter(isValidId),
    )];
    const tickets = await db.collection('tickets')
      .find({ _id: { $in: ticketIds.map((id) => new ObjectId(id)) } })
      .toArray();
    const ticketById = new Map(tickets.map((t) => [String(t._id), t]));

    const rows = runningTimers.map((timer) => {
      const user = userById.get(timer.userId);
      const workItem = workItemById.get(timer.workItemId);
      const ticket = workItem ? ticketById.get(workItem.ticketId) : null;
      const activeClock = activeClockByUser.get(timer.userId);

      const orphaned = !activeClock || activeClock.startTime > timer.startTime;

      return {
        timerId: String(timer._id),
        userName: user?.profile?.name ?? '(unknown user)',
        userEmail: user?.emails?.[0]?.address ?? '(unknown email)',
        ticketTitle: ticket?.title ?? '(unknown ticket)',
        ticketId: workItem?.ticketId ?? '(unknown)',
        startTime: new Date(timer.startTime).toISOString(),
        elapsedHours: formatHours(now - timer.startTime),
        currentlyClockedIn: Boolean(activeClock),
        orphaned,
      };
    });

    rows.sort((a, b) => Number(b.elapsedHours) - Number(a.elapsedHours));

    console.log(`Found ${rows.length} running timer session(s):\n`);
    for (const row of rows) {
      const flag = row.orphaned ? '⚠️  ORPHANED' : '   running';
      console.log(`${flag}  ${row.elapsedHours}h elapsed`);
      console.log(`    Ticket:      ${row.ticketTitle} (${row.ticketId})`);
      console.log(`    User:        ${row.userName} <${row.userEmail}>`);
      console.log(`    Timer id:    ${row.timerId}`);
      console.log(`    Started:     ${row.startTime}`);
      console.log(`    Clocked in:  ${row.currentlyClockedIn ? 'yes' : 'no'}`);
      console.log('');
    }

    const orphanedCount = rows.filter((r) => r.orphaned).length;
    console.log('=== Summary ===');
    console.log(`Total running timers:    ${rows.length}`);
    console.log(`Orphaned (bug-affected): ${orphanedCount}`);
    console.log(`Legitimately running:    ${rows.length - orphanedCount}`);

    if (orphanedCount > 0) {
      console.log('\nThis is a read-only report — no documents were modified.');
      console.log('Decide a correct cutoff time per session before writing a fix-up script.');
    }
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error('Report failed:', error);
  process.exitCode = 1;
});
