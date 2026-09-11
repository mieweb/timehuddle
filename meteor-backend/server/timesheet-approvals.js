/**
 * Timesheet approvals — the review side of the workflow.
 *
 * Imports the `apply*` mutations from clock.js/timers.js so an approved request
 * replays exactly the write the direct path would have made, rather than
 * reimplementing it. Nothing imports this module back, which is what keeps the
 * dependency graph acyclic (see timesheet-change-requests.js).
 */
import { Meteor } from 'meteor/meteor';
import { MongoInternals } from 'meteor/mongo';

import {
  ClockEvents,
  Teams,
  TimesheetChangeRequests,
  WorkItems,
  isValidId,
  rawDb,
} from './collections';
import { requireIdentity } from './auth-bridge';
import { applyClockCreateManual, applyClockDelete, applyClockUpdate } from './clock';
import { applyTimerDelete, applyTimerUpdate } from './timers';
import {
  attachRequesterNames,
  findTeamById,
  listRequestsForUser,
  notifyRequesterOfDecision,
  toPublicChangeRequest,
} from './timesheet-change-requests';

const { ObjectId } = MongoInternals.NpmModules.mongodb.module;

/** Load a pending request and assert the caller may rule on it. */
async function loadForReview(requestId, reviewerId) {
  if (!isValidId(requestId)) throw new Meteor.Error('not-found', 'Request not found');
  const request = await TimesheetChangeRequests.findOneAsync(new ObjectId(requestId));
  if (!request) throw new Meteor.Error('not-found', 'Request not found');
  if (request.status !== 'pending') {
    throw new Meteor.Error('already-resolved', 'This request has already been reviewed.');
  }
  if (request.userId === reviewerId) {
    throw new Meteor.Error('forbidden', 'You cannot review your own timesheet change.');
  }
  const team = await findTeamById(request.teamId);
  if (!team || !(team.admins ?? []).includes(reviewerId)) {
    throw new Meteor.Error('forbidden', 'Only a team admin can review this.');
  }
  return request;
}

/**
 * Replay an approved request against the live data.
 *
 * The target may have moved on since the request was raised — someone else's
 * edit, or a delete — so a missing target is reported as a precondition
 * failure rather than silently succeeding.
 */
async function applyRequest(request) {
  const { kind, action, targetId, payload, userId } = request;

  if (kind === 'clock') {
    if (action === 'create') {
      return applyClockCreateManual({
        userId,
        teamId: payload.teamId,
        startTime: payload.startTime,
        endTime: payload.endTime,
      });
    }
    const event = await ClockEvents.findOneAsync(new ObjectId(targetId));
    if (!event) {
      throw new Meteor.Error('target-gone', 'That clock session no longer exists.');
    }
    return action === 'delete'
      ? applyClockDelete(event, userId)
      : applyClockUpdate(event, payload, userId);
  }

  const entry = await WorkItems.findOneAsync(new ObjectId(targetId));
  if (!entry) throw new Meteor.Error('target-gone', 'That time entry no longer exists.');
  return action === 'delete'
    ? applyTimerDelete(entry, userId, payload.notifyAdmins !== false)
    : applyTimerUpdate(entry, payload, userId);
}

async function resolve(request, reviewerId, { approved, note }) {
  // Apply before recording the decision: if the replay fails the request stays
  // pending and reviewable rather than being marked approved with no effect.
  if (approved) await applyRequest(request);

  await TimesheetChangeRequests.updateAsync(request._id, {
    $set: {
      status: approved ? 'approved' : 'rejected',
      respondedAt: new Date(),
      respondedBy: reviewerId,
      responseNote: note?.trim() || null,
    },
  });

  await notifyRequesterOfDecision(request, { approved, reviewerId, note: note?.trim() || null });

  // The reviewer's prompt has been answered — clear it from every admin's inbox
  // so a second admin isn't shown a decision that has already been made.
  await rawDb()
    .collection('notifications')
    .deleteMany({
      'data.type': 'timesheet-change-request',
      'data.requestId': request._id.toHexString(),
    });

  const updated = await TimesheetChangeRequests.findOneAsync(request._id);
  return toPublicChangeRequest(updated);
}

