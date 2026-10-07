import { Meteor } from 'meteor/meteor';
import { MongoInternals } from 'meteor/mongo';
import { rawDb, isValidId, isObjectIdHex } from './collections';
import { requireIdentity } from './auth-bridge';
import { REDMINE, resolveTicketRef } from './ticket-refs';
import { isTeamAdminOrOrgOwner } from './org-helpers';

const { ObjectId } = MongoInternals.NpmModules.mongodb.module;

const VALID_KINDS = ['clock', 'ticket', REDMINE];
const VALID_TYPES = ['video', 'image', 'link'];

function toPublic(a) {
  return {
    id: a._id.toHexString ? a._id.toHexString() : String(a._id),
    url: a.url,
    type: a.type,
    title: a.title ?? null,
    thumbnail: a.thumbnail ?? null,
    attachedTo: a.attachedTo,
    addedBy: a.addedBy,
    addedAt: a.addedAt instanceof Date ? a.addedAt.toISOString() : String(a.addedAt),
  };
}

function isYouTubeUrl(url) {
  return /(?:youtube\.com\/watch|youtu\.be\/)/i.test(url);
}

async function fetchYouTubeTitle(url) {
  try {
    const res = await fetch(`https://noembed.com/embed?url=${encodeURIComponent(url)}`, {
      signal: AbortSignal.timeout(5000), // 5s timeout to prevent hanging
    });
    
    if (!res.ok) return null;
    const data = await res.json();
    return data.title ?? null;
  } catch {
    return null;
  }
}

/**
 * Insert an attachment directly, bypassing the `attachments.add` method's
 * caller-identity resolution. Used by upload pipelines (PulseVault) that
 * already know the owning userId from their own reservation/auth context
 * rather than the current Meteor method invocation.
 */
export async function createAttachment({ url, type, title, thumbnail, attachedTo, addedBy }) {
  if (typeof url !== 'string' || !url.trim()) throw new Meteor.Error('bad-request', 'url is required');
  if (!VALID_TYPES.includes(type)) throw new Meteor.Error('bad-request', 'Invalid type');
  if (!attachedTo?.kind || typeof attachedTo.id !== 'string' || !attachedTo.id) {
    throw new Meteor.Error('bad-request', 'attachedTo is required');
  }
  if (!VALID_KINDS.includes(attachedTo.kind)) throw new Meteor.Error('bad-request', 'Invalid attachedTo.kind');

  const resolvedTitle = title ?? (isYouTubeUrl(url) ? await fetchYouTubeTitle(url) : undefined);

  const doc = {
    _id: new ObjectId(),
    url: url.trim(),
    type,
    ...(resolvedTitle ? { title: resolvedTitle } : {}),
    ...(thumbnail ? { thumbnail } : {}),
    attachedTo,
    addedBy,
    addedAt: new Date(),
  };
  await rawDb().collection('attachments').insertOne(doc);
  return toPublic(doc);
}

/** The team document, by either id shape a team can have. */
async function findTeam(teamId) {
  const teams = rawDb().collection('teams');
  return (
    (await teams.findOne({ _id: teamId }, { projection: { admins: 1, orgId: 1 } })) ??
    (isObjectIdHex(teamId)
      ? await teams.findOne({ _id: new ObjectId(teamId) }, { projection: { admins: 1, orgId: 1 } })
      : null)
  );
}

/**
 * A clock session's attachments are the session's own: its owner's, and its
 * team's admins' (who review the timesheet they sit on). An organization's
 * owners count as every team's admins, as they do everywhere else.
 */
async function assertCanReachSession(userId, id) {
  if (!isObjectIdHex(id)) throw new Meteor.Error('not-found', 'Clock session not found');
  const session = await rawDb()
    .collection('clockevents')
    .findOne({ _id: new ObjectId(id) }, { projection: { userId: 1, teamId: 1 } });
  if (!session) throw new Meteor.Error('not-found', 'Clock session not found');
  if (session.userId === userId) return;
  const team = await findTeam(String(session.teamId ?? ''));
  const reviews = team && (await isTeamAdminOrOrgOwner({ ...team, admins: team.admins ?? [] }, userId));
  if (!reviews) throw new Meteor.Error('forbidden', 'Not your clock session');
}

/**
 * Whether the caller may see — and so add to — what `attachedTo` names. A
 * Redmine issue's attachments live only in TimeHuddle, but they belong to an
 * issue the caller's own key must be able to see (`resolveTicketRef` throws
 * when it cannot); a clock session is its owner's or its team admins'.
 * Huddle tickets are not gated here.
 */
async function assertCanReach(userId, attachedTo) {
  if (attachedTo.kind === REDMINE) await resolveTicketRef(userId, REDMINE, attachedTo.id);
  if (attachedTo.kind === 'clock') await assertCanReachSession(userId, attachedTo.id);
}

Meteor.methods({
  async 'attachments.list'({ kind, id }) {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    if (!VALID_KINDS.includes(kind)) throw new Meteor.Error('bad-request', 'Invalid kind');
    if (typeof id !== 'string' || !id) throw new Meteor.Error('bad-request', 'id is required');
    await assertCanReach(userId, { kind, id });

    const docs = await rawDb().collection('attachments')
      .find({ 'attachedTo.kind': kind, 'attachedTo.id': id })
      .sort({ addedAt: 1 })
      .toArray();
    return { attachments: docs.map(toPublic) };
  },

  async 'attachments.add'({ url, type, title, thumbnail, attachedTo }) {
    const identity = await requireIdentity(this);
    // A string id, as `list` matches it: a numeric one would pass the Redmine
    // check but be stored where no list ever finds it.
    if (typeof attachedTo?.id !== 'string') throw new Meteor.Error('bad-request', 'attachedTo is required');
    await assertCanReach(identity.userId, attachedTo);
    const attachment = await createAttachment({ url, type, title, thumbnail, attachedTo, addedBy: identity.userId });
    return { attachment };
  },

  async 'attachments.remove'({ attachmentId }) {
    const identity = await requireIdentity(this);
    const userId = identity.userId;
    if (!isValidId(attachmentId)) throw new Meteor.Error('not-found', 'Invalid attachment id');
    const doc = await rawDb().collection('attachments').findOne({ _id: new ObjectId(attachmentId) });
    if (!doc) throw new Meteor.Error('not-found', 'Attachment not found');
    if (doc.addedBy !== userId) throw new Meteor.Error('forbidden', 'Not the owner');
    await rawDb().collection('attachments').deleteOne({ _id: doc._id });
    return { ok: true };
  },
});
