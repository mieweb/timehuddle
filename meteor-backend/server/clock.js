/**
 * Clock — full port of backend/src/services/clock.service.ts onto Meteor.
 *
 * This is the M1 clock cutover: Meteor becomes the clock/timer/notification
 * writer for the clock domain. Every method mirrors a ClockService method,
 * including the side-effect pipeline (Agenda reminders, admin/self
 * notifications, activity log, timer close-out/restart). Break math is shared
 * with the Agenda jobs via clock-core so accumulatedTime stays consistent.
 *
 * Reactive delivery: writes hit the shared collections (oplog) so the
 * `clock.liveForTeams` / `clock.liveOpenShifts` / `timers.liveForUser` /
 * `notifications.liveForUser` publications fan out automatically — no
 * WebSocket/SSE broadcast needed.
 *
 * The clock is per team: a person holds at most one open shift per team (a
 * unique partial index enforces it), may be on the clock in several teams at
 * once, and clocking out of one team never touches another team's shift.
 */
import { Meteor } from 'meteor/meteor';
import { Mongo, MongoInternals } from 'meteor/mongo';
import {
  ClockEvents,
  ClockBreaks,
  DUPLICATE_KEY_ERROR_CODE,
  Teams,
  isValidId,
  rawDb,
} from './collections';
import { requireIdentity, findUserById } from './auth-bridge';
import { SESSION_POST_SORT } from './huddle';
import { requireTeamMembership } from './permissions';
import {
  toPublicClockEvent,
  breakSignature,
  classifyBreak,
  closeShift,
  computeDeductedBreakSeconds,
  computeWorkSeconds,
  computeTotalBreakSeconds,
  findBreaksForEvent,
  findBreaksForEvents,
  findOpenShift,
  findOpenShifts,
  toBreakEntries,
  normalizeBreakEntries,
} from './clock-core';
import {
  closeRunningForShift,
  findClosedAtTime,
  restartTimerForWorkItem,
  ticketSessionsForClockEvents,
} from './timer-core';
import { createNotification, notifyClockAdmins, userDisplayName } from './notify-core';
import { planDuplicateShiftClosures } from './open-shift-dedupe';
import { emitActivity, ActivityType } from './activity-core';
import { requiresApproval, findTeamById, submitChangeRequest } from './timesheet-change-requests';
import {
  scheduleClockJobs,
  rescheduleClockJobs,
  scheduleAutoClockout,
  cancelClockJobs,
  cancelClockJobsByName,
} from './agenda';

const { ObjectId } = MongoInternals.NpmModules.mongodb.module;
const oid = (hex) => new Mongo.ObjectID(hex);

/** Name of the unique partial index allowing one open shift per (user, team). */
const OPEN_SHIFT_INDEX = 'unique_open_shift_per_team';

/**
 * End every older duplicate open shift per (user, team), keeping the newest.
 *
 * Before the unique index existed, two racing `clock.start` calls could both
 * insert. Each older shift ends where the next one began, so no hours overlap
 * (see open-shift-dedupe.js); its open break and ticket timers stop at that
 * moment, and its reminder jobs are cancelled. Returns how many shifts were closed.
 */
async function closeDuplicateOpenShifts() {
  const groups = await rawDb()
    .collection('clockevents')
    .aggregate([
      { $match: { endTime: null } },
      { $group: { _id: { userId: '$userId', teamId: '$teamId' }, count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
    ])
    .toArray();

  const openShifts = [];
  for (const { _id: group } of groups) {
    openShifts.push(
      ...(await ClockEvents.find({
        userId: group.userId,
        teamId: group.teamId,
        endTime: null,
      }).fetchAsync())
    );
  }

  let closedCount = 0;
  for (const { shift, endAt, keptId } of planDuplicateShiftClosures(openShifts)) {
    const shiftId = shift._id.toHexString();
    const closed = await closeShift(shift, endAt);
    if (!closed) continue;
    closedCount++;
    cancelClockJobs(shiftId).catch((err) =>
      console.error('[agenda] cancelClockJobs for duplicate shift failed:', err)
    );
    console.warn(
      `[clock] closed duplicate open shift ${shiftId} (user ${shift.userId}, team ${shift.teamId}) ` +
        `at ${new Date(endAt).toISOString()}; kept ${keptId}`
    );
  }
  return closedCount;
}

/**
 * Enforce one open shift per person per team in the database, so two
 * simultaneous clock-ins for the same team can't both succeed. Existing
 * duplicates have to go first or the index can't be built; a clock-in racing
 * that gap only means another pass.
 */
Meteor.startup(async () => {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await closeDuplicateOpenShifts();
      await ClockEvents.createIndexAsync(
        { userId: 1, teamId: 1 },
        { unique: true, partialFilterExpression: { endTime: null }, name: OPEN_SHIFT_INDEX }
      );
      return;
    } catch (err) {
      if (err?.code === DUPLICATE_KEY_ERROR_CODE && attempt < 3) continue;
      console.error('[clock] failed to create the one-open-shift-per-team index:', err);
      return;
    }
  }
});

