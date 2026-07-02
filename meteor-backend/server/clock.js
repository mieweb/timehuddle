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
 * `clock.liveForTeams` / `timers.liveForUser` / `notifications.liveForUser`
 * publications fan out automatically — no WebSocket/SSE broadcast needed.
 */
import { Meteor } from 'meteor/meteor';
import { Mongo, MongoInternals } from 'meteor/mongo';
import { ClockEvents, ClockBreaks, Teams, isValidId, rawDb } from './collections';
import { requireIdentity, findUserById } from './auth-bridge';
import { requireTeamMembership } from './permissions';
import {
  toPublicClockEvent,
  classifyBreak,
  computeDeductedBreakSeconds,
  computeWorkSeconds,
  computeTotalBreakSeconds,
  findBreaksForEvent,
  findBreaksForEvents,
  toBreakEntries,
  normalizeBreakEntries,
} from './clock-core';
import {
  closeAllForUser,
  closeRunningForUser,
  findClosedAtTime,
  restartTimerForWorkItem,
} from './timer-core';
import { createNotification, notifyClockAdmins, userDisplayName } from './notify-core';
import { emitActivity, ActivityType } from './activity-core';
import {
  scheduleClockJobs,
  rescheduleClockJobs,
  scheduleAutoClockout,
  cancelClockJobs,
  cancelClockJobsByName,
} from './agenda';

const { ObjectId } = MongoInternals.NpmModules.mongodb.module;
const oid = (hex) => new Mongo.ObjectID(hex);

