/**
 * Timesheet change requests — the model and submission side of the approval
 * workflow. Editing a timesheet after the fact is a payroll-relevant claim, so
 * on a real team it is a *request* that an admin signs off on, backed by a
 * written justification and, for a brand-new entry, a video.
 *
 * Deliberately split from `timesheet-approvals.js`: this module is imported by
 * `clock.js` and `timers.js` to gate their mutations, while the approval side
 * imports *from* those modules to apply an approved change. Keeping submission
 * here is what keeps that graph acyclic.
 */
import { Meteor } from 'meteor/meteor';
import { MongoInternals } from 'meteor/mongo';

import { Teams, TimesheetChangeRequests, isValidId, rawDb } from './collections';
import { createNotification, userDisplayName } from './notify-core';
import { artifactBelongsTo } from './pulsevault';

const { ObjectId } = MongoInternals.NpmModules.mongodb.module;

export const CHANGE_KINDS = ['clock', 'timer'];
export const CHANGE_ACTIONS = ['create', 'update', 'delete'];
// `processing` is the brief claim a reviewer holds while the change is being
// replayed — see `resolve` in timesheet-approvals.js.
export const CHANGE_STATUSES = ['pending', 'processing', 'approved', 'rejected'];

Meteor.startup(async () => {
  // Enforces "one pending change per entry" in the database rather than in the
  // check-then-insert below, which two concurrent submissions can both pass.
  await rawDb()
    .collection('timesheetchangerequests')
    .createIndex(
      { targetId: 1, kind: 1 },
      {
        unique: true,
        partialFilterExpression: { status: 'pending', targetId: { $type: 'string' } },
        name: 'one_pending_change_per_target',
      }
    )
    .catch((err) => {
      console.warn('[timesheet] pending-change index failed:', err.message);
    });

  // A `processing` claim only outlives the request that took it if the server
  // died mid-replay; hand any of those back rather than stranding them.
  await TimesheetChangeRequests.updateAsync(
    { status: 'processing' },
    { $set: { status: 'pending' } },
    { multi: true }
  ).catch(() => {});
});

/** Only adding brand-new time needs a video; editing or deleting is explained in writing alone. */
const VIDEO_REQUIRED_ACTIONS = ['create'];

/**
 * Who can sign off on `requesterId`'s change to this team's timesheet.
 *
 * The requester is excluded even when they are an admin: approving your own
 * edit is not review. That also means a solo admin, or a team whose only admin
 * is the person editing, has nobody to ask — those edits stay direct rather
 * than being permanently unapprovable.
 */
export function approversFor(team, requesterId) {
  if (!team || team.isPersonal) return [];
  return (team.admins ?? []).filter((id) => id !== requesterId);
}

/**
 * Whether a timesheet mutation must go through review instead of applying now.
 * Personal workspaces never do — there is no employer to answer to.
 */
export function requiresApproval(team, requesterId) {
  return approversFor(team, requesterId).length > 0;
}

/** Load the team that owns a clock event / work item, or null when untracked. */
export async function findTeamById(teamId) {
  if (!isValidId(teamId)) return null;
  return Teams.findOneAsync(new ObjectId(teamId));
}

export function toPublicChangeRequest(doc, extras = {}) {
  if (!doc) return null;
  return {
    id: doc._id.toHexString(),
    teamId: doc.teamId,
    userId: doc.userId,
    kind: doc.kind,
    action: doc.action,
    targetId: doc.targetId ?? null,
    payload: doc.payload ?? {},
    label: doc.label ?? null,
    description: doc.description,
    videoUrl: doc.videoUrl ?? null,
    status: doc.status === 'processing' ? 'pending' : doc.status,
    requestedAt: doc.requestedAt,
    respondedAt: doc.respondedAt ?? null,
    respondedBy: doc.respondedBy ?? null,
    responseNote: doc.responseNote ?? null,
    ...extras,
  };
}

/** The only shape a video may take: a PulseVault artifact this app uploaded. */
const ARTIFACT_PATH = /^\/pulsevault\/artifacts\/([A-Za-z0-9._-]+)$/;

/**
 * Check the video is a recording the requester actually made.
 *
 * Without this a `videoUrl` is just a string the client asserts: it could name
 * a video that doesn't exist, someone else's recording, or an arbitrary origin
 * that the reviewer's browser would then be made to fetch when the panel
 * renders it.
 */
async function assertVideoIsOwnEvidence(videoUrl, requesterId) {
  if (!videoUrl) return null;
  const match = ARTIFACT_PATH.exec(videoUrl);
  if (!match || !(await artifactBelongsTo(match[1], requesterId))) {
    throw new Meteor.Error('video-invalid', 'Attach a video recorded or uploaded here.');
  }
  return videoUrl;
}

async function assertJustification({ action, description, videoUrl, requesterId }) {
  const text = typeof description === 'string' ? description.trim() : '';
  if (text.length < 10) {
    throw new Meteor.Error(
      'description-required',
      'Explain the change in at least 10 characters so the reviewer has context.'
    );
  }
  if (VIDEO_REQUIRED_ACTIONS.includes(action) && !videoUrl) {
    throw new Meteor.Error('video-required', 'Attach a video walking through this change.');
  }
  return { text, video: await assertVideoIsOwnEvidence(videoUrl, requesterId) };
}