Meteor.methods({
  /** Requests the caller raised — drives their pending/declined badges. */
  async 'timesheetApprovals.listMine'({ teamId, status } = {}) {
    const identity = await requireIdentity(this);
    const requests = await listRequestsForUser(identity.userId, { teamId, status });
    return { requests: requests.map((r) => toPublicChangeRequest(r)) };
  },

  /** Requests awaiting the caller's review across the teams they administer. */
  async 'timesheetApprovals.listPending'({ teamId } = {}) {
    const identity = await requireIdentity(this);
    const reviewerId = identity.userId;

    const selector = { admins: reviewerId };
    if (isValidId(teamId)) selector._id = new ObjectId(teamId);
    const teams = await Teams.find(selector, { fields: { name: 1 } }).fetchAsync();
    if (teams.length === 0) return { requests: [] };

    const teamNames = new Map(teams.map((t) => [t._id.toHexString(), t.name]));
    const requests = await TimesheetChangeRequests.find(
      {
        teamId: { $in: [...teamNames.keys()] },
        status: 'pending',
        userId: { $ne: reviewerId },
      },
      { sort: { requestedAt: 1 }, limit: 200 }
    ).fetchAsync();

    const names = await attachRequesterNames(requests);
    return {
      requests: requests.map((r) =>
        toPublicChangeRequest(r, {
          requesterName: names.get(r.userId) ?? 'Someone',
          teamName: teamNames.get(r.teamId) ?? null,
        })
      ),
    };
  },

  /** Full detail for the review modal, reachable from the notification. */
  async 'timesheetApprovals.get'({ requestId } = {}) {
    const identity = await requireIdentity(this);
    if (!isValidId(requestId)) throw new Meteor.Error('not-found', 'Request not found');
    const request = await TimesheetChangeRequests.findOneAsync(new ObjectId(requestId));
    if (!request) throw new Meteor.Error('not-found', 'Request not found');

    const team = await findTeamById(request.teamId);
    const isReviewer = (team?.admins ?? []).includes(identity.userId);
    if (request.userId !== identity.userId && !isReviewer) {
      throw new Meteor.Error('forbidden', 'Not allowed to view this request.');
    }

    const names = await attachRequesterNames([request]);
    return toPublicChangeRequest(request, {
      requesterName: names.get(request.userId) ?? 'Someone',
      teamName: team?.name ?? null,
      canReview: isReviewer && request.userId !== identity.userId && request.status === 'pending',
    });
  },

  async 'timesheetApprovals.approve'({ requestId, note } = {}) {
    const identity = await requireIdentity(this);
    const request = await loadForReview(requestId, identity.userId);
    return resolve(request, identity.userId, { approved: true, note });
  },

  async 'timesheetApprovals.reject'({ requestId, note } = {}) {
    const identity = await requireIdentity(this);
    const request = await loadForReview(requestId, identity.userId);
    if (!note || !note.trim()) {
      throw new Meteor.Error('note-required', 'Tell them why the change was declined.');
    }
    return resolve(request, identity.userId, { approved: false, note });
  },

  /** Withdraw a request the caller raised and no admin has ruled on yet. */
  async 'timesheetApprovals.cancel'({ requestId } = {}) {
    const identity = await requireIdentity(this);
    if (!isValidId(requestId)) throw new Meteor.Error('not-found', 'Request not found');
    const request = await TimesheetChangeRequests.findOneAsync(new ObjectId(requestId));
    if (!request) throw new Meteor.Error('not-found', 'Request not found');
    if (request.userId !== identity.userId) throw new Meteor.Error('forbidden', 'Forbidden');
    if (request.status !== 'pending') {
      throw new Meteor.Error('already-resolved', 'This request has already been reviewed.');
    }

    await TimesheetChangeRequests.removeAsync(request._id);
    await rawDb()
      .collection('notifications')
      .deleteMany({
        'data.type': 'timesheet-change-request',
        'data.requestId': requestId,
      });
    return { ok: true };
  },
});