/** Load one team the user belongs to (member or admin), or null. */
async function findUserTeam(userId, teamId) {
  if (!isValidId(teamId)) return null;
  return Teams.findOneAsync({
    _id: oid(teamId),
    $or: [{ members: userId }, { admins: userId }],
  });
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

  /** The caller's active clock event across any team, or null (frontend getActive). */
  async 'clock.activeForUser'() {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    const event = await ClockEvents.findOneAsync({ userId, endTime: null });
    if (!event) return null;
    const breaks = await findBreaksForEvent(event._id.toHexString());
    return toPublicClockEvent(event, breaks);
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

  /** Clock in: close any dangling open events, open a new one, fire side-effects. */
  async 'clock.start'({ teamId } = {}) {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    const team = await findUserTeam(userId, teamId);
    if (!team) throw new Meteor.Error('forbidden', 'Not a member of this team');

    const now = Date.now();
    await ClockEvents.updateAsync(
      { userId, teamId, endTime: null },
      { $set: { endTime: now } },
      { multi: true }
    );

    const _id = await ClockEvents.insertAsync({
      userId,
      teamId,
      startTime: now,
      accumulatedTime: 0,
      autoClockoutAgreed: null,
      endTime: null,
    });
    const created = await ClockEvents.findOneAsync(_id);
    const pub = toPublicClockEvent(created, []);

    // Schedule 4h break reminder + 7h45m shift-end reminder.
    scheduleClockJobs(created._id.toHexString(), userId, teamId, now).catch((err) =>
      console.error('[agenda] scheduleClockJobs failed:', err)
    );

    const userName = await userDisplayName(userId);
    const notifyAdmins = (team.admins ?? []).filter((id) => id !== userId);
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
            url: `/app/profile/${userId}?tab=work`,
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

  /** Clock out: cancel jobs, close timers + open break, recompute, notify, log. */
  async 'clock.stop'({ teamId } = {}) {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    const event = await ClockEvents.findOneAsync({ userId, teamId, endTime: null });
    if (!event) throw new Meteor.Error('not-found', 'No active clock event');

    const now = Date.now();
    const eventId = event._id.toHexString();

    cancelClockJobs(eventId).catch((err) =>
      console.error('[agenda] cancelClockJobs failed:', err)
    );

    // Close any running timer sessions for this user.
    await closeAllForUser(userId, now);

    // Close any open break with auto-classification.
    const breaks = await findBreaksForEvent(eventId);
    const openBreak = breaks.find((b) => b.endTime === null);
    if (openBreak) {
      const durationSeconds = Math.floor((now - openBreak.startTime) / 1000);
      await ClockBreaks.updateAsync(openBreak._id, {
        $set: { endTime: now, ...classifyBreak(durationSeconds) },
      });
    }

    const closedBreaks = await findBreaksForEvent(eventId);
    const shiftSpan = Math.floor((now - event.startTime) / 1000);
    const deducted = computeDeductedBreakSeconds(closedBreaks, now);
    const finalAccumulatedTime = Math.max(0, shiftSpan - deducted);

    await ClockEvents.updateAsync(event._id, {
      $set: { endTime: now, accumulatedTime: finalAccumulatedTime },
    });
    const updated = await ClockEvents.findOneAsync(event._id);
    const pub = toPublicClockEvent(updated, closedBreaks);

    const team = await findUserTeam(userId, teamId);
    if (team) {
      const userName = await userDisplayName(userId);
      const totalSecs = pub.accumulatedTime ?? 0;
      const h = Math.floor(totalSecs / 3600);
      const m = Math.floor((totalSecs % 3600) / 60);
      const durationText = h > 0 ? `${h}h ${m}m` : `${m}m`;
      const notifyAdmins = (team.admins ?? []).filter((id) => id !== userId);
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
              url: `/app/profile/${userId}?tab=work`,
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
          url: `/app/profile/${userId}?tab=work`,
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
    await closeRunningForUser(userId, now);
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
    const closedTimer = await findClosedAtTime(userId, openBreak.startTime);
    if (closedTimer) {
      await restartTimerForWorkItem(userId, closedTimer.workItemId, now);
    }

    return toPublicClockEvent(event, updatedBreaks);
  },

  /** Update a clock event's timestamps and optional break intervals. */
  async 'clock.updateTimes'({ clockEventId, startTime, endTime, breaks } = {}) {
    const identity = await requireIdentity(this);
    const requesterId = identity.userId;
    if (!isValidId(clockEventId)) throw new Meteor.Error('not-found', 'Clock event not found');
    const event = await ClockEvents.findOneAsync(oid(clockEventId));
    if (!event) throw new Meteor.Error('not-found', 'Clock event not found');

    if (event.userId !== requesterId) {
      const adminTeam = await Teams.findOneAsync({ _id: oid(event.teamId), admins: requesterId });
      if (!adminTeam) throw new Meteor.Error('forbidden', 'Not allowed to edit this event');
    }

    const effectiveStart = typeof startTime === 'number' ? startTime : event.startTime;
    const effectiveEnd =
      endTime === null ? null : typeof endTime === 'number' ? endTime : event.endTime;
    if (effectiveEnd !== null && effectiveEnd < effectiveStart) {
      throw new Meteor.Error('invalid-range', 'End is before start');
    }

    const existingBreaks = await findBreaksForEvent(clockEventId);
    const requestedBreaks = Array.isArray(breaks) ? toBreakEntries(breaks) : existingBreaks;
    const normalizedBreaks = normalizeBreakEntries(requestedBreaks, effectiveStart, effectiveEnd);

    const classifiedBreaks = normalizedBreaks.map((b) => {
      if (b.endTime === null || b.type !== undefined) return b;
      const durationSeconds = Math.floor((b.endTime - b.startTime) / 1000);
      return { ...b, ...classifyBreak(durationSeconds) };
    });

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
    const updatedBreaks = await findBreaksForEvent(clockEventId);
    if (updated) {
      notifyClockAdmins(requesterId, event.teamId, updated.startTime, 'updated').catch((err) =>
        console.error('[clock] notify admins failed:', err)
      );
    }
    if (!updated) throw new Meteor.Error('not-found', 'Clock event not found');
    return toPublicClockEvent(updated, updatedBreaks);
  },

  /** Delete a clock event (owner or team admin). */
  async 'clock.deleteEvent'({ clockEventId } = {}) {
    const identity = await requireIdentity(this);
    const requesterId = identity.userId;
    if (!isValidId(clockEventId)) throw new Meteor.Error('not-found', 'Clock event not found');
    const event = await ClockEvents.findOneAsync(oid(clockEventId));
    if (!event) throw new Meteor.Error('not-found', 'Clock event not found');

    if (event.userId !== requesterId) {
      const adminTeam = await Teams.findOneAsync({ _id: oid(event.teamId), admins: requesterId });
      if (!adminTeam) throw new Meteor.Error('forbidden', 'Not allowed to delete this event');
    }

    await ClockEvents.removeAsync(event._id);
    cancelClockJobs(clockEventId).catch((err) =>
      console.error('[agenda] cancelClockJobs on delete failed:', err)
    );
    await ClockBreaks.removeAsync({ clockEventId });
    await rawDb()
      .collection('attachments')
      .deleteMany({ 'attachedTo.kind': 'clock', 'attachedTo.id': clockEventId });

    notifyClockAdmins(requesterId, event.teamId, event.startTime, 'deleted').catch((err) =>
      console.error('[clock] notify admins failed:', err)
    );

    return { ok: true };
  },

  /** Create a completed clock event for a past time range (manual backfill). */
  async 'clock.createManual'({ teamId, startTime, endTime } = {}) {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    const team = await findUserTeam(userId, teamId);
    if (!team) throw new Meteor.Error('forbidden', 'Not a member of this team');

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
    if (overlapping) throw new Meteor.Error('overlap', 'This entry overlaps an existing clock session');

    const accumulatedTime = Math.floor((endTime - startTime) / 1000);
    const _id = await ClockEvents.insertAsync({
      userId,
      teamId,
      startTime,
      accumulatedTime,
      endTime,
    });
    const created = await ClockEvents.findOneAsync(_id);
    notifyClockAdmins(userId, teamId, startTime, 'added').catch((err) =>
      console.error('[clock] notify admins failed:', err)
    );
    return toPublicClockEvent(created, []);
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

    const now = Date.now();
    const sessions = events
      .map((e) => toPublicClockEvent(e, breaksByEventId.get(e._id.toHexString()) ?? []))
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
    const identity = await requireIdentity(this);
    const userId = identity.userId;

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

    // Resolve images: Meteor users (string _id) vs legacy ObjectId users
    const meteorIds = allMemberIds.filter((id) => !/^[0-9a-f]{24}$/i.test(id));
    const legacyIds = allMemberIds.filter((id) => /^[0-9a-f]{24}$/i.test(id));

    // Query all users from Meteor users collection
    const allUserIds = [...meteorIds, ...legacyIds].filter(id => id);
    const users = allUserIds.length > 0
      ? await rawDb().collection('users').find({ _id: { $in: allUserIds.map(String) } }).project({ image: 1 }).toArray()
      : [];

    const meteorImageMap = new Map(users.map((u) => [String(u._id), u.image ?? null]));
    const legacyImageMap = new Map(legacyUsers.map((u) => [u._id.toHexString(), u.image ?? null]));

    // Group clock events by userId
    const eventsByUser = new Map();
    for (const ev of clockEvents) {
      if (!eventsByUser.has(ev.userId)) eventsByUser.set(ev.userId, []);
      eventsByUser.get(ev.userId).push(ev);
    }

    const members = allMemberIds.map((memberId) => {
      const name = nameMap.get(memberId) ?? 'Unknown';
      const image = meteorImageMap.get(memberId) ?? legacyImageMap.get(memberId) ?? null;

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
        image,
        isClockedIn,
        isOnBreak,
        activeClockStart: activeEvent?.startTime ?? null,
        todaySeconds,
      };
    });

    return { members };
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
