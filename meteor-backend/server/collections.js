/**
 * Shared Mongo collections — bound to the SAME database the Fastify backend uses.
 *
 * idGeneration 'MONGO' makes Meteor generate/expect ObjectId _ids, matching the
 * documents already created by the Fastify backend (native driver + Mongoose).
 *
 * Because Meteor tails the oplog of this shared database, writes made by the
 * Fastify backend appear reactively in any publication backed by these cursors.
 */
import { Mongo } from 'meteor/mongo';

export const Tickets = new Mongo.Collection('tickets', { idGeneration: 'MONGO' });
export const ClockEvents = new Mongo.Collection('clockevents', { idGeneration: 'MONGO' });
export const ClockBreaks = new Mongo.Collection('clockbreaks', { idGeneration: 'MONGO' });
export const Teams = new Mongo.Collection('teams', { idGeneration: 'MONGO' });
export const Timers = new Mongo.Collection('timers', { idGeneration: 'MONGO' });
export const Notifications = new Mongo.Collection('notifications', { idGeneration: 'MONGO' });
export const Messages = new Mongo.Collection('messages', { idGeneration: 'MONGO' });
export const Channels = new Mongo.Collection('channels', { idGeneration: 'MONGO' });
export const ChannelMessages = new Mongo.Collection('channelmessages', { idGeneration: 'MONGO' });
export const TeamJoinRequests = new Mongo.Collection('teamjoinrequests', { idGeneration: 'MONGO' });

/** Raw native-driver handle for collections we only read ad hoc (sessions, users). */
export function rawDb() {
  return Tickets.rawDatabase();
}

export function isValidId(id) {
  return typeof id === 'string' && /^[0-9a-f]{24}$/i.test(id);
}
