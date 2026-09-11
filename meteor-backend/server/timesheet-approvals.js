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
import { applyTimerDelete, applyTimerUpdate, teamForEntry } from './timers';
import {
  attachRequesterNames,
  findTeamById,
  listRequestsForUser,
  notifyRequesterOfDecision,
  toPublicChangeRequest,
} from './timesheet-change-requests';

const { ObjectId } = MongoInternals.NpmModules.mongodb.module;

/**
 * Read back the times the request is proposing to change, off the live entry.
 *
 * Resolved here rather than snapshotted at submission: a stored copy goes stale
 * the moment anyone else touches the entry, and the reviewer needs to compare
 * against what is actually on the timesheet now. Returns null once the target
 * is gone, which is also how an approval that can no longer be applied surfaces.
 */
async function resolveCurrentTimes(request) {
  if (!request.targetId || !isValidId(request.targetId)) return null;

  if (request.kind === 'clock') {
    const event = await ClockEvents.findOneAsync(new ObjectId(request.targetId));
    if (!event) return null;
    return {
      startTime: event.startTime,
      endTime: event.endTime ?? null,
      // Paid seconds, so a break-only edit — which moves the total while
      // leaving the range identical — is visible to the reviewer.
      accumulatedTime: event.accumulatedTime ?? null,
    };
  }

  const entry = await WorkItems.findOneAsync(new ObjectId(request.targetId));
  if (!entry) return null;
  const sessions = await rawDb()
    .collection('timers')
    .find({ workItemId: request.targetId, endTime: { $ne: null } })
    .toArray();
  return {
    durationSeconds: sessions.reduce((sum, s) => sum + (s.durationSeconds ?? 0), 0),
    date: entry.date,
  };
}

/** Attach live entry state to each request for display. */
async function withCurrent(request, extras = {}) {
  return toPublicChangeRequest(request, { current: await resolveCurrentTimes(request), ...extras });
}

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
 * Everything here is a precondition check rather than a best effort: the entry
 * may have moved on since the request was raised — deleted, edited by another
 * path, or reassigned to a different team's ticket — and an approval that no
 * longer means what the reviewer read is refused rather than forced through.
 */
async function applyRequest(request) {
  const { kind, action, targetId, payload, baseline, userId, teamId } = request;
  // The admins asked for this to happen, so the usual "someone changed a
  // timesheet" fan-out is noise here — and it reached the approver worded as
  // if a third party had made the edit. The requester hears about it through
  // the decision notification instead.
  const quiet = { notifyAdmins: false };

  if (kind === 'clock') {
    if (action === 'create') {
      return applyClockCreateManual({
        userId,
        teamId: payload.teamId,
        startTime: payload.startTime,
        endTime: payload.endTime,
        notifyAdmins: false,
      });
    }
    const event = await ClockEvents.findOneAsync(new ObjectId(targetId));
    if (!event) {
      throw new Meteor.Error('target-gone', 'That clock session no longer exists.');
    }
    if (event.teamId !== teamId) {
      throw new Meteor.Error('target-moved', 'That session now belongs to another team.');
    }
    if (action === 'delete') return applyClockDelete(event, userId, quiet);
    assertUnchangedSince(baseline, {
      startTime: event.startTime,
      endTime: event.endTime ?? null,
    });
    return applyClockUpdate(event, payload, userId, quiet);
  }

  const entry = await WorkItems.findOneAsync(new ObjectId(targetId));
  if (!entry) throw new Meteor.Error('target-gone', 'That time entry no longer exists.');
  if (action === 'delete') {
    // A delete is reviewed by the team that owned the entry when it was raised,
    // so if ticket-only editing has since moved it, this admin is no longer the
    // one entitled to rule on it. An update is bound instead by the baseline's
    // ticketId below — its request.teamId may be the *destination* of a move
    // and so deliberately doesn't match where the entry sits right now.
    const owningTeam = await teamForEntry(entry);
    if (owningTeam?._id.toHexString() !== teamId) {
      throw new Meteor.Error('target-moved', 'That entry now belongs to another team.');
    }
    return applyTimerDelete(entry, userId, false);
  }
  assertUnchangedSince(baseline, {
    note: entry.note ?? null,
    ticketId: entry.ticketId,
    durationSeconds: await loggedSeconds(targetId),
  });
  return applyTimerUpdate(entry, payload, userId, quiet);
}

