import { Meteor } from 'meteor/meteor';
import { identityForConnection } from './auth-bridge';

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
  const identity = identityForConnection(this.connection);
  if (!identity) return this.ready();

  const userId = identity.userId;
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
