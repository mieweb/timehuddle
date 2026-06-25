/**
 * Tickets — PoC port of the core of backend/src/services/ticket.service.ts.
 *
 * Scope (deliberate): membership-checked reads/writes on the shared `tickets`
 * collection only. Authorization uses the CASL ability port in
 * ./permissions.js for parity with the Fastify backend. Other side effects
 * (activity log, notifications) still run in Fastify; oplog reactivity means
 * Fastify-written changes appear live through the publication below.
 */
import { Meteor } from 'meteor/meteor';
import { Mongo } from 'meteor/mongo';
import { MongoInternals } from 'meteor/mongo';
import { Tickets, Teams, isValidId, rawDb } from './collections';
import { requireIdentity } from './auth-bridge';
import { requireTeamMembership, requireTicketPermission } from './permissions';
import { createNotification, userDisplayName } from './notify-core';

const { ObjectId } = MongoInternals.NpmModules.mongodb.module;

const ALL_STATUSES = ['open', 'in-progress', 'blocked', 'reviewed', 'closed', 'deleted'];
const ALL_PRIORITIES = ['low', 'medium', 'high', 'critical'];

/** Mirror of backend activity.service.ts getActor(). */
async function getActor(userId) {
  const user = isValidId(userId)
    ? await rawDb().collection('user').findOne({ _id: new ObjectId(userId) })
    : null;
  return { id: userId, name: user?.name ?? user?.email?.split('@')[0] ?? 'Someone' };
}

/**
 * Mirror of backend emitActivity(): fire-and-forget insert into the shared
 * `activities` collection. Errors are swallowed — activity logging must never
 * break callers.
 */
async function emitTicketActivity(userId, teamId, type, payload) {
  try {
    const actor = await getActor(userId);
    await rawDb().collection('activities').insertOne({
      _id: new ObjectId(),
      userId,
      teamId,
      type,
      actor,
      payload,
      occurredAt: new Date(),
      source: 'timehuddle',
    });
  } catch {
    // intentionally silent
  }
}

/** Convert a stored ticket document into the API/DDP shape (hex id). */
function toPublicTicket(doc) {
  const { _id, ...rest } = doc;
  return { id: _id.toHexString ? _id.toHexString() : String(_id), ...rest };
}