/** Load one team the user belongs to (member or admin), or null. */
async function findUserTeam(userId, teamId) {
  if (!isValidId(teamId)) return null;
  return Teams.findOneAsync({
    _id: oid(teamId),
    $or: [{ members: userId }, { admins: userId }],
  });
}

// ─── Mutations ───────────────────────────────────────────────────────────────
// Extracted from the methods below so an approved change request can replay the
// exact same write the direct path would have made. `actorId` is the person the
// change is attributed to, which is the requester even when an admin approves.
// `notifyAdmins` is off on that path: the admins asked for the change to happen,
// so telling them it happened is noise — and it reached the approver as "someone
// else edited this", which reads like a different event entirely.

/**
 * Whether a manual entry for this range could be inserted right now.
 *
 * Run both before queueing a change request and again on replay: checking only
 * at replay lets an entry that can never be applied sit in the review queue,
 * and checking only at submission lets an overlap appear while it waits.
 */
export async function assertManualRangeUsable({ userId, startTime, endTime }) {
  const now = Date.now();
  if (startTime > now || endTime > now) {
    throw new Meteor.Error('invalid-range', 'Times must be in the past');
  }
  if (endTime <= startTime) throw new Meteor.Error('invalid-range', 'End is before start');

  const overlapping = await ClockEvents.findOneAsync({
    userId,
    startTime: { $lt: endTime },
    $or: [{ endTime: null }, { endTime: { $gt: startTime } }],
  });
  if (overlapping) {
    throw new Meteor.Error('overlap', 'This entry overlaps an existing clock session');
  }
}

/**
 * The times an update would leave the event with, or a throw if they're not a
 * range. Shared with the gate so an impossible edit is refused outright rather
 * than queued as a change no approval could ever apply.
 */
export function effectiveRangeFor(event, { startTime, endTime }) {
  const effectiveStart = typeof startTime === 'number' ? startTime : event.startTime;
  const effectiveEnd =
    endTime === null ? null : typeof endTime === 'number' ? endTime : event.endTime;
  if (effectiveEnd !== null && effectiveEnd < effectiveStart) {
    throw new Meteor.Error('invalid-range', 'End is before start');
  }
  return { effectiveStart, effectiveEnd };
}

/**
 * Apply new times/breaks to an existing clock event.
 *
 * `onCommit` fires immediately before the first write, so a caller replaying
 * this can tell a validation refusal from a failure part-way through.
 */
export async function applyClockUpdate(
  event,
  { startTime, endTime, breaks },
  actorId,
  { notifyAdmins = true, onCommit } = {}
) {
  const clockEventId = event._id.toHexString();
  const { effectiveStart, effectiveEnd } = effectiveRangeFor(event, { startTime, endTime });

  const existingBreaks = await findBreaksForEvent(clockEventId);
  const requestedBreaks = Array.isArray(breaks) ? toBreakEntries(breaks) : existingBreaks;
  const normalizedBreaks = normalizeBreakEntries(requestedBreaks, effectiveStart, effectiveEnd);

  const classifiedBreaks = normalizedBreaks.map((b) => {
    if (b.endTime === null || b.type !== undefined) return b;
    const durationSeconds = Math.floor((b.endTime - b.startTime) / 1000);
    return { ...b, ...classifyBreak(durationSeconds) };
  });

  onCommit?.();
  await ClockBreaks.removeAsync({ clockEventId });
  for (const b of classifiedBreaks) {
    await ClockBreaks.insertAsync({ clockEventId, ...b });
  }

  const $set = {};
  if (typeof startTime === 'number') $set.startTime = startTime;
  if (endTime === null) $set.endTime = null;
  else if (typeof endTime === 'number') $set.endTime = endTime;

  if (effectiveEnd !== null) {
    const now = Date.now();
    const deductedSeconds = computeDeductedBreakSeconds(classifiedBreaks, now);
    const spanSeconds = Math.max(0, Math.floor((effectiveEnd - effectiveStart) / 1000));
    $set.accumulatedTime = Math.max(0, spanSeconds - deductedSeconds);
  }

  if (Object.keys($set).length > 0) await ClockEvents.updateAsync(event._id, { $set });

  if (typeof startTime === 'number' && event.endTime === null) {
    rescheduleClockJobs(
      clockEventId,
      event.userId,
      event.teamId,
      startTime,
      event.autoClockoutAgreed === true
    ).catch((err) => console.error('[agenda] rescheduleClockJobs failed:', err));
  }

  const updated = await ClockEvents.findOneAsync(event._id);
  if (!updated) throw new Meteor.Error('not-found', 'Clock event not found');
  const updatedBreaks = await findBreaksForEvent(clockEventId);

  if (notifyAdmins) {
    notifyClockAdmins(actorId, event.teamId, updated.startTime, 'updated').catch((err) =>
      console.error('[clock] notify admins failed:', err)
    );
  }
  return toPublicClockEvent(updated, updatedBreaks);
}

