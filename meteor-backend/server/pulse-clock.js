/**
 * `clock.stopWithVideo` and `clock.startWithPlan`: clocking out or in at
 * Send with a Pulse video still to come (huddle-server §9, PLAN AD23). Huddle
 * calls one from Pulse's confirmSend, before Pulse closes; Pulse queues the
 * upload only when it succeeds. The rules are pure, in pulse-clock-core.js;
 * this file runs them.
 *
 * One call: the draft's `intent` row (pulse-uploads.js's insertIntent), then
 * the post (the wrap-up line on the session's post, or the plan post) with
 * the video marked as on its way, then clockStop or clockStart at the Send.
 * The begin that follows adopts the row by draftKey, and its video only ever
 * attaches to that post: it never clocks anyone (pulse-upload-delivery.js).
 *
 * Idempotent per (userId, draftKey): a retry runs only the steps the last
 * call didn't finish (clockCallSteps) and answers as the first did. Calls for
 * one draft run one at a time (a lease on its row), so a Try again sent while
 * the first call still runs can't write twice.
 *
 * Also registers what a clock row's stop does to its post (a video that
 * won't come is marked missing; the clock stays as it is, Q1).
 */
import { Meteor } from 'meteor/meteor';
import { MongoInternals } from 'meteor/mongo';

import { requireIdentity } from './auth-bridge.js';
import { isObjectIdHex, rawDb } from './collections.js';
import { appendWrapUp, createHuddlePost, requireTeamMember } from './huddle.js';
import {
  checkClockCallArgs,
  clockActionTime,
  clockCallSteps,
  firstClockRow,
  missingVideoWrite,
  planPostOptions,
  PULSE_CLOCK_CALLS,
  PULSE_CLOCK_METHODS,
  wrapUpOptions,
} from './pulse-clock-core.js';
import { intentDecision } from './pulse-uploads-core.js';
import { pulseUploadMethods, TOO_MANY_PULSE_UPLOAD_CALLS } from './pulse-uploads-expose-core.js';
import {
  findDraftRows,
  insertIntent,
  pulseUploadsCollection,
  registerPulseCancelHandler,
} from './pulse-uploads.js';

const { ObjectId } = MongoInternals.NpmModules.mongodb.module;

// clock.js reaches pulsevault.js (and so pulse-uploads.js) through
// timesheet-change-requests.js; load it when a clock call runs instead.
const clockModule = () => import('./clock.js');
const clockCoreModule = () => import('./clock-core.js');

/** How long one call holds its draft's row; a call that died lets go after this. */
const CLOCK_CALL_LEASE_MS = 60 * 1000;

const posts = () => rawDb().collection('huddlePosts');
const sessions = () => rawDb().collection('clockevents');
const idOf = (id) => (id && typeof id.toHexString === 'function' ? id.toHexString() : String(id));
const toPostId = (id) => (isObjectIdHex(id) ? new ObjectId(id.toLowerCase()) : id);

function refuse(checked) {
  if (checked.error) throw new Meteor.Error(checked.error, checked.reason);
  return checked.value;
}

/** The clock session a wrap-up ends: the caller's, in this team. Open or not; the caller decides. */
async function sessionOf(userId, { clockEventId, teamId }) {
  const session = await sessions().findOne({ _id: new ObjectId(clockEventId) });
  if (!session || String(session.teamId) !== teamId) {
    throw new Meteor.Error('not-found', 'Clock session not found');
  }
  if (session.userId !== userId) throw new Meteor.Error('forbidden', 'Not your clock session');
  return session;
}

/** A session as the clock methods return it (ClockEvent), breaks included. */
async function publicEvent(session) {
  const { findBreaksForEvent, toPublicClockEvent } = await clockCoreModule();
  return toPublicClockEvent(session, await findBreaksForEvent(idOf(session._id)));
}

/**
 * Two Sends of one draft at once each inserted a row: keep the draft's first
 * (firstClockRow) and drop this call's own if it isn't that one. Nothing was
 * written under it yet.
 */
async function settleIntent(userId, draftKey, mine) {
  const first = firstClockRow(await findDraftRows(userId, draftKey)) ?? mine;
  if (first._id === mine._id) return mine;
  await pulseUploadsCollection().deleteOne({ _id: mine._id, state: 'intent', postId: null });
  return first;
}

/** Hold the row for this call; null when another call for the draft holds it. */
async function takeLease(rowId, now) {
  const at = new Date(now);
  const { modifiedCount } = await pulseUploadsCollection().updateOne(
    { _id: rowId, $or: [{ clockCallAt: null }, { clockCallAt: { $lt: new Date(now - CLOCK_CALL_LEASE_MS) } }] },
    { $set: { clockCallAt: at } },
  );
  return modifiedCount ? at : null;
}

function releaseLease(rowId, at) {
  return pulseUploadsCollection().updateOne({ _id: rowId, clockCallAt: at }, { $unset: { clockCallAt: '' } });
}

/** Posts this call may already have written: the row's, and any carrying its video as expected or missing. */
function callPosts(userId, row) {
  const named = [{ 'pendingVideos.uploadId': row._id }, { 'missingVideos.uploadId': row._id }];
  if (row.postId && isObjectIdHex(row.postId)) named.push({ _id: toPostId(row.postId) });
  return posts()
    .find(
      { userId, $or: named },
      { projection: { sessionUpdate: 1, status: 1, clockEventId: 1, conversationId: 1, pendingVideos: 1, missingVideos: 1 } },
    )
    .toArray();
}

