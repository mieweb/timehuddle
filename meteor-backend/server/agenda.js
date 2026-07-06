/**
 * Agenda — port of backend/src/services/agenda.service.ts.
 *
 * MongoDB-backed scheduler for time-sensitive clock events, persisted in the
 * SAME `agendajobs` collection the Fastify backend uses, with the SAME job
 * names and payload shape ({ clockEventId, userId, teamId }). Because the
 * collection and lock semantics are shared, jobs are writer-agnostic — whichever
 * backend's processor grabs the lock runs it exactly once.
 *
 * Coexistence guard: during the Fastify→Meteor migration, Fastify remains the
 * clock writer and runs the processor. This module therefore DEFINES the jobs
 * and exposes the scheduling helpers, but only STARTS its processor loop when
 * METEOR_AGENDA_ENABLED=true — so the two backends never double-process. M1
 * flips the flag when Meteor becomes the clock writer.
 */
import { MongoInternals } from 'meteor/mongo';
import { Agenda } from 'agenda';
import { MongoBackend } from '@agendajs/mongo-backend';
import { ClockEvents, rawDb, isValidId } from './collections';
import { computeWorkSeconds, findBreaksForEvent, stopActiveClock } from './clock-core';
import { createNotification } from './notify-core';

const { ObjectId } = MongoInternals.NpmModules.mongodb.module;

const FOUR_HOURS_MS = 4 * 3600_000;
const SHIFT_END_MS = 27_900_000; // 7h 45m
const AUTO_CLOCKOUT_MS = 8 * 3600_000;

const SHIFT_END_WORK_SECS = 7.75 * 3600; // 7h 45m in work seconds
const AUTO_CLOCKOUT_WORK_SECS = 8 * 3600; // 8h in work seconds

let _agenda;

export function getAgenda() {
  return _agenda;
}

/** Load an open clock event by hex id, or null if missing/closed. */
async function findOpenEvent(clockEventId) {
  if (!isValidId(clockEventId)) return null;
  return ClockEvents.findOneAsync({ _id: new ObjectId(clockEventId), endTime: null });
}

/**
 * Insert a notification (Fastify `notifications` shape) and fire push.
 * The reactive inbox delivery that Fastify did over SSE is replaced by the
 * Meteor notifications publication in M1; here we persist + push only.
 */
async function notifyUser(userId, { title, body, data }) {
  return createNotification({ userId, title, body, data });
}

export async function initAgenda() {
  // Reuse Meteor's already-open MongoDB connection instead of opening a second
  // client — avoids a duplicate pool and the eager-connect failures that would
  // otherwise crash the server (the agenda client cannot tolerate a transient
  // DNS miss the way Meteor's retrying driver can).
  _agenda = new Agenda({
    backend: new MongoBackend({ mongo: rawDb(), collection: 'agendajobs' }),
    processEvery: '30 seconds',
    defaultLockLifetime: 10_000,
  });

  // ── Job: 4h "Take a Break" reminder ──────────────────────────────────────
  _agenda.define('shift-4h-reminder', async (job) => {
    const { clockEventId, userId, teamId } = job.attrs.data;
    const event = await findOpenEvent(clockEventId);
    if (!event) { await job.remove(); return; } // already clocked out — nothing to do
    await notifyUser(userId, {
      title: 'Huddle',
      body: 'Take a break. You have worked for 4 hours.',
      data: { type: 'break-reminder-4h', teamId, clockEventId, url: '/app/clock' },
    });
    await job.remove(); // one-shot: remove so it doesn't re-fire
  });

  // ── Job: 7h45m shift-end reminder ────────────────────────────────────────
  _agenda.define('shift-end-reminder', async (job) => {
    const { clockEventId, userId, teamId } = job.attrs.data;
    const event = await findOpenEvent(clockEventId);
    if (!event) return; // already clocked out
    if (event.autoClockoutAgreed) return; // already agreed — no need to prompt again
    if (event.notifiedAt7h45m) return; // reminder already sent — prevent duplicates

    const breaks = await findBreaksForEvent(clockEventId);
    const now = Date.now();
    const workSeconds = computeWorkSeconds(event, breaks, now);

    if (workSeconds < SHIFT_END_WORK_SECS) {
      const remainingSecs = SHIFT_END_WORK_SECS - workSeconds;
      await job.schedule(new Date(now + remainingSecs * 1000)).save();
      return;
    }

    await notifyUser(userId, {
      title: 'Huddle',
      body: 'You are approaching 8 hours. Would you like to continue working or clock out?',
      data: { type: 'shift-end-reminder', clockEventId, teamId, url: '/app/clock' },
    });

    await ClockEvents.updateAsync(
      { _id: event._id, endTime: null },
      { $set: { notifiedAt7h45m: now } }
    );

    await scheduleMissedClockout(clockEventId, userId, teamId, event.startTime);
    await job.remove(); // one-shot: remove so it doesn't re-fire
  });

  // ── Job: 8h auto-clockout (agreed) ───────────────────────────────────────
  _agenda.define('shift-auto-clockout', async (job) => {
    const { clockEventId, userId, teamId } = job.attrs.data;
    const event = await findOpenEvent(clockEventId);
    if (!event) return; // already clocked out
    if (!event.autoClockoutAgreed) return; // user changed their mind

    const breaks = await findBreaksForEvent(clockEventId);
    const now = Date.now();
    const workSeconds = computeWorkSeconds(event, breaks, now);

    if (workSeconds < AUTO_CLOCKOUT_WORK_SECS) {
      const remainingSecs = AUTO_CLOCKOUT_WORK_SECS - workSeconds;
      await job.schedule(new Date(now + remainingSecs * 1000)).save();
      return;
    }

    await stopActiveClock(userId, teamId, now);
    await job.remove(); // one-shot: remove so it doesn't re-fire
  });

  // ── Job: 8h missed auto-clockout ─────────────────────────────────────────
  _agenda.define('shift-missed-clockout', async (job) => {
    const { clockEventId, userId, teamId } = job.attrs.data;
    const event = await findOpenEvent(clockEventId);
    if (!event) return; // already clocked out
    if (event.shiftReminderResponse === 'disagreed') return; // respected "Continue Working"
    if (event.autoClockoutAgreed) return; // agreed path handled by shift-auto-clockout

    const breaks = await findBreaksForEvent(clockEventId);
    const now = Date.now();
    const workSeconds = computeWorkSeconds(event, breaks, now);

    if (workSeconds < AUTO_CLOCKOUT_WORK_SECS) {
      const remainingSecs = AUTO_CLOCKOUT_WORK_SECS - workSeconds;
      await job.schedule(new Date(now + remainingSecs * 1000)).save();
      return;
    }

    await stopActiveClock(userId, teamId, now);

    // Rewrite the existing shift-end-reminder notification in-place to describe
    // the auto-clock-out outcome (keeps exactly one inbox entry).
    await rawDb()
      .collection('notifications')
      .updateOne(
        { userId, 'data.clockEventId': clockEventId, 'data.type': 'shift-end-reminder' },
        {
          $set: {
            read: true,
            title: 'Huddle — Auto Clock-Out',
            body: 'You were automatically clocked out after 8 hours because the shift-end reminder was not acknowledged.',
            'data.type': 'auto-clock-out',
          },
        }
      );
    await job.remove(); // one-shot: remove so it doesn't re-fire
  });

  // Processor loop is opt-in during coexistence (see file header).
  if (process.env.METEOR_AGENDA_ENABLED === 'true') {
    await _agenda.start();
    console.log(
      '[agenda] processor started — jobs: shift-4h-reminder, shift-end-reminder, shift-auto-clockout, shift-missed-clockout'
    );
  } else {
    console.log(
      '[agenda] jobs defined; processor disabled (set METEOR_AGENDA_ENABLED=true to run in Meteor)'
    );
  }
}