/** Remove a clock event along with its breaks, attachments and pending jobs. */
export async function applyClockDelete(event, actorId, { notifyAdmins = true, onCommit } = {}) {
  const clockEventId = event._id.toHexString();
  onCommit?.();
  await ClockEvents.removeAsync(event._id);
  cancelClockJobs(clockEventId).catch((err) =>
    console.error('[agenda] cancelClockJobs on delete failed:', err)
  );
  await ClockBreaks.removeAsync({ clockEventId });
  await rawDb()
    .collection('attachments')
    .deleteMany({ 'attachedTo.kind': 'clock', 'attachedTo.id': clockEventId });

  if (notifyAdmins) {
    notifyClockAdmins(actorId, event.teamId, event.startTime, 'deleted').catch((err) =>
      console.error('[clock] notify admins failed:', err)
    );
  }
  return { ok: true };
}

/** Insert a completed clock event for a past range (manual backfill). */
export async function applyClockCreateManual({
  userId,
  teamId,
  startTime,
  endTime,
  notifyAdmins = true,
  onCommit,
}) {
  await assertManualRangeUsable({ userId, startTime, endTime });

  onCommit?.();
  const _id = await ClockEvents.insertAsync({
    userId,
    teamId,
    startTime,
    accumulatedTime: Math.floor((endTime - startTime) / 1000),
    endTime,
  });
  const created = await ClockEvents.findOneAsync(_id);
  if (notifyAdmins) {
    notifyClockAdmins(userId, teamId, startTime, 'added').catch((err) =>
      console.error('[clock] notify admins failed:', err)
    );
  }
  return toPublicClockEvent(created, []);
}

