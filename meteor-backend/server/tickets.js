/**
 * Tickets — PoC port of the core of backend/src/services/ticket.service.ts.
 *
 * Scope (deliberate): membership-checked reads/writes on the shared `tickets`
 * collection only. Side effects (activity log, notifications, CASL fine-grained
 * rules) remain in the Fastify backend; oplog reactivity means Fastify-written
 * changes still appear live through the publication below.
 */
import { Meteor } from 'meteor/meteor';
import { Mongo } from 'meteor/mongo';
import { Tickets, Teams, isValidId } from './collections';
import { requireIdentity, identityForConnection } from './auth-bridge';

const ALL_STATUSES = ['open', 'in-progress', 'blocked', 'reviewed', 'closed', 'deleted'];
const ALL_PRIORITIES = ['low', 'medium', 'high', 'critical'];

/** Throw unless the user is a member or admin of the team. Returns the team. */
async function requireTeamMembership(userId, teamId) {
  if (!isValidId(teamId)) throw new Meteor.Error('forbidden', 'Invalid team id');
  const team = await Teams.findOneAsync({
    _id: new Mongo.ObjectID(teamId),
    $or: [{ members: userId }, { admins: userId }],
  });
  if (!team) throw new Meteor.Error('forbidden', 'Not a member of this team');
  return team;
}

function toPublicTicket(doc) {
  const { _id, ...rest } = doc;
  return { id: _id.toHexString ? _id.toHexString() : String(_id), ...rest };
}

Meteor.methods({
  /** List non-deleted tickets for a team (newest first). */
  async 'tickets.list'({ teamId, sessionToken } = {}) {
    const identity = await requireIdentity(this, sessionToken);
    await requireTeamMembership(identity.userId, teamId);
    const docs = await Tickets.find(
      { teamId, status: { $ne: 'deleted' } },
      { sort: { createdAt: -1 } }
    ).fetchAsync();
    return docs.map(toPublicTicket);
  },

  /** Create a ticket. */
  async 'tickets.create'({ teamId, title, description, priority, sessionToken } = {}) {
    const identity = await requireIdentity(this, sessionToken);
    await requireTeamMembership(identity.userId, teamId);
    if (typeof title !== 'string' || !title.trim()) {
      throw new Meteor.Error('validation-error', 'title is required');
    }
    if (priority !== undefined && !ALL_PRIORITIES.includes(priority)) {
      throw new Meteor.Error('validation-error', `priority must be one of ${ALL_PRIORITIES.join(', ')}`);
    }
    const _id = await Tickets.insertAsync({
      teamId,
      title: title.trim(),
      ...(typeof description === 'string' ? { description } : {}),
      github: '',
      status: 'open',
      ...(priority ? { priority } : {}),
      createdBy: identity.userId,
      assignedTo: [],
      createdAt: new Date(),
    });
    const doc = await Tickets.findOneAsync(_id);
    return toPublicTicket(doc);
  },

  /** Update a ticket's status (and optionally priority). */
  async 'tickets.updateStatus'({ ticketId, status, priority, sessionToken } = {}) {
    const identity = await requireIdentity(this, sessionToken);
    if (!isValidId(ticketId)) throw new Meteor.Error('not-found', 'Invalid ticket id');
    const ticket = await Tickets.findOneAsync(new Mongo.ObjectID(ticketId));
    if (!ticket) throw new Meteor.Error('not-found', 'Ticket not found');
    await requireTeamMembership(identity.userId, ticket.teamId);
    if (status !== undefined && !ALL_STATUSES.includes(status)) {
      throw new Meteor.Error('validation-error', `status must be one of ${ALL_STATUSES.join(', ')}`);
    }
    if (priority !== undefined && !ALL_PRIORITIES.includes(priority)) {
      throw new Meteor.Error('validation-error', `priority must be one of ${ALL_PRIORITIES.join(', ')}`);
    }
    const $set = {
      ...(status !== undefined ? { status } : {}),
      ...(priority !== undefined ? { priority } : {}),
      updatedBy: identity.userId,
      updatedAt: new Date(),
    };
    await Tickets.updateAsync(new Mongo.ObjectID(ticketId), { $set });
    const updated = await Tickets.findOneAsync(new Mongo.ObjectID(ticketId));
    return toPublicTicket(updated);
  },
});

/**
 * Reactive ticket stream for one or more teams.
 * Replaces the hand-built WebSocket fan-out in backend/src/routes/tickets-ws.ts:
 * the cursor is oplog-backed, so any write (Meteor, Fastify, or mongosh) is
 * pushed to subscribers automatically.
 */
Meteor.publish('tickets.byTeam', async function (teamIds) {
  const identity = identityForConnection(this.connection);
  if (!identity) return this.ready();
  if (!Array.isArray(teamIds) || teamIds.length === 0) return this.ready();

  // Only publish teams the user actually belongs to.
  const memberTeams = await Teams.find({
    _id: { $in: teamIds.filter(isValidId).map((id) => new Mongo.ObjectID(id)) },
    $or: [{ members: identity.userId }, { admins: identity.userId }],
  }).fetchAsync();
  const allowedIds = memberTeams.map((t) => t._id.toHexString());
  if (!allowedIds.length) return this.ready();

  return Tickets.find({ teamId: { $in: allowedIds }, status: { $ne: 'deleted' } });
});