function recordOnRow(rowId, fields) {
  return pulseUploadsCollection().updateOne({ _id: rowId }, { $set: { ...fields, updatedAt: new Date() } });
}

/** End the session at `at`; one that ended meanwhile (by hand, or a call alongside) answers as recorded. */
async function stopSession(userId, value, at) {
  const { clockStop } = await clockModule();
  try {
    return await clockStop(userId, { teamId: value.teamId, clockEventId: value.clockEventId, at });
  } catch (err) {
    if (err instanceof Meteor.Error && err.error === 'not-found') {
      const session = await sessionOf(userId, value);
      if (session.endTime != null) return publicEvent(session);
    }
    throw err;
  }
}

/** Run what is left of the call for `row`, and answer with what the server recorded. */
async function runSteps(userId, value, row, session) {
  const stop = value.clock === 'stop';
  const sentAt = new Date(row.sentAt).getTime();
  const written = await callPosts(userId, row);
  let { steps, postId } = clockCallSteps(value.clock, { row, posts: written, session });
  let conversationId = written.find((p) => idOf(p._id) === postId)?.conversationId ?? null;

  if (steps.includes('post')) {
    // The row names the draft as the first call did.
    const named = { ...value, name: row.name ?? value.name };
    if (stop) {
      postId = await appendWrapUp(userId, wrapUpOptions(named, row._id, sentAt));
    } else {
      const created = await createHuddlePost(userId, planPostOptions(named, row._id, sentAt));
      postId = created.id;
      conversationId = created.conversationId ?? null;
    }
  }
  if (postId !== (row.postId ?? null)) {
    await recordOnRow(row._id, { postId, 'destination.postId': postId });
  }

  let clockEvent;
  if (stop) {
    clockEvent = steps.includes('clock') ? await stopSession(userId, value, sentAt) : await publicEvent(session);
  } else {
    const post = written.find((p) => idOf(p._id) === postId);
    if (steps.includes('clock')) {
      const { clockStart } = await clockModule();
      clockEvent = await clockStart(userId, { teamId: value.teamId, planPostId: postId, reuseOpen: true, at: sentAt });
    } else {
      const linked = await sessions().findOne({ _id: new ObjectId(post.clockEventId) });
      if (!linked) throw new Meteor.Error('not-found', 'The clock session for that plan is gone');
      clockEvent = await publicEvent(linked);
    }
    if (clockEvent.id !== row.clockEventId) await recordOnRow(row._id, { clockEventId: clockEvent.id });
  }

  return { uploadId: row._id, postId, clockEvent, ...(conversationId ? { conversationId: String(conversationId) } : {}) };
}

/**
 * One clock call (`name`: a PULSE_CLOCK_CALLS key) for the signed-in caller.
 * Refused before anything is written: bad arguments, a too-large video (O15),
 * a draft already sent somewhere else or without its clock action
 * (intentDecision), a session that isn't the caller's open one in the team,
 * or a team they aren't on.
 */
async function clockCall(name, { userId }, args) {
  const now = Date.now();
  const value = refuse(checkClockCallArgs(name, userId, args));
  const decision = intentDecision(await findDraftRows(userId, value.draftKey), value);
  if (decision.error) throw new Meteor.Error(decision.error, decision.reason);

  const session = value.clock === 'stop' ? await sessionOf(userId, value) : null;
  let row = decision.row ?? null;
  if (!row) {
    // A new Send: checked before anything is written, so a refusal leaves nothing.
    if (session && session.endTime != null) throw new Meteor.Error('not-found', 'That clock session has already ended');
    if (!session) await requireTeamMember(userId, value.teamId);
    const inserted = await insertIntent({
      userId,
      draftKey: value.draftKey,
      uploadType: value.type,
      target: value.target,
      sentAt: clockActionTime(value.at, now),
      clockEventId: value.clockEventId,
      teamId: value.teamId,
      name: value.name,
      bytes: value.bytes,
    });
    row = await settleIntent(userId, value.draftKey, inserted);
  }

  const lease = await takeLease(row._id, now);
  if (!lease) throw new Meteor.Error('conflict', 'That clock action is still being recorded. Try again in a moment.');
  try {
    // As it is now: the call that held it may have moved it on.
    const current = (await pulseUploadsCollection().findOne({ _id: row._id })) ?? row;
    return await runSteps(userId, value, current, session);
  } finally {
    await releaseLease(row._id, lease).catch((err) =>
      console.error(`[pulse-clock] releasing ${row._id} failed:`, err),
    );
  }
}

/** Both calls, signed in and rate-limited; pulse-uploads-expose.js exposes them through Wormhole. */
export const PULSE_CLOCK_METHOD_MAP = pulseUploadMethods(
  Object.fromEntries(Object.keys(PULSE_CLOCK_CALLS).map((name) => [name, (identity, args) => clockCall(name, identity, args)])),
  {
    requireIdentity,
    specs: PULSE_CLOCK_METHODS,
    tooManyRequests: (retryAfterMs) =>
      new Meteor.Error(TOO_MANY_PULSE_UPLOAD_CALLS.error, TOO_MANY_PULSE_UPLOAD_CALLS.reason, {
        timeToReset: retryAfterMs,
      }),
  },
);

Meteor.methods(PULSE_CLOCK_METHOD_MAP);

// A clock row whose video won't come (its draft deleted, or sending cancelled):
// its post says so. The clock record stays as it is (Q1).
registerPulseCancelHandler(async (stopped) => {
  const write = missingVideoWrite(stopped, { toPostId });
  if (write) await posts().updateOne(write.filter, write.update);
});