/** Total logged seconds across a work item's completed sessions. */
async function loggedSeconds(workItemId) {
  const sessions = await rawDb()
    .collection('timers')
    .find({ workItemId, endTime: { $ne: null } })
    .toArray();
  return sessions.reduce((sum, s) => sum + (s.durationSeconds ?? 0), 0);
}

/**
 * Refuse to replay over an edit made while the request was pending.
 *
 * An approved payload overwrites whole fields, so a note changed through the
 * direct path (relabelling stays direct) would be silently reverted to the
 * copy captured at submission. The reviewer ruled on a specific before state;
 * if it is no longer the before state, they need to rule again.
 */
function assertUnchangedSince(baseline, live) {
  if (!baseline) return;
  const drifted = Object.keys(baseline).find((key) => baseline[key] !== live[key]);
  if (drifted) {
    throw new Meteor.Error(
      'target-changed',
      'This entry was edited after the request was raised. Ask for it to be submitted again.'
    );
  }
}

/** UTC range for the decision notification — see notifyRequesterOfDecision. */
function formatUtcRange(startMs, endMs) {
  if (typeof startMs !== 'number') return null;
  const day = (ms) =>
    new Date(ms).toLocaleString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
  const time = (ms) =>
    new Date(ms)
      .toLocaleString('en-US', {
        timeZone: 'UTC',
        hour: 'numeric',
        minute: '2-digit',
      })
      .replace(/\s([AP])M/, (_, p) => p.toLowerCase() + 'm');

  const from = `${day(startMs)}, ${time(startMs)}`;
  if (typeof endMs !== 'number') return `${from} UTC (still open)`;
  // Naming the day twice for a single shift just adds noise.
  const to = day(startMs) === day(endMs) ? time(endMs) : `${day(endMs)}, ${time(endMs)}`;
  return `${from} – ${to} UTC`;
}

/**
 * Name the entry being ruled on, for the requester's notification.
 *
 * Read before the change is applied — approving a delete destroys the very
 * entry the message needs to describe.
 */
async function describeTarget(request) {
  if (request.kind === 'clock') {
    const times =
      request.action === 'create'
        ? { startTime: request.payload.startTime, endTime: request.payload.endTime }
        : await (async () => {
            if (!isValidId(request.targetId)) return null;
            const event = await ClockEvents.findOneAsync(new ObjectId(request.targetId));
            return event ? { startTime: event.startTime, endTime: event.endTime } : null;
          })();
    if (!times) return null;
    const text = formatUtcRange(times.startTime, times.endTime);
    return text ? { text, ...times } : null;
  }

  return request.label ? { text: request.label } : null;
}

/**
 * Take exclusive ownership of a pending request.
 *
 * Two admins can both pass `loadForReview` before either writes a decision, so
 * without this the mutation could be replayed twice — or applied by an approve
 * that then loses the race to a reject and is recorded as declined. The claim
 * is the single point at which a request stops being up for review.
 */
async function claimForDecision(requestId) {
  const claimed = await TimesheetChangeRequests.updateAsync(
    { _id: requestId, status: 'pending' },
    { $set: { status: 'processing' } }
  );
  if (claimed === 0) {
    throw new Meteor.Error('already-resolved', 'This request has already been reviewed.');
  }
  return TimesheetChangeRequests.findOneAsync(requestId);
}

async function resolve(request, reviewerId, { approved, note }) {
  // Captured before applying: approving a delete removes the entry this needs
  // to name.
  const entry = await describeTarget(request);

  const claimed = await claimForDecision(request._id);

  if (approved) {
    try {
      await applyRequest(claimed);
    } catch (err) {
      // Hand it back rather than recording a decision the data never took —
      // the request stays reviewable, and the reviewer sees why it failed.
      await TimesheetChangeRequests.updateAsync(request._id, { $set: { status: 'pending' } });
      throw err;
    }
  }

  await TimesheetChangeRequests.updateAsync(request._id, {
    $set: {
      status: approved ? 'approved' : 'rejected',
      respondedAt: new Date(),
      respondedBy: reviewerId,
      responseNote: note?.trim() || null,
    },
  });

  await notifyRequesterOfDecision(request, {
    approved,
    reviewerId,
    note: note?.trim() || null,
    entry,
  });

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
      requests: await Promise.all(
        requests.map((r) =>
          withCurrent(r, {
            requesterName: names.get(r.userId) ?? 'Someone',
            teamName: teamNames.get(r.teamId) ?? null,
          })
        )
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
    return withCurrent(request, {
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