export async function stopAgenda() {
  await _agenda?.stop();
  console.log('[agenda] stopped');
}

// ── Scheduling helpers ──────────────────────────────────────────────────────

/** Schedule the 4h break + 7h45m shift-end reminders for a new clock session. */
export async function scheduleClockJobs(clockEventId, userId, teamId, startTimeMs) {
  const data = { clockEventId, userId, teamId };
  const now = Date.now();
  const fourHourAt = new Date(startTimeMs + FOUR_HOURS_MS);
  const shiftEndAt = new Date(startTimeMs + SHIFT_END_MS);

  if (fourHourAt.getTime() > now) {
    await _agenda
      .create('shift-4h-reminder', data)
      .unique({ 'data.clockEventId': clockEventId, name: 'shift-4h-reminder' })
      .schedule(fourHourAt)
      .save();
  }

  if (shiftEndAt.getTime() > now) {
    await _agenda
      .create('shift-end-reminder', data)
      .unique({ 'data.clockEventId': clockEventId, name: 'shift-end-reminder' })
      .schedule(shiftEndAt)
      .save();
  }
}

/** Re-evaluate jobs after an admin edits a session's startTime. */
export async function rescheduleClockJobs(
  clockEventId,
  userId,
  teamId,
  newStartTimeMs,
  autoClockoutAgreed
) {
  await cancelClockJobs(clockEventId);
  await scheduleClockJobs(clockEventId, userId, teamId, newStartTimeMs);
  if (autoClockoutAgreed) {
    await scheduleAutoClockout(clockEventId, userId, teamId, newStartTimeMs);
  }
}

/** Schedule the 8h auto-clockout (user clicked "Agree to Clock Out"). */
export async function scheduleAutoClockout(clockEventId, userId, teamId, startTimeMs) {
  const data = { clockEventId, userId, teamId };
  const autoClockoutAt = new Date(startTimeMs + AUTO_CLOCKOUT_MS);
  const fireAt =
    autoClockoutAt.getTime() > Date.now() ? autoClockoutAt : new Date(Date.now() + 5_000);

  await _agenda
    .create('shift-auto-clockout', data)
    .unique({ 'data.clockEventId': clockEventId, name: 'shift-auto-clockout' })
    .schedule(fireAt)
    .save();
}

/** Schedule the 8h missed-clockout for users who never respond to the reminder. */
export async function scheduleMissedClockout(clockEventId, userId, teamId, startTimeMs) {
  const data = { clockEventId, userId, teamId };
  const missedAt = new Date(startTimeMs + AUTO_CLOCKOUT_MS);
  const fireAt = missedAt.getTime() > Date.now() ? missedAt : new Date(Date.now() + 30_000);

  await _agenda
    .create('shift-missed-clockout', data)
    .unique({ 'data.clockEventId': clockEventId, name: 'shift-missed-clockout' })
    .schedule(fireAt)
    .save();
}

/** Cancel all pending jobs for a clock event (manual clock-out or delete). */
export async function cancelClockJobs(clockEventId) {
  await _agenda.cancel({ data: { clockEventId } });
}

/** Cancel a single named job for a clock event. */
export async function cancelClockJobsByName(clockEventId, name) {
  await _agenda.cancel({ name, data: { clockEventId } });
}