Meteor.methods({
  /** The caller's active clock event in a team, or null. */
  async 'clock.active'({ teamId } = {}) {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    await requireTeamMembership(userId, teamId);
    const event = await ClockEvents.findOneAsync({
      userId,
      teamId,
      endTime: null,
    });
    if (!event) return null;
    const breaks = await findBreaksForEvent(event._id.toHexString());
    return toPublicClockEvent(event, breaks);
  },

  /**
   * Every open shift of the caller, at most one per team, oldest first. The
   * client keys them by `teamId`; nothing here picks "the" shift.
   */
  async 'clock.myOpenShifts'() {
    const identity = await requireIdentity(this);
    const shifts = await findOpenShifts(identity.userId);
    const breaks = await findBreaksForEvents(shifts.map((e) => e._id.toHexString()));
    return shifts.map((event) => {
      const eventId = event._id.toHexString();
      return toPublicClockEvent(
        event,
        breaks.filter((b) => b.clockEventId === eventId)
      );
    });
  },

  /** Live clock status for a team: { event, workSeconds, isPaused } or null. */
  async 'clock.status'({ teamId } = {}) {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    await requireTeamMembership(userId, teamId);
    const event = await ClockEvents.findOneAsync({
      userId,
      teamId,
      endTime: null,
    });
    if (!event) return null;
    const breaks = await findBreaksForEvent(event._id.toHexString());
    const now = Date.now();
    return {
      event: toPublicClockEvent(event, breaks),
      workSeconds: computeWorkSeconds(event, breaks, now),
      isPaused: breaks.some((b) => b.endTime === null),
    };
  },

  /** All clock events for the caller (their own history & timesheet). */
  async 'clock.events'() {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    const events = await ClockEvents.find(
      { userId },
      { sort: { startTime: -1 } }
    ).fetchAsync();
    const eventIds = events.map((e) => e._id.toHexString());
    const allBreaks = await findBreaksForEvents(eventIds);
    const breaksByEventId = new Map();
    for (const b of allBreaks) {
      const arr = breaksByEventId.get(b.clockEventId) ?? [];
      arr.push(b);
      breaksByEventId.set(b.clockEventId, arr);
    }
    return events.map((e) =>
      toPublicClockEvent(e, breaksByEventId.get(e._id.toHexString()) ?? [])
    );
  },

  /**
   * Clock in to a team, then fire side-effects. Refused with
   * `already-clocked-in` while that team's shift is open — clock out of it
   * first. Being on the clock in another team doesn't matter.
   */
  async 'clock.start'({ teamId, planPostId } = {}) {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    const team = await findUserTeam(userId, teamId);
    if (!team) throw new Meteor.Error('forbidden', 'Not a member of this team');

    const alreadyClockedIn = () =>
      new Meteor.Error('already-clocked-in', `You're already clocked in to ${team.name}`);
    if (await findOpenShift(userId, teamId)) throw alreadyClockedIn();

    const now = Date.now();
    let _id;
    try {
      _id = await ClockEvents.insertAsync({
        userId,
        teamId,
        startTime: now,
        accumulatedTime: 0,
        autoClockoutAgreed: null,
        endTime: null,
      });
    } catch (err) {
      // Lost a race with another clock-in for this team: the unique open-shift
      // index kept theirs.
      if (err?.code === DUPLICATE_KEY_ERROR_CODE) throw alreadyClockedIn();
      throw err;
    }
    const created = await ClockEvents.findOneAsync(_id);
    const pub = toPublicClockEvent(created, []);

    // Plan-first flow: link the just-posted plan to this session so the
    // per-session clock-out gate can find it (one post per clock session).
    // Only the author's own post in *this* team qualifies — the admin deep link
    // below opens the team feed, which a post from elsewhere never appears in.
    let planPost = null;
    if (planPostId && isValidId(planPostId)) {
      planPost = await rawDb()
        .collection('huddlePosts')
        .findOne({ _id: new ObjectId(planPostId), userId });
      if (planPost && String(planPost.teamId) === String(teamId)) {
        // Not `updatedAt` — the feed renders any post whose updatedAt differs
        // from createdAt as "edited", and linking a session is not an edit.
        await rawDb()
          .collection('huddlePosts')
          .updateOne(
            { _id: planPost._id },
            { $set: { clockEventId: created._id.toHexString() } }
          );
      } else {
        planPost = null;
      }
    }

    // Schedule 4h break reminder + 7h45m shift-end reminder.
    scheduleClockJobs(created._id.toHexString(), userId, teamId, now).catch((err) =>
      console.error('[agenda] scheduleClockJobs failed:', err)
    );

    const userName = await userDisplayName(userId);
    const notifyAdmins = (team.admins ?? []).filter((id) => id !== userId);
    // With a plan attached, send admins to that Huddle post (it shows the plan);
    // otherwise fall back to the clocked-in member's Work tab.
    const clockInUrl = planPost
      ? `/app/huddle?postId=${planPostId}&teamId=${teamId}`
      : `/app/profile/${userId}?tab=work`;
    await Promise.all(
      notifyAdmins.map((adminId) =>
        createNotification({
          userId: adminId,
          title: 'Huddle',
          body: `${userName} clocked in to ${team.name}`,
          data: {
            type: 'clock-in',
            userId,
            userName,
            teamName: team.name,
            teamId,
            url: clockInUrl,
          },
        }).catch(() => {})
      )
    );

    void emitActivity({
      userId,
      teamId,
      type: ActivityType.ClockIn,
      actor: { id: userId, name: userName },
      payload: { teamId, teamName: team.name },
    });

    return pub;
  },

  /**
   * Clock out of one session: cancel its jobs, close its ticket timers + open
   * break, recompute, notify, log. `clockEventId` names the session, so a newer
   * shift started meanwhile is never the one that ends; `teamId` alone (older
   * callers) means that team's open shift.
   */
  async 'clock.stop'({ clockEventId, teamId: requestedTeamId } = {}) {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    let event = null;
    if (clockEventId) {
      if (isValidId(clockEventId)) {
        event = await ClockEvents.findOneAsync({ _id: oid(clockEventId), userId, endTime: null });
      }
      if (event && requestedTeamId && event.teamId !== requestedTeamId) event = null;
    } else {
      event = await findOpenShift(userId, requestedTeamId);
    }
    if (!event) throw new Meteor.Error('not-found', 'No active clock event');

    const teamId = event.teamId;
    const team = await findUserTeam(userId, teamId);

    // This session's Huddle post (one post per clock session, linked by
    // clockEventId — see clock-post-simple-plan.md). Drafts never count.
    // Used both by the plan-first clock-out gate and to deep-link the
    // clock-out notifications at the post showing the plan + wrap-up.
    const sessionPost = await rawDb()
      .collection('huddlePosts')
      .findOne(
        { teamId, userId, clockEventId: event._id.toHexString(), status: { $ne: 'draft' } },
        { sort: SESSION_POST_SORT }
      );

    // Plan-first flow: when the team requires a plan, block clock-out until
    // THIS session's post has a wrap-up.
    if (team?.settings?.requirePlanForClock && !sessionPost?.wrapUpAt) {
      throw new Meteor.Error('plan-required', "Add a wrap-up to this session's post first");
    }

    const now = Date.now();
    const eventId = event._id.toHexString();

    // Closes this shift's ticket timers and open break only; the user's
    // shifts in other teams keep running.
    const closed = await closeShift(event, now);
    if (!closed) throw new Meteor.Error('not-found', 'No active clock event');

    cancelClockJobs(eventId).catch((err) =>
      console.error('[agenda] cancelClockJobs failed:', err)
    );

    const pub = toPublicClockEvent(closed.event, closed.breaks);

    if (team) {
      const userName = await userDisplayName(userId);
      const totalSecs = pub.accumulatedTime ?? 0;
      const h = Math.floor(totalSecs / 3600);
      const m = Math.floor((totalSecs % 3600) / 60);
      const durationText = h > 0 ? `${h}h ${m}m` : `${m}m`;
      const notifyAdmins = (team.admins ?? []).filter((id) => id !== userId);
      // Prefer this session's Huddle post (shows the plan + wrap-up); fall
      // back to the member's Work tab when the session had no post.
      const clockOutUrl = sessionPost
        ? `/app/huddle?postId=${sessionPost._id.toHexString()}&teamId=${teamId}`
        : `/app/profile/${userId}?tab=work`;
      await Promise.all(
        notifyAdmins.map((adminId) =>
          createNotification({
            userId: adminId,
            title: 'Huddle',
            body: `${userName} clocked out of ${team.name} (${durationText})`,
            data: {
              type: 'clock-out',
              userId,
              userName,
              teamName: team.name,
              teamId,
              duration: durationText,
              url: clockOutUrl,
            },
          }).catch(() => {})
        )
      );

      createNotification({
        userId,
        title: 'Huddle',
        body: `You clocked out of ${team.name} (${durationText})`,
        data: {
          type: 'clock-out-self',
          teamName: team.name,
          teamId,
          duration: durationText,
          url: clockOutUrl,
        },
      }).catch(() => {});

      void emitActivity({
        userId,
        teamId,
        type: ActivityType.ClockOut,
        actor: { id: userId, name: userName },
        payload: {
          teamId,
          teamName: team.name,
          durationSeconds: pub.accumulatedTime ?? undefined,
        },
      });
    }

    return pub;
  },

  /** Pause (break start): close running timer, open a break. */
  async 'clock.pause'({ teamId } = {}) {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    const event = await ClockEvents.findOneAsync({ userId, teamId, endTime: null });
    if (!event) throw new Meteor.Error('not-found', 'No active clock event');

    const eventId = event._id.toHexString();
    const breaks = await findBreaksForEvent(eventId);
    if (breaks.some((b) => b.endTime === null)) {
      throw new Meteor.Error('already-paused', 'Already on a break');
    }

    const now = Date.now();
    await closeRunningForShift(userId, eventId, now);
    await ClockBreaks.insertAsync({ clockEventId: eventId, startTime: now, endTime: null });

    const updatedBreaks = [...breaks, { startTime: now, endTime: null }];
    return toPublicClockEvent(event, updatedBreaks);
  },

  /** Resume (break end): close + classify the open break, restart the timer. */
  async 'clock.resume'({ teamId } = {}) {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    const event = await ClockEvents.findOneAsync({ userId, teamId, endTime: null });
    if (!event) throw new Meteor.Error('not-found', 'No active clock event');

    const eventId = event._id.toHexString();
    const breaks = await findBreaksForEvent(eventId);
    const openBreak = breaks.find((b) => b.endTime === null);
    if (!openBreak) throw new Meteor.Error('not-paused', 'Not on a break');

    const now = Date.now();
    const durationSeconds = Math.floor((now - openBreak.startTime) / 1000);
    const classification = classifyBreak(durationSeconds);
    await ClockBreaks.updateAsync(openBreak._id, {
      $set: { endTime: now, ...classification },
    });

    const updatedBreaks = breaks.map((b) =>
      b._id.equals(openBreak._id) ? { ...b, endTime: now, ...classification } : b
    );

    // Restart the timer that was stopped when the break began.
    const closedTimer = await findClosedAtTime(userId, eventId, openBreak.startTime);
    if (closedTimer) {
      await restartTimerForWorkItem(userId, closedTimer.workItemId, now, eventId);
    }

    return toPublicClockEvent(event, updatedBreaks);
  },

  /** Update a clock event's timestamps and optional break intervals. */
  async 'clock.updateTimes'({
    clockEventId,
    startTime,
    endTime,
    breaks,
    description,
    videoUrl,
  } = {}) {
    const identity = await requireIdentity(this);
    const requesterId = identity.userId;
    if (!isValidId(clockEventId)) throw new Meteor.Error('not-found', 'Clock event not found');
    const event = await ClockEvents.findOneAsync(oid(clockEventId));
    if (!event) throw new Meteor.Error('not-found', 'Clock event not found');

    if (event.userId !== requesterId) {
      const adminTeam = await Teams.findOneAsync({ _id: oid(event.teamId), admins: requesterId });
      if (!adminTeam) throw new Meteor.Error('forbidden', 'Not allowed to edit this event');
    }

    // By id, not by membership: the owner is authorised above on ownership
    // alone, so resolving the team through `findUserTeam` would return null
    // once they leave it — and a null team needs no approval, which would let
    // a former member rewrite that team's payroll directly.
    const team = await findTeamById(event.teamId);
    if (requiresApproval(team, requesterId)) {
      // Refused now rather than queued: an end before the start is a change no
      // approval could ever apply.
      effectiveRangeFor(event, { startTime, endTime });
      const request = await submitChangeRequest({
        requesterId,
        team,
        kind: 'clock',
        action: 'update',
        targetId: clockEventId,
        payload: { startTime, endTime, breaks },
        baseline: {
          startTime: event.startTime,
          endTime: event.endTime ?? null,
          // Replay replaces every break, so a pause/resume during review has to
          // count as drift even when the session's range is untouched.
          breaks: breakSignature(await findBreaksForEvent(clockEventId)),
        },
        description,
        videoUrl,
      });
      return { pending: true, request };
    }

    return applyClockUpdate(event, { startTime, endTime, breaks }, requesterId);
  },

  /** Delete a clock event (owner or team admin). */
  async 'clock.deleteEvent'({ clockEventId, description, videoUrl } = {}) {
    const identity = await requireIdentity(this);
    const requesterId = identity.userId;
    if (!isValidId(clockEventId)) throw new Meteor.Error('not-found', 'Clock event not found');
    const event = await ClockEvents.findOneAsync(oid(clockEventId));
    if (!event) throw new Meteor.Error('not-found', 'Clock event not found');

    if (event.userId !== requesterId) {
      const adminTeam = await Teams.findOneAsync({ _id: oid(event.teamId), admins: requesterId });
      if (!adminTeam) throw new Meteor.Error('forbidden', 'Not allowed to delete this event');
    }

    const team = await findTeamById(event.teamId);
    if (requiresApproval(team, requesterId)) {
      const request = await submitChangeRequest({
        requesterId,
        team,
        kind: 'clock',
        action: 'delete',
        targetId: clockEventId,
        payload: {},
        description,
        videoUrl,
      });
      return { pending: true, request };
    }

    return applyClockDelete(event, requesterId);
  },

  /** Create a completed clock event for a past time range (manual backfill). */
  async 'clock.createManual'({ teamId, startTime, endTime, description, videoUrl } = {}) {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    const team = await findUserTeam(userId, teamId);
    if (!team) throw new Meteor.Error('forbidden', 'Not a member of this team');

    if (requiresApproval(team, userId)) {
      // Validated before queueing: an entry that overlaps or sits in the future
      // can never be applied, so it has no business reaching a reviewer.
      await assertManualRangeUsable({ userId, startTime, endTime });
      const request = await submitChangeRequest({
        requesterId: userId,
        team,
        kind: 'clock',
        action: 'create',
        payload: { teamId, startTime, endTime },
        description,
        videoUrl,
      });
      return { pending: true, request };
    }

    return applyClockCreateManual({ userId, teamId, startTime, endTime });
  },

  /** Timesheet data for a user over a date range (epoch-ms boundaries). */
  async 'clock.timesheet'({ userId, startMs, endMs } = {}) {
    const identity = await requireIdentity(this);
    const requesterId = identity.userId;
    const targetUserId = userId;

    if (requesterId !== targetUserId) {
      const sharedAdminTeam = await Teams.findOneAsync({
        admins: requesterId,
        $or: [{ members: targetUserId }, { admins: targetUserId }],
      });
      if (!sharedAdminTeam) throw new Meteor.Error('forbidden', 'Not allowed to view timesheet');
    }

    const events = await ClockEvents.find(
      { userId: targetUserId, startTime: { $gte: startMs, $lte: endMs } },
      { sort: { startTime: -1 } }
    ).fetchAsync();

    const eventIds = events.map((e) => e._id.toHexString());
    const allBreaks = await findBreaksForEvents(eventIds);
    const breaksByEventId = new Map();
    for (const b of allBreaks) {
      const arr = breaksByEventId.get(b.clockEventId) ?? [];
      arr.push(b);
      breaksByEventId.set(b.clockEventId, arr);
    }

    // Ticket timers that ran inside these shifts. A shift with none gets
    // an empty array, which the row renders exactly as it did before. An admin
    // reading someone else's sheet gets titles only for tickets they could open.
    const ticketSessionsByEvent = await ticketSessionsForClockEvents(
      targetUserId,
      eventIds,
      requesterId,
    );

    const now = Date.now();
    const sessions = events
      .map((e) => ({
        ...toPublicClockEvent(e, breaksByEventId.get(e._id.toHexString()) ?? []),
        ticketSessions: ticketSessionsByEvent.get(e._id.toHexString()) ?? [],
      }))
      .sort((a, b) => b.startTime - a.startTime);

    const completed = sessions.filter((s) => s.endTime !== null);
    const totalSeconds = sessions.reduce((sum, s) => {
      if (!s.endTime) {
        const evBreaks = breaksByEventId.get(s.id) ?? [];
        return sum + computeWorkSeconds(s, evBreaks, now);
      }
      const accumulated = s.accumulatedTime ?? 0;
      if (accumulated > 0) return sum + accumulated;
      return sum + Math.max(0, Math.floor((s.endTime - s.startTime) / 1000));
    }, 0);
    const avgSeconds = completed.length > 0 ? totalSeconds / completed.length : 0;
    const totalBreakSeconds = sessions.reduce(
      (sum, s) => sum + computeTotalBreakSeconds(s.breaks, now),
      0
    );
    const uniqueDates = new Set(
      sessions.map((s) => new Date(s.startTime).toISOString().split('T')[0])
    );

    return {
      sessions,
      summary: {
        totalSeconds,
        totalBreakSeconds,
        totalSessions: sessions.length,
        completedSessions: completed.length,
        averageSessionSeconds: avgSeconds,
        workingDays: uniqueDates.size,
      },
    };
  },

  /** Mark the caller's active clock event as agreed to auto clock-out at 8h. */
  async 'clock.agreeAutoClockout'({ clockEventId } = {}) {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    if (!isValidId(clockEventId)) throw new Meteor.Error('not-found', 'Clock event not found');
    const event = await ClockEvents.findOneAsync(oid(clockEventId));
    if (!event) throw new Meteor.Error('not-found', 'Clock event not found');
    if (event.userId !== userId) throw new Meteor.Error('forbidden', 'Not your clock event');
    if (event.endTime !== null) throw new Meteor.Error('not-found', 'Already clocked out');

    await ClockEvents.updateAsync(event._id, { $set: { autoClockoutAgreed: true } });
    scheduleAutoClockout(clockEventId, userId, event.teamId, event.startTime).catch((err) =>
      console.error('[agenda] scheduleAutoClockout failed:', err)
    );
    cancelClockJobsByName(clockEventId, 'shift-missed-clockout').catch(() => {});
    return { ok: true };
  },

  /** Handle agree/disagree to a shift-end reminder notification. */
  async 'clock.respondShiftReminder'({ notificationId, action } = {}) {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    if (!isValidId(notificationId)) throw new Meteor.Error('not-found', 'Notification not found');

    const notifications = rawDb().collection('notifications');
    const notification = await notifications.findOne({ _id: new ObjectId(notificationId) });
    if (!notification) throw new Meteor.Error('not-found', 'Notification not found');
    if (notification.userId !== userId) {
      throw new Meteor.Error('forbidden', 'Not your notification');
    }

    const data = notification.data ?? {};
    if (data.type !== 'shift-end-reminder') throw new Meteor.Error('bad-request', 'Wrong type');

    const clockEventId = typeof data.clockEventId === 'string' ? data.clockEventId : '';
    if (!clockEventId || !isValidId(clockEventId)) {
      throw new Meteor.Error('bad-request', 'Missing clock event');
    }

    const event = await ClockEvents.findOneAsync(oid(clockEventId));
    if (!event) throw new Meteor.Error('not-found', 'Clock event not found');
    if (event.endTime !== null) throw new Meteor.Error('already-closed', 'Already clocked out');
    if (event.userId !== userId) throw new Meteor.Error('forbidden', 'Not your clock event');

    if (action === 'agree') {
      const modified = await ClockEvents.updateAsync(
        { _id: event._id, endTime: null },
        { $set: { shiftReminderResponse: 'agreed' } }
      );
      if (modified === 0) throw new Meteor.Error('already-closed', 'Already clocked out');
      cancelClockJobsByName(clockEventId, 'shift-missed-clockout').catch(() => {});
    } else {
      const breaks = await findBreaksForEvent(clockEventId);
      const currentWorkSecs = computeWorkSeconds(event, breaks, Date.now());
      const modified = await ClockEvents.updateAsync(
        { _id: event._id, endTime: null },
        {
          $set: {
            shiftReminderResponse: 'disagreed',
            shiftAutoClockoutWorkSecs: null,
            shiftNextReminderWorkSecs: currentWorkSecs + 2 * 3600,
          },
        }
      );
      if (modified === 0) throw new Meteor.Error('already-closed', 'Already clocked out');
      cancelClockJobsByName(clockEventId, 'shift-missed-clockout').catch(() => {});
    }

    await notifications.deleteOne({ _id: new ObjectId(notificationId), userId });
    return { ok: true };
  },

  /** Team-wide clock status: all member clock states + today's hours. */
  async 'clock.teamStatus'({ teamId } = {}) {
    try {
      console.log('[clock.teamStatus] called with teamId:', teamId);
      const identity = await requireIdentity(this);
      const userId = identity.userId;
      console.log('[clock.teamStatus] identity resolved:', userId);

      if (!isValidId(teamId)) throw new Meteor.Error('not-found', 'Team not found');

    const team = await Teams.findOneAsync(new Mongo.ObjectID(teamId));
    if (!team) throw new Meteor.Error('not-found', 'Team not found');

    const allMemberIds = Array.from(new Set([...(team.members ?? []), ...(team.admins ?? [])]));
    if (!allMemberIds.includes(userId)) {
      throw new Meteor.Error('forbidden', 'Forbidden');
    }

    // Get today's start (UTC midnight)
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const todayStartMs = todayStart.getTime();
    const now = Date.now();

    // Get today's clock events for all members
    const clockEvents = await ClockEvents.find({
      userId: { $in: allMemberIds },
      teamId,
      startTime: { $gte: todayStartMs },
    }).fetchAsync();

    // Load all breaks for today's events
    const eventIds = clockEvents.map((e) => e._id.toHexString());
    const allBreaks = eventIds.length > 0 ? await findBreaksForEvents(eventIds) : [];
    const breaksByEventId = new Map();
    for (const b of allBreaks) {
      const arr = breaksByEventId.get(b.clockEventId) ?? [];
      arr.push(b);
      breaksByEventId.set(b.clockEventId, arr);
    }

    // Resolve display names using userDisplayName helper
    const namePromises = allMemberIds.map((memberId) => userDisplayName(memberId));
    const names = await Promise.all(namePromises);
    const nameMap = new Map();
    allMemberIds.forEach((memberId, i) => {
      nameMap.set(memberId, names[i]);
    });

    // All users are now in Meteor users collection
    const meteorUsers = allMemberIds.length > 0
      ? await rawDb().collection('users').find({ _id: { $in: allMemberIds } }).project({ image: 1, username: 1 }).toArray()
      : [];

    const meteorImageMap = new Map(meteorUsers.map((u) => [String(u._id), u.image ?? null]));
    const meteorUsernameMap = new Map(meteorUsers.map((u) => [String(u._id), u.username ?? null]));

    // Group clock events by userId
    const eventsByUser = new Map();
    for (const ev of clockEvents) {
      if (!eventsByUser.has(ev.userId)) eventsByUser.set(ev.userId, []);
      eventsByUser.get(ev.userId).push(ev);
    }

    const members = allMemberIds.map((memberId) => {
      const name = nameMap.get(memberId) ?? 'Unknown';
      const image = meteorImageMap.get(memberId) ?? null;
      const username = meteorUsernameMap.get(memberId) ?? null;

      const userEvents = eventsByUser.get(memberId) ?? [];
      const activeEvent = userEvents.find((e) => e.endTime === null) ?? null;
      const isClockedIn = activeEvent !== null;
      const activeBreaks = activeEvent
        ? (breaksByEventId.get(activeEvent._id.toHexString()) ?? [])
        : [];
      const isOnBreak = activeBreaks.some((b) => b.endTime === null);

      // Sum today's work seconds
      let todaySeconds = 0;
      for (const ev of userEvents) {
        const breaks = breaksByEventId.get(ev._id.toHexString()) ?? [];
        todaySeconds += computeWorkSeconds(ev, breaks, now);
      }

      return {
        userId: memberId,
        name,
        username,
        image,
        isClockedIn,
        isOnBreak,
        activeClockStart: activeEvent?.startTime ?? null,
        todaySeconds,
      };
    });

    console.log('[clock.teamStatus] returning', members.length, 'members');
    return { members };
    } catch (err) {
      console.error('[clock.teamStatus] ERROR:', err.message, err.stack);
      throw err;
    }
  },
});

