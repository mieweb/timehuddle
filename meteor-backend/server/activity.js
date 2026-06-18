import { Meteor } from 'meteor/meteor';
import { MongoInternals } from 'meteor/mongo';
import { Teams, rawDb, isValidId } from './collections';
import { requireIdentity } from './auth-bridge';
import { requireTeamMembership } from './permissions';

const { ObjectId } = MongoInternals.NpmModules.mongodb.module;

function toPublic(doc) {
  return {
    id: doc._id.toHexString ? doc._id.toHexString() : String(doc._id),
    userId: doc.userId,
    teamId: doc.teamId,
    type: doc.type,
    actor: doc.actor,
    payload: doc.payload ?? {},
    occurredAt: doc.occurredAt instanceof Date ? doc.occurredAt.toISOString() : String(doc.occurredAt),
    source: doc.source,
  };
}

async function getLog(userId, limit = 50, before) {
  const safeLimit = Math.min(Math.max(1, limit), 100);
  const filter = { userId };
  if (before) {
    const ts = new Date(before);
    if (!isNaN(ts.getTime())) filter.occurredAt = { $lt: ts };
  }
  const docs = await rawDb()
    .collection('activities')
    .find(filter)
    .sort({ occurredAt: -1 })
    .limit(safeLimit)
    .toArray();
  const events = docs.map(toPublic);
  const nextCursor =
    docs.length === safeLimit
      ? (docs[docs.length - 1].occurredAt instanceof Date
          ? docs[docs.length - 1].occurredAt.toISOString()
          : String(docs[docs.length - 1].occurredAt))
      : null;
  return { events, nextCursor };
}

Meteor.methods({
  async 'activity.log'({ limit, before } = {}) {
    const identity = await requireIdentity(this);
    return getLog(identity.userId, limit, before);
  },

  async 'activity.userLog'({ userId, limit, before } = {}) {
    const identity = await requireIdentity(this);
    if (typeof userId !== 'string' || !userId) {
      throw new Meteor.Error('bad-request', 'userId is required');
    }

    if (identity.userId !== userId) {
      const sharedTeam = await Teams.rawCollection().findOne({
        members: { $all: [identity.userId, userId] },
        isPersonal: { $ne: true },
      });
      if (!sharedTeam) {
        throw new Meteor.Error('forbidden', 'You can only view activity of teammates.');
      }
    }

    return getLog(userId, limit, before);
  },

  async 'activity.ticketActivity'({ ticketId, limit } = {}) {
    const identity = await requireIdentity(this);
    if (typeof ticketId !== 'string' || !ticketId) {
      throw new Meteor.Error('bad-request', 'ticketId is required');
    }

    if (isValidId(ticketId)) {
      const ticket = await rawDb()
        .collection('tickets')
        .findOne({ _id: new ObjectId(ticketId) });
      if (!ticket) throw new Meteor.Error('not-found', 'Ticket not found');
      await requireTeamMembership(identity.userId, ticket.teamId);
    }

    const safeLimit = Math.min(Math.max(1, limit ?? 50), 100);
    const docs = await rawDb()
      .collection('activities')
      .find({ 'payload.ticketId': ticketId })
      .sort({ occurredAt: -1 })
      .limit(safeLimit)
      .toArray();
    return { events: docs.map(toPublic) };
  },
});
