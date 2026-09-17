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
export const TeamJoinRequests = new Mongo.Collection('teamjoinrequests', { idGeneration: 'MONGO' });
export const WorkItems = new Mongo.Collection('workitems', { idGeneration: 'MONGO' });
export const MediaItems = new Mongo.Collection('mediaitems', { idGeneration: 'MONGO' });
export const OrgMembers = new Mongo.Collection('org_members', { idGeneration: 'MONGO' });
export const HuddlePosts = new Mongo.Collection('huddlePosts', { idGeneration: 'MONGO' });
export const TimesheetChangeRequests = new Mongo.Collection('timesheetchangerequests', {
  idGeneration: 'MONGO',
});

// One row per TimeHuddle user who has linked a personal Redmine account.
// The personal API key is stored encrypted at rest (see redmine-crypto.js) and
// is never returned to the client.
export const RedmineLinks = new Mongo.Collection('redmine_links', { idGeneration: 'MONGO' });
// One row per (user, ticket) a user has added to their personal "My Board".
// Identity only — { userId, sourceId, ticketId, addedAt } — no title/status
// snapshot. Display fields are resolved client-side against already-fetched
// unified tickets (Core Model Data Discipline).
export const MyBoard = new Mongo.Collection('my_board', { idGeneration: 'MONGO' });

/** Raw native-driver handle for collections we only read ad hoc (sessions, users). */
export function rawDb() {
  return Tickets.rawDatabase();
}

export function isValidId(id) {
  if (typeof id !== 'string') return false;
  return /^[0-9a-f]{24}$/i.test(id) || /^[a-zA-Z0-9]{7,32}$/.test(id);
}
