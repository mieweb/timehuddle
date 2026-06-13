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
import { ClockEvents, Teams, isValidId } from './collections';
import { requireIdentity, identityForConnection } from './auth-bridge';
import { requireTeamMembership } from './permissions';
import { toPublicEvent, stopActiveClock } from './clock-core';

Meteor.methods({
  /** The caller's active clock event in a team, or null. */
  async 'clock.active'({ teamId } = {}) {
    const identity = await requireIdentity(this);
    await requireTeamMembership(identity.userId, teamId);
    const event = await ClockEvents.findOneAsync({ userId: identity.userId, teamId, endTime: null });
    return event ? toPublicEvent(event) : null;
  },

  /** Clock in: closes any dangling open events, then opens a new one. */
  async 'clock.start'({ teamId } = {}) {
    const identity = await requireIdentity(this);
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
  async 'clock.stop'({ teamId } = {}) {
    const identity = await requireIdentity(this);
    const updated = await stopActiveClock(identity.userId, teamId);
    if (!updated) throw new Meteor.Error('not-found', 'No active clock event');
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