/**
 * Record a pending change and notify the team's approvers.
 *
 * `label` names the thing being changed when an id alone would be meaningless
 * to a reviewer — a ticket title, say. Times are deliberately *not* stored for
 * display: they are read back off the live entry and formatted in the
 * reviewer's own timezone, so a snapshot taken here would only go stale and be
 * in the wrong timezone for whoever ends up reading it.
 *
 * `baseline` is the separate, non-display copy of the fields this change would
 * overwrite. It is compared against the live entry at replay time so an
 * approval can't silently clobber an edit made while the request sat pending.
 */
export async function submitChangeRequest({
  requesterId,
  team,
  kind,
  action,
  targetId = null,
  payload = {},
  baseline = null,
  label = null,
  description,
  videoUrl = null,
}) {
  if (!CHANGE_KINDS.includes(kind)) {
    throw new Meteor.Error('validation-error', `kind must be one of ${CHANGE_KINDS.join(', ')}`);
  }
  if (!CHANGE_ACTIONS.includes(action)) {
    throw new Meteor.Error(
      'validation-error',
      `action must be one of ${CHANGE_ACTIONS.join(', ')}`
    );
  }
  const { text: trimmed, video } = await assertJustification({
    action,
    description,
    videoUrl,
    requesterId,
  });
  const teamId = team._id.toHexString();

  const alreadyPending = () =>
    new Meteor.Error('already-pending', 'This entry already has a change awaiting review.');

  if (targetId) {
    const duplicate = await TimesheetChangeRequests.findOneAsync({
      targetId,
      kind,
      status: { $in: ['pending', 'processing'] },
    });
    if (duplicate) throw alreadyPending();
  }

  let _id;
  try {
    _id = await TimesheetChangeRequests.insertAsync({
      teamId,
      userId: requesterId,
      kind,
      action,
      targetId,
      payload,
      baseline,
      label,
      description: trimmed,
      videoUrl: video,
      status: 'pending',
      requestedAt: new Date(),
      respondedAt: null,
      respondedBy: null,
      responseNote: null,
    });
  } catch (err) {
    // The partial unique index is what actually holds the invariant; the check
    // above only buys a friendlier error in the non-racing case.
    if (err?.code === 11000) throw alreadyPending();
    throw err;
  }
  const created = await TimesheetChangeRequests.findOneAsync(_id);
  const requestId = created._id.toHexString();
  const requesterName = await userDisplayName(requesterId);

  const verb = action === 'delete' ? 'delete' : action === 'create' ? 'add' : 'change';
  await Promise.all(
    approversFor(team, requesterId).map((adminId) =>
      createNotification({
        userId: adminId,
        title: 'Timesheet Approval',
        body: `${requesterName} wants to ${verb} a timesheet entry in ${team.name}`,
        data: {
          type: 'timesheet-change-request',
          requestId,
          teamId,
          userId: requesterId,
          url: `/app/dashboard?tab=timesheet&teamId=${teamId}&requestId=${requestId}`,
        },
      }).catch(() => {})
    )
  );

  return toPublicChangeRequest(created, { requesterName });
}

const ACTION_GERUND = {
  create: 'adding',
  update: 'changing',
  delete: 'removing',
};

/**
 * Notify the requester of the outcome.
 *
 * `entry` names the specific entry that was ruled on — without it the message
 * is just "your timesheet change", which is no help to someone with more than
 * one outstanding. Formatted UTC, since the recipient's timezone isn't known
 * here; the epochs travel in `data` so the in-app view can localise them.
 */
export async function notifyRequesterOfDecision(
  request,
  { approved, reviewerId, note, entry } = {}
) {
  const reviewerName = await userDisplayName(reviewerId);
  const team = await findTeamById(request.teamId);
  const teamName = team?.name ?? 'your team';
  const outcome = approved ? 'approved' : 'declined';
  const verb = ACTION_GERUND[request.action] ?? 'changing';

  const subject = entry?.text
    ? `${verb} your ${entry.text} entry`
    : `${verb} your timesheet entry`;
  const base = `${reviewerName} ${outcome} ${subject} in ${teamName}`;

  return createNotification({
    userId: request.userId,
    title: `Timesheet change ${outcome}`,
    body: note ? `${base}: ${note}` : base,
    data: {
      type: approved ? 'timesheet-change-approved' : 'timesheet-change-rejected',
      requestId: request._id.toHexString(),
      teamId: request.teamId,
      action: request.action,
      ...(entry?.startTime != null ? { startTime: String(entry.startTime) } : {}),
      ...(entry?.endTime != null ? { endTime: String(entry.endTime) } : {}),
      url: `/app/dashboard?view=timesheet&teamId=${request.teamId}`,
    },
  }).catch(() => {});
}

/** Requests raised by a user, newest first. Drives their pending/declined badges. */
export async function listRequestsForUser(userId, { teamId, status } = {}) {
  const selector = { userId };
  if (teamId) selector.teamId = teamId;
  // A request mid-replay is still pending as far as its owner is concerned.
  if (status === 'pending') selector.status = { $in: ['pending', 'processing'] };
  else if (status) selector.status = status;
  return TimesheetChangeRequests.find(selector, { sort: { requestedAt: -1 }, limit: 200 }).fetchAsync();
}

/** Resolve requester display names in one round trip rather than per request. */
export async function attachRequesterNames(requests) {
  const ids = [...new Set(requests.map((r) => r.userId))];
  if (ids.length === 0) return new Map();
  const users = await rawDb()
    .collection('users')
    .find({ _id: { $in: ids } }, { projection: { profile: 1, emails: 1 } })
    .toArray();
  return new Map(
    users.map((u) => [
      String(u._id),
      u.profile?.name ?? u.emails?.[0]?.address?.split('@')[0] ?? 'Someone',
    ])
  );
}
