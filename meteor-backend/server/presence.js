import { Meteor } from 'meteor/meteor';
import { requireTeamMembership } from './permissions';

const TIMEOUT_MS = 75_000;

const onlineTimers = new Map();
const listeners = new Set();

function broadcast(userId, isOnline) {
  for (const fn of listeners) fn(userId, isOnline);
}

function markOnline(userId) {
  const existing = onlineTimers.get(userId);
  if (existing) clearTimeout(existing);
  const wasOnline = onlineTimers.has(userId);
  const timer = setTimeout(() => {
    onlineTimers.delete(userId);
    broadcast(userId, false);
  }, TIMEOUT_MS);
  onlineTimers.set(userId, timer);
  if (!wasOnline) broadcast(userId, true);
}

function markOffline(userId) {
  const existing = onlineTimers.get(userId);
  if (!existing) return;
  clearTimeout(existing);
  onlineTimers.delete(userId);
  broadcast(userId, false);
}

function isOnline(userId) {
  return onlineTimers.has(userId);
}

Meteor.publish('presence.watch', function (watchIds) {
  if (!this.userId) return this.ready();
  const userId = this.userId;
  markOnline(userId);

  for (const id of watchIds) {
    this.added('presence', id, { online: onlineTimers.has(id) });
  }
  this.ready();

  const watchSet = new Set(watchIds);

  const onChange = (changedId, online) => {
    if (!watchSet.has(changedId)) return;
    this.changed('presence', changedId, { online });
  };
  listeners.add(onChange);

  const heartbeat = setInterval(() => markOnline(userId), 30_000);

  this.onStop(() => {
    listeners.delete(onChange);
    clearInterval(heartbeat);
    markOffline(userId);
  });
});

// ─── Huddle viewing (#784) ────────────────────────────────────────────────────
//
// Who has a team's Huddle open in a visible tab, so a push about that team can
// be skipped for someone already looking at it. The Huddle page holds this
// no-data subscription only while its tab is visible.
//
// In memory, per server process: one instance per app today. If an app ever
// runs several instances behind a load balancer, move this to a Mongo
// collection with a TTL index, or a viewer on one instance is invisible to
// notifications sent from another.

/** userId → (teamId → number of open subscriptions, one per visible tab). */
const viewing = new Map();

function adjustViewing(userId, teamId, delta) {
  const teams = viewing.get(userId) ?? new Map();
  const count = (teams.get(teamId) ?? 0) + delta;
  if (count > 0) teams.set(teamId, count);
  else teams.delete(teamId);
  if (teams.size > 0) viewing.set(userId, teams);
  else viewing.delete(userId);
}

/** Whether `userId` has `teamId`'s Huddle open in a visible tab right now. */
export function isViewingTeam(userId, teamId) {
  return (viewing.get(userId)?.get(String(teamId)) ?? 0) > 0;
}

Meteor.publish('huddle.viewing', async function (teamId) {
  if (!this.userId || typeof teamId !== 'string') return this.ready();
  try {
    await requireTeamMembership(this.userId, teamId);
  } catch {
    return this.ready();
  }
  const userId = this.userId;
  adjustViewing(userId, teamId, 1);
  this.onStop(() => adjustViewing(userId, teamId, -1));
  this.ready();
});
