/**
 * Notifications — reactive inbox publication for the current user.
 *
 * During Fastify coexistence, Fastify remains the notification *writer* (team
 * invites, messages, shift reminders) and owns push fan-out. This module only
 * replaces the `/v1/notifications/ws` SSE-style stream with an oplog-backed DDP
 * publication, mirroring `clock.liveForTeams` and `timers.liveForUser`.
 *
 * Publishing the user's recent inbox (newest first, capped) lets the frontend
 * react to every new notification — whether written by Fastify, the Meteor
 * agenda processor, or mongosh — without polling. Mutations (mark read, delete,
 * invite/shift responses) stay on Fastify REST for now.
 */
import { Meteor } from 'meteor/meteor';
import { Notifications } from './collections';
import { identityForConnection } from './auth-bridge';

const INBOX_LIMIT = 200;

Meteor.publish('notifications.liveForUser', function () {
  const identity = identityForConnection(this.connection);
  if (!identity) return this.ready();
  return Notifications.find(
    { userId: identity.userId },
    { sort: { createdAt: -1 }, limit: INBOX_LIMIT }
  );
});
