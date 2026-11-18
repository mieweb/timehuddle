import { Meteor } from 'meteor/meteor';
import { MongoInternals } from 'meteor/mongo';
import { rawDb, isValidId, isObjectIdHex } from './collections';
import { requireIdentity } from './auth-bridge';
import { isTeamAdminOrOrgOwner } from './org-helpers';
import { CANONICAL_ITEM, mayRenameVideo, videoIdOf, videoNamesFor } from './video-names.js';
import { captionsUrlOf } from './pulse-captions-core.js';
import { keepReferencedUploads } from './uploads';
import { existingOnDuplicate, pulseFieldsOf, videoTargetFilter } from './attachments-dedupe-core.js';
import { runPulseAttachmentsDedupe } from './migrations/pulse-attachments-dedupe.js';

const { ObjectId } = MongoInternals.NpmModules.mongodb.module;

const VALID_KINDS = ['clock', 'ticket'];
const VALID_TYPES = ['video', 'image', 'link'];

// A video lands on a ticket or session once (huddle-server §12): old
// duplicates go, then the unique index on its target comes. `DRY_RUN=1` only
// logs how many duplicates there are. Not awaited: startup doesn't wait on it.
Meteor.startup(() => {
  runPulseAttachmentsDedupe(rawDb(), { dryRun: process.env.DRY_RUN === '1' }).catch((error) =>
    console.error('[attachments] video dedupe or its unique index failed:', error.message),
  );
});

function toPublic(a) {
  return {
    id: a._id.toHexString ? a._id.toHexString() : String(a._id),
    url: a.url,
    type: a.type,
    title: a.title ?? null,
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
 *
 * A video lands on its target once: a replay (same url, kind and id) returns
 * the attachment already there instead of throwing. Links and images may
 * repeat. Pulse deliveries also pass `source: 'pulse'`, `videoid`,
 * `pulseUploadId` and `uploadType`, which are stored but not returned.
 */
export async function createAttachment({
  url,
  type,
  title,
  attachedTo,
  addedBy,
  source,
  videoid,
  pulseUploadId,
  uploadType,
}) {
  if (typeof url !== 'string' || !url.trim()) throw new Meteor.Error('bad-request', 'url is required');
  if (!VALID_TYPES.includes(type)) throw new Meteor.Error('bad-request', 'Invalid type');
  if (!attachedTo?.kind || typeof attachedTo.id !== 'string' || !attachedTo.id) {
    throw new Meteor.Error('bad-request', 'attachedTo is required');
  }
  if (!VALID_KINDS.includes(attachedTo.kind)) throw new Meteor.Error('bad-request', 'Invalid attachedTo.kind');
  const pulse = pulseFieldsOf(type, { source, videoid, pulseUploadId, uploadType });
  if (pulse.error) throw new Meteor.Error('bad-request', pulse.error);

  const resolvedTitle = title ?? (isYouTubeUrl(url) ? await fetchYouTubeTitle(url) : undefined);

  const doc = {
    _id: new ObjectId(),
    url: url.trim(),
    type,
    ...(resolvedTitle ? { title: resolvedTitle } : {}),
    attachedTo,
    addedBy,
    addedAt: new Date(),
    ...pulse.fields,
  };
  // An upload a post dropped, waiting to be deleted, stays for this.
  await keepReferencedUploads([doc.url]);
  const attachments = rawDb().collection('attachments');
  try {
    await attachments.insertOne(doc);
    return toPublic(doc);
  } catch (error) {
    const existing = await existingOnDuplicate(error, () => attachments.findOne(videoTargetFilter(doc)));
    return toPublic(existing);
  }
}

/**
 * Each video's captions URL (pulse-captions-core.js), by video id, from its
 * media item's `captionsId`: null for a video with none, or none known yet.
 */
async function captionsUrlsFor(videoIds) {
  const ids = [...new Set(videoIds.filter(Boolean))];
  if (!ids.length) return new Map();
  const items = await rawDb()
    .collection('mediaitems')
    .find({ videoid: { $in: ids } }, { projection: { videoid: 1, captionsId: 1 }, ...CANONICAL_ITEM })
    .toArray();
  const urls = new Map();
  // The first is CANONICAL_ITEM's, where old data has duplicates.
  for (const item of items) if (!urls.has(item.videoid)) urls.set(item.videoid, captionsUrlOf(item));
  return urls;
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
 * clock session is its owner's or its team admins'. Huddle tickets are not
 * gated here.
 */
async function assertCanReach(userId, attachedTo) {
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
    // A video's name is its media item's (video-names.js), renamed by its owner.
    const videoIds = docs.map((a) => (a.type === 'video' ? videoIdOf(a.url) : null));
    const [videos, captions] = await Promise.all([videoNamesFor(videoIds), captionsUrlsFor(videoIds)]);
    return {
      attachments: docs.map((a) => {
        const videoId = a.type === 'video' ? videoIdOf(a.url) : null;
        const video = videoId ? videos.get(videoId) : undefined;
        return {
          ...toPublic(a),
          ...(a.type === 'video'
            ? {
                name: video?.name ?? null,
                // Its owner; for a video from before every video had a media
                // item, whoever PulseVault says uploaded it (videoNamesFor) —
                // the rule videos.rename applies (attaching a URL proves nothing).
                canRename: mayRenameVideo({ item: video ? { userId: video.ownerId } : null, userId }),
                // Its captions (huddle-server §11), played with it; null for none.
                captionsUrl: (videoId && captions.get(videoId)) ?? null,
              }
            : {}),
        };
      }),
    };
  },

  // No `thumbnail` from clients: a Pulse video's poster comes from PulseVault
  // (GET /pulsevault/artifacts/:videoId/poster), never from whoever attached it.
  async 'attachments.add'({ url, type, title, attachedTo }) {
    const identity = await requireIdentity(this);
    // A string id, as `list` matches it: a numeric one would be stored where
    // no list ever finds it.
    if (typeof attachedTo?.id !== 'string') throw new Meteor.Error('bad-request', 'attachedTo is required');
    await assertCanReach(identity.userId, attachedTo);
    const attachment = await createAttachment({ url, type, title, attachedTo, addedBy: identity.userId });
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