Meteor.methods({
  /** List non-deleted tickets for a team (newest first). */
  async 'tickets.list'({ teamId } = {}) {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    await requireTeamMembership(userId, teamId);
    const docs = await Tickets.find(
      { teamId, status: { $ne: 'deleted' } },
      { sort: { createdAt: -1 } }
    ).fetchAsync();
    return docs.map(toPublicTicket);
  },

  /** Get a single ticket by ID. */
  async 'tickets.get'({ ticketId } = {}) {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    const ticket = await requireTicketPermission(userId, ticketId, 'read');
    return toPublicTicket(ticket);
  },

  /** Create a ticket. Mirrors TicketService.create (creator auto-assigned). */
  async 'tickets.create'({ teamId, title, description, github, priority } = {}) {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    await requireTeamMembership(userId, teamId);
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
      github: typeof github === 'string' ? github : '',
      status: 'open',
      ...(priority ? { priority } : {}),
      createdBy: identity.userId,
      assignedTo: [identity.userId],
      createdAt: new Date(),
    });
    const doc = await Tickets.findOneAsync(_id);
    await emitTicketActivity(identity.userId, teamId, 'ticket.created', {
      ticketId: doc._id.toHexString(),
      ticketTitle: doc.title,
      teamId,
    });
    return toPublicTicket(doc);
  },

  /** Update a ticket's status (and optionally priority). Reviewed sets reviewedBy/At. */
  async 'tickets.updateStatus'({ ticketId, status, priority } = {}) {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    const ticket = await requireTicketPermission(userId, ticketId, 'update');
    if (status !== undefined && !ALL_STATUSES.includes(status)) {
      throw new Meteor.Error('validation-error', `status must be one of ${ALL_STATUSES.join(', ')}`);
    }
    if (priority !== undefined && !ALL_PRIORITIES.includes(priority)) {
      throw new Meteor.Error('validation-error', `priority must be one of ${ALL_PRIORITIES.join(', ')}`);
    }
    const $set = {
      ...(status !== undefined ? { status } : {}),
      ...(priority !== undefined ? { priority } : {}),
      ...(status === 'reviewed' ? { reviewedBy: identity.userId, reviewedAt: new Date() } : {}),
      updatedBy: identity.userId,
      updatedAt: new Date(),
    };
    await Tickets.updateAsync(new Mongo.ObjectID(ticketId), { $set });
    const updated = await Tickets.findOneAsync(new Mongo.ObjectID(ticketId));
    const action =
      status && priority ? 'status-priority-changed' : status ? 'status-changed' : 'priority-changed';
    await emitTicketActivity(identity.userId, updated.teamId, 'ticket.updated', {
      ticketId,
      ticketTitle: updated.title,
      teamId: updated.teamId,
      action,
      ...(status ? { status } : {}),
      ...(priority ? { priority } : {}),
    });
    return toPublicTicket(updated);
  },

  /** Edit a ticket's title / github / description. Mirrors TicketService.update. */
  async 'tickets.update'({ ticketId, title, github, description } = {}) {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    const ticket = await requireTicketPermission(userId, ticketId, 'update');
    const $set = { updatedAt: new Date(), updatedBy: identity.userId };
    if (title !== undefined) {
      if (typeof title !== 'string' || !title.trim()) {
        throw new Meteor.Error('validation-error', 'title must be a non-empty string');
      }
      $set.title = title.trim();
    }
    if (github !== undefined) {
      if (typeof github !== 'string') throw new Meteor.Error('validation-error', 'github must be a string');
      $set.github = github;
    }
    if (description !== undefined) {
      if (typeof description !== 'string') {
        throw new Meteor.Error('validation-error', 'description must be a string');
      }
      $set.description = description;
    }
    await Tickets.updateAsync(new Mongo.ObjectID(ticketId), { $set });
    const updated = await Tickets.findOneAsync(new Mongo.ObjectID(ticketId));
    await emitTicketActivity(identity.userId, updated.teamId, 'ticket.updated', {
      ticketId,
      ticketTitle: updated.title,
      teamId: updated.teamId,
      action: 'edited',
    });
    return toPublicTicket(updated);
  },

  /** Soft-delete a ticket (status: deleted). Mirrors TicketService.delete. */
  async 'tickets.delete'({ ticketId } = {}) {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    const ticket = await requireTicketPermission(userId, ticketId, 'delete');
    await Tickets.updateAsync(new Mongo.ObjectID(ticketId), {
      $set: { status: 'deleted', updatedAt: new Date() },
    });
    await emitTicketActivity(identity.userId, ticket.teamId, 'ticket.updated', {
      ticketId,
      ticketTitle: ticket.title,
      teamId: ticket.teamId,
      action: 'deleted',
    });
    return { ok: true };
  },

  /**
   * Reassign a ticket to a set of team members.
   * Mirrors TicketService.assign EXCEPT assignee push/in-app notifications,
   * which remain in the Fastify backend (notification fan-out not yet ported).
   */
  async 'tickets.assign'({ ticketId, assignedToUserIds } = {}) {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    const ticket = await requireTicketPermission(userId, ticketId, 'assign');
    if (!Array.isArray(assignedToUserIds) || !assignedToUserIds.every((id) => isValidId(id))) {
      throw new Meteor.Error('validation-error', 'assignedToUserIds must be an array of user ids');
    }
    const team = await Teams.findOneAsync(new Mongo.ObjectID(ticket.teamId));
    if (!team) throw new Meteor.Error('forbidden', 'Team not found');
    const allMembers = [...new Set([...(team.members ?? []), ...(team.admins ?? [])])];
    for (const uid of assignedToUserIds) {
      if (!allMembers.includes(uid)) {
        throw new Meteor.Error('validation-error', 'All assignees must be team members');
      }
    }

    // Newly added assignees (not previously assigned) — notify these only.
    const previousAssignees = ticket.assignedTo ?? [];
    const newAssignees = assignedToUserIds.filter((uid) => !previousAssignees.includes(uid));

    await Tickets.updateAsync(new Mongo.ObjectID(ticketId), {
      $set: { assignedTo: assignedToUserIds, updatedAt: new Date(), updatedBy: identity.userId },
    });
    const updated = await Tickets.findOneAsync(new Mongo.ObjectID(ticketId));

    // Assignee display names for the activity payload.
    const assigneeNames =
      assignedToUserIds.length > 0
        ? await rawDb()
            .collection('user')
            .find({ _id: { $in: assignedToUserIds.map((uid) => new ObjectId(uid)) } })
            .toArray()
            .then((users) =>
              users.map((u) => u.name ?? u.email?.split('@')[0] ?? 'Unknown').join(', ')
            )
        : '';

    await emitTicketActivity(identity.userId, updated.teamId, 'ticket.updated', {
      ticketId,
      ticketTitle: updated.title,
      teamId: updated.teamId,
      action: assignedToUserIds.length > 0 ? 'assigned' : 'unassigned',
      assigneeId: assignedToUserIds[0] ?? null,
      assigneeName: assigneeNames || undefined,
    });

    // Notify newly added assignees (skip the requester). createNotification
    // also fires push, so there's a single delivery per user.
    const requesterName = await userDisplayName(identity.userId);
    await Promise.all(
      newAssignees
        .filter((uid) => uid !== identity.userId)
        .map((uid) =>
          createNotification({
            userId: uid,
            title: 'Huddle',
            body: `${requesterName} assigned you "${ticket.title}"`,
            data: {
              type: 'ticket-assigned',
              assignedBy: identity.userId,
              assignedByName: requesterName,
              ticketId,
              ticketTitle: ticket.title,
              teamId: ticket.teamId,
              url: `/app/tickets`,
            },
          }).catch((err) =>
            console.error(`[ticket] notify assignee ${uid} failed:`, err)
          )
        )
    );

    return toPublicTicket(updated);
  },

  /** Batch status change for tickets within one team. Mirrors batchUpdateStatus. */
  async 'tickets.batchStatus'({ ticketIds, teamId, status } = {}) {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    await requireTeamMembership(userId, teamId);
    if (!ALL_STATUSES.includes(status)) {
      throw new Meteor.Error('validation-error', `status must be one of ${ALL_STATUSES.join(', ')}`);
    }
    if (!Array.isArray(ticketIds)) {
      throw new Meteor.Error('validation-error', 'ticketIds must be an array');
    }
    const validIds = ticketIds.filter(isValidId).map((id) => new Mongo.ObjectID(id));
    if (validIds.length === 0) return { modified: 0 };
    const $set = {
      status,
      ...(status === 'reviewed' ? { reviewedBy: identity.userId, reviewedAt: new Date() } : {}),
      updatedBy: identity.userId,
      updatedAt: new Date(),
    };
    const modified = await Tickets.updateAsync(
      { _id: { $in: validIds }, teamId },
      { $set },
      { multi: true }
    );
    const updatedTickets = await Tickets.find({ _id: { $in: validIds }, teamId }).fetchAsync();
    await Promise.all(
      updatedTickets.map((t) =>
        emitTicketActivity(identity.userId, teamId, 'ticket.updated', {
          ticketId: t._id.toHexString(),
          ticketTitle: t.title,
          teamId,
          action: 'batch-status-changed',
          status,
        })
      )
    );
    return { modified };
  },
});

/**
 * Reactive ticket stream for one or more teams.
 * Replaces the hand-built WebSocket fan-out in backend/src/routes/tickets-ws.ts:
 * the cursor is oplog-backed, so any write (Meteor, Fastify, or mongosh) is
 * pushed to subscribers automatically.
 */
Meteor.publish('tickets.byTeam', async function (teamIds) {
  if (!this.userId) return this.ready();
  const userId = this.userId;
  if (!Array.isArray(teamIds) || teamIds.length === 0) return this.ready();

  // Only publish teams the user actually belongs to.
  const memberTeams = await Teams.find({
    _id: { $in: teamIds.filter(isValidId).map((id) => new Mongo.ObjectID(id)) },
    $or: [{ members: userId }, { admins: userId }],
  }).fetchAsync();
  const allowedIds = memberTeams.map((t) => t._id.toHexString());
  if (!allowedIds.length) return this.ready();

  return Tickets.find({ teamId: { $in: allowedIds }, status: { $ne: 'deleted' } });
});
