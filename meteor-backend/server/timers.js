/**
 * Timers — reactive live signal for the work-timer feature.
 *
 * During Fastify coexistence the timer mutations (create/start/stop/update/
 * delete) and the day/week reads stay on the Fastify REST API. This module
 * only replaces the `/v1/timers/ws` "something changed, refetch" ping with an
 * oplog-backed DDP publication, exactly as `clock.liveForTeams` replaced the
 * clock WS.
 *
 * Publishing the user's RUNNING timers (`endTime: null`) is enough to drive the
 * refetch: a start inserts a running doc, a stop closes it (drops out of the
 * cursor → removed), and deleting a running entry removes it — every case the
 * old WS pinged on. The frontend listens for `timers` collection changes and
 * refetches the day/week via REST, keeping reads on Fastify for now.
 */
import { Meteor } from 'meteor/meteor';
import { Timers } from './collections';

Meteor.publish('timers.liveForUser', function () {
  if (!this.userId) return this.ready();
  const userId = this.userId;
  return Timers.find({ userId: userId, endTime: null });
});
