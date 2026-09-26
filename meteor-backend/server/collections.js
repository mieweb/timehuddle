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
// One row per (user, Redmine issue, day) — the exact grain of a Redmine "Spent
// time" entry, holding the remote entry id so a re-sync updates rather than
// duplicates.
//
// Deliberately NOT a field on WorkItems: `timers.copyPrevious` dedupes on a
// signature that includes `note` and `sortOrder`, so sibling WorkItem rows for
// the same user + source + ticket + date legitimately exist. Two siblings would
// each carry their own entry id and produce two Redmine entries for one day,
// which is the single invariant the sync is judged on. A unique index here
// enforces the grain that WorkItems cannot (see redmine-time-sync.js).
export const RedmineTimeSyncs = new Mongo.Collection('redmine_time_syncs', { idGeneration: 'MONGO' });
// One row per (user, Redmine issue) the user has pinned or dismissed — TimeHuddle's
// own opinion about a Redmine issue, which Redmine has no field for.
//
// Ids, a state, a boolean and a date. No subject, no project, no description:
// the whole point of MVP2 is that issue content never lands in TimeHuddle, and a
// cached title here would be both a PHI store and a stale one (Core Model Data
// Discipline — titles are resolved at read time through `listIssuesByIds`).
//
// A dismissal expires on its own after 15 days, enforced twice: a TTL index so
// the rows really go, and a read-time filter because Mongo's TTL sweeper runs
// only about once a minute and "15 days" should not mean "15 days and a bit".
export const RedmineIssuePrefs = new Mongo.Collection('redmine_issue_prefs', {
  idGeneration: 'MONGO',
});

/** Raw native-driver handle for collections we only read ad hoc (sessions, users). */
export function rawDb() {
  return Tickets.rawDatabase();
}

export function isValidId(id) {
  if (typeof id !== 'string') return false;
  return /^[0-9a-f]{24}$/i.test(id) || /^[a-zA-Z0-9]{7,32}$/.test(id);
}
