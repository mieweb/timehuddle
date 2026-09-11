/**
 * Timesheet change requests — the model and submission side of the approval
 * workflow. Editing a timesheet after the fact is a payroll-relevant claim, so
 * on a real team it is a *request* that an admin signs off on, backed by a
 * written justification and (for anything that adds or changes time) a video.
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

const { ObjectId } = MongoInternals.NpmModules.mongodb.module;

export const CHANGE_KINDS = ['clock', 'timer'];
export const CHANGE_ACTIONS = ['create', 'update', 'delete'];
export const CHANGE_STATUSES = ['pending', 'approved', 'rejected'];

/** Actions that must be backed by a video — anything that adds or alters time. */
const VIDEO_REQUIRED_ACTIONS = ['create', 'update'];

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
    summary: doc.summary ?? null,
    description: doc.description,
    videoUrl: doc.videoUrl ?? null,
    status: doc.status,
    requestedAt: doc.requestedAt,
    respondedAt: doc.respondedAt ?? null,
    respondedBy: doc.respondedBy ?? null,
    responseNote: doc.responseNote ?? null,
    ...extras,
  };
}

function assertJustification({ action, description, videoUrl }) {
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
  return text;
}

/**
 * Record a pending change and notify the team's approvers.
 *
 * `summary` is a plain-language, already-resolved description of the change
 * (ticket titles, formatted times) so the reviewer does not have to interpret
 * raw ids, and so the request still reads correctly if the underlying entry is
 * edited or removed before anyone looks at it.
 */
export async function submitChangeRequest({
  requesterId,
  team,
  kind,
  action,
  targetId = null,
  payload = {},
  summary = null,
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
  const trimmed = assertJustification({ action, description, videoUrl });
  const teamId = team._id.toHexString();

  if (targetId) {
    const duplicate = await TimesheetChangeRequests.findOneAsync({
      targetId,
      kind,
      status: 'pending',
    });
    if (duplicate) {
      throw new Meteor.Error(
        'already-pending',
        'This entry already has a change awaiting review.'
      );
    }
  }

  const _id = await TimesheetChangeRequests.insertAsync({
    teamId,
    userId: requesterId,
    kind,
    action,
    targetId,
    payload,
    summary,
    description: trimmed,
    videoUrl,
    status: 'pending',
    requestedAt: new Date(),
    respondedAt: null,
    respondedBy: null,
    responseNote: null,
  });
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

/** Notify the requester of the outcome, with the reviewer's note when given. */
export async function notifyRequesterOfDecision(request, { approved, reviewerId, note }) {
  const reviewerName = await userDisplayName(reviewerId);
  const team = await findTeamById(request.teamId);
  const teamName = team?.name ?? 'your team';
  const outcome = approved ? 'approved' : 'declined';

  return createNotification({
    userId: request.userId,
    title: `Timesheet change ${outcome}`,
    body: note
      ? `${reviewerName} ${outcome} your timesheet change in ${teamName}: ${note}`
      : `${reviewerName} ${outcome} your timesheet change in ${teamName}`,
    data: {
      type: approved ? 'timesheet-change-approved' : 'timesheet-change-rejected',
      requestId: request._id.toHexString(),
      teamId: request.teamId,
      url: `/app/dashboard?view=timesheet&teamId=${request.teamId}`,
    },
  }).catch(() => {});
}

/** Requests raised by a user, newest first. Drives their pending/declined badges. */
export async function listRequestsForUser(userId, { teamId, status } = {}) {
  const selector = { userId };
  if (teamId) selector.teamId = teamId;
  if (status) selector.status = status;
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
