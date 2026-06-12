/**
 * Clock — PoC port of the core of backend/src/services/clock.service.ts.
 *
 * Scope (deliberate): clock in/out and live-shift reads on the shared
 * `clockevents` / `clockbreaks` collections. The production side-effect
 * pipeline (admin notifications, Agenda reminders, activity log, timer
 * close-out) remains in the Fastify backend. Break math is ported verbatim so
 * accumulatedTime stays consistent with Fastify-written events.
 */
import { Meteor } from 'meteor/meteor';
import { Mongo } from 'meteor/mongo';
import { ClockEvents, ClockBreaks, Teams, isValidId } from './collections';
import { requireIdentity, identityForConnection } from './auth-bridge';

/** 20-minute threshold: breaks >= this are non-compensable meal breaks (deducted). */
const MEAL_BREAK_THRESHOLD_SECONDS = 20 * 60;

function classifyBreak(durationSeconds) {
  return {
    type: durationSeconds >= MEAL_BREAK_THRESHOLD_SECONDS ? 'meal' : 'rest',
    classificationSource: 'auto',
  };
}

/** Mirror of computeDeductedBreakSeconds in backend clock.service.ts. */
function computeDeductedBreakSeconds(breaks, now) {
  return breaks.reduce((sum, b) => {
    const end = typeof b.endTime === 'number' ? b.endTime : now;
    if (end <= b.startTime) return sum;
    const durationSeconds = Math.floor((end - b.startTime) / 1000);
    if (typeof b.endTime === 'number') {
      return b.type === 'rest' ? sum : sum + durationSeconds;
    }
    return durationSeconds >= MEAL_BREAK_THRESHOLD_SECONDS ? sum + durationSeconds : sum;
  }, 0);
}

async function requireTeamMembership(userId, teamId) {
  if (!isValidId(teamId)) throw new Meteor.Error('forbidden', 'Invalid team id');
  const team = await Teams.findOneAsync({
    _id: new Mongo.ObjectID(teamId),
    $or: [{ members: userId }, { admins: userId }],
  });
  if (!team) throw new Meteor.Error('forbidden', 'Not a member of this team');
  return team;
}

function toPublicEvent(doc) {
  const { _id, ...rest } = doc;
  return { id: _id.toHexString ? _id.toHexString() : String(_id), ...rest };
}

Meteor.methods({
  /** The caller's active clock event in a team, or null. */
  async 'clock.active'({ teamId, sessionToken } = {}) {
    const identity = await requireIdentity(this, sessionToken);
    await requireTeamMembership(identity.userId, teamId);
    const event = await ClockEvents.findOneAsync({ userId: identity.userId, teamId, endTime: null });
    return event ? toPublicEvent(event) : null;
  },

  /** Clock in: closes any dangling open events, then opens a new one. */
  async 'clock.start'({ teamId, sessionToken } = {}) {
    const identity = await requireIdentity(this, sessionToken);
    await requireTeamMembership(identity.userId, teamId);

    const now = Date.now();
    // Close any open events for this user+team (mirrors ClockService.start)
    const open = await ClockEvents.find({ userId: identity.userId, teamId, endTime: null }).fetchAsync();
    for (const e of open) {
      await ClockEvents.updateAsync(e._id, { $set: { endTime: now } });
    }

    const _id = await ClockEvents.insertAsync({
      userId: identity.userId,
      teamId,
      startTime: now,
      accumulatedTime: 0,
      autoClockoutAgreed: null,
      endTime: null,
    });
    const created = await ClockEvents.findOneAsync(_id);
    return toPublicEvent(created);
  },

  /** Clock out: closes open break, computes accumulatedTime (span minus meal breaks). */
  async 'clock.stop'({ teamId, sessionToken } = {}) {
    const identity = await requireIdentity(this, sessionToken);
    const event = await ClockEvents.findOneAsync({ userId: identity.userId, teamId, endTime: null });
    if (!event) throw new Meteor.Error('not-found', 'No active clock event');

    const now = Date.now();
    const eventId = event._id.toHexString();

    // Close any open break with auto-classification (mirrors ClockService.stop)
    const openBreak = await ClockBreaks.findOneAsync({ clockEventId: eventId, endTime: null });
    if (openBreak) {
      const durationSeconds = Math.floor((now - openBreak.startTime) / 1000);
      await ClockBreaks.updateAsync(openBreak._id, {
        $set: { endTime: now, ...classifyBreak(durationSeconds) },
      });
    }

    const breaks = await ClockBreaks.find(
      { clockEventId: eventId },
      { sort: { startTime: 1 } }
    ).fetchAsync();

    const shiftSpan = Math.floor((now - event.startTime) / 1000);
    const deducted = computeDeductedBreakSeconds(breaks, now);
    const accumulatedTime = Math.max(0, shiftSpan - deducted);

    await ClockEvents.updateAsync(event._id, { $set: { endTime: now, accumulatedTime } });
    const updated = await ClockEvents.findOneAsync(event._id);
    return toPublicEvent(updated);
  },
});

/**
 * Reactive live-shift stream for one or more teams ("who is clocked in now").
 * Replaces the /v1/clock/ws WebSocket fan-out: oplog-backed cursor pushes
 * clock-ins/outs from ANY writer (Meteor, Fastify, Agenda auto-clockout).
 */
Meteor.publish('clock.liveForTeams', async function (teamIds) {
  const identity = identityForConnection(this.connection);
  if (!identity) return this.ready();
  if (!Array.isArray(teamIds) || teamIds.length === 0) return this.ready();

  const memberTeams = await Teams.find({
    _id: { $in: teamIds.filter(isValidId).map((id) => new Mongo.ObjectID(id)) },
    $or: [{ members: identity.userId }, { admins: identity.userId }],
  }).fetchAsync();
  const allowedIds = memberTeams.map((t) => t._id.toHexString());
  if (!allowedIds.length) return this.ready();

  return ClockEvents.find({ teamId: { $in: allowedIds }, endTime: null });
});