/**
 * Reactive live-shift stream for one or more teams ("who is clocked in now").
 * Replaces the /v1/clock/ws WebSocket fan-out: oplog-backed cursor pushes
 * clock-ins/outs from ANY writer (Meteor, Agenda auto-clockout).
 */
Meteor.publish('clock.liveForTeams', async function (teamIds) {
  if (!this.userId) return this.ready();
  const userId = this.userId;
  if (!Array.isArray(teamIds) || teamIds.length === 0) return this.ready();

  const memberTeams = await Teams.find({
    _id: { $in: teamIds.filter(isValidId).map((id) => new Mongo.ObjectID(id)) },
    $or: [{ members: userId }, { admins: userId }],
  }).fetchAsync();
  const allowedIds = memberTeams.map((t) => t._id.toHexString());
  if (!allowedIds.length) return this.ready();

  return ClockEvents.find({ teamId: { $in: allowedIds }, endTime: null });
});

/**
 * The caller's own open shifts, every team — at most one per team. Drives the
 * per-team clock in every tab and on every device, whatever team each has
 * selected; `clock.liveForTeams` stays for team views (who's in).
 */
Meteor.publish('clock.liveOpenShifts', function () {
  if (!this.userId) return this.ready();
  return ClockEvents.find({ userId: this.userId, endTime: null });
});

/**
 * Real-time clock events for a specific user's timesheet.
 * Publishes ALL clock events (completed and active) for the target user.
 * Used by personal TimesheetPage and AdminTimesheetPanel.
 */
Meteor.publish('clock.liveForUser', async function (targetUserId) {
  if (!this.userId) return this.ready();
  if (!isValidId(targetUserId)) return this.ready();

  // Allow viewing own timesheet, or if user is admin of any team the target is in
  if (this.userId === targetUserId) {
    return ClockEvents.find({ userId: targetUserId });
  }

  // Check if current user is admin of any team that targetUser is in
  const targetUserTeams = await Teams.find({
    $or: [{ members: targetUserId }, { admins: targetUserId }],
  }).fetchAsync();
  const targetTeamIds = targetUserTeams.map((t) => t._id.toHexString());

  const adminTeams = await Teams.find({
    _id: { $in: targetUserTeams.map((t) => t._id) },
    admins: this.userId,
  }).fetchAsync();

  if (adminTeams.length === 0) return this.ready();

  // User is admin of at least one team that target user is in
  return ClockEvents.find({ userId: targetUserId });
});
