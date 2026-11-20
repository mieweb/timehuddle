/**
 * Unit tests for pulse-delivery-core (server/pulse-delivery-core.js): how a
 * Pulse video sent from the app lands. A clock type's video goes on the post
 * stored at Send and never changes its session fields; a Huddle post joins
 * the session at Send as an update, never a plan; captions travel with the
 * video; a kept video reaches the library with why; the pushes; the overdue
 * marks; and what account deletion removes. Rows and posts are plain
 * objects in place of the collections.
 */
import { describe, it, expect } from 'vitest';

import {
  ACCOUNT_DELETED_REASON,
  accountPulseCleanup,
  artifactsToRemove,
  captionsAtDelivery,
  captionsOfId,
  deliveredPostUpdate,
  deliveryDestinationOf,
  huddlePostOptions,
  huddlePostPath,
  isPlanPost,
  keptMediaUpdate,
  landedPush,
  landedRowFields,
  missingPush,
  overdueMark,
  overduePostMark,
  overduePush,
  postAttachment,
  PULSE_SWEEP_INTERVAL_MS,
  pulseAttachmentFields,
  pushUrlOf,
  SESSION_POST_GONE,
  SESSION_POST_NOTES,
  sessionPostCheck,
  sessionPostDelivered,
  sessionPostFlagsCleared,
  sessionPostIdOf,
  sessionPostNote,
  sessionPostUpdate,
  sweepIntervalMs,
  UNFINISHED_STATES,
  withCaptions,
} from '../server/pulse-delivery-core';
import { overdueQuery, PULSE_OVERDUE_AFTER_MS } from '../server/pulse-uploads-core';

const USER = 'Us9dF2gH4jK6lZ8xC';
const OTHER = 'Ot3hErUs3rId00000';
const TEAM = 'd'.repeat(24);
const TICKET = 'a'.repeat(24);
const SESSION = 'c'.repeat(24);
const OTHER_SESSION = 'e'.repeat(24);
const POST = 'f'.repeat(24);
const UPLOAD = '5b1f6d2e-8c3a-4f7b-9e1d-2a3c4b5d6e7f';
const VIDEO_ID = '0b7e7c1e-5a3f-4c1d-9e2a-6f1d2c3b4a59';
const CAPTIONS_ID = '7d2a9c1f-3e4b-4a6c-8d9e-1f2a3b4c5d6e';
const NOW = new Date(Date.UTC(2026, 10, 18, 17, 2));
const HOUR = 60 * 60 * 1000;

const video = {
  artifactId: VIDEO_ID,
  url: `/pulsevault/artifacts/${VIDEO_ID}`,
  name: 'Fix login',
  title: `Video ${VIDEO_ID.slice(0, 8)}`,
  filename: `${VIDEO_ID}.mp4`,
  mimeType: 'video/mp4',
  size: 1234,
};

/** A PulseVault `getPulse` answer for the video, with or without its captions. */
function pulse(withVtt: boolean) {
  return {
    video: { artifactId: VIDEO_ID, kind: 'video', ext: '.mp4', ready: true },
    ...(withVtt ? { captions: { artifactId: CAPTIONS_ID, kind: 'captions', ext: '.vtt', ready: true } } : {}),
  };
}

function row(fields: Record<string, unknown> = {}) {
  return {
    _id: UPLOAD,
    userId: USER,
    type: 'ticket.video',
    state: 'processing',
    label: 'Fix login',
    platform: 'ios',
    artifactId: VIDEO_ID,
    destination: { kind: 'ticket', id: TICKET },
    sessionId: null,
    conversationId: null,
    postId: null,
    ...fields,
  };
}

const wrapupRow = (fields: Record<string, unknown> = {}) =>
  row({
    type: 'clock.wrapup',
    label: 'Wrap-up',
    destination: { kind: 'session-post', postId: POST, role: 'wrapup' },
    postId: POST,
    clockEventId: SESSION,
    ...fields,
  });

const planRow = (fields: Record<string, unknown> = {}) =>
  row({
    type: 'clock.plan',
    label: 'Plan',
    destination: { kind: 'session-post', postId: POST, role: 'plan' },
    postId: POST,
    ...fields,
  });

describe('captions at delivery', () => {
  it('sets captionsId and captionsUrl when getPulse returns a captions artifact', () => {
    expect(captionsAtDelivery(pulse(true))).toEqual({
      captionsId: CAPTIONS_ID,
      captionsUrl: `/pulsevault/artifacts/${CAPTIONS_ID}`,
    });
  });

  it('leaves both null without one, or when the pulse could not be read', () => {
    expect(captionsAtDelivery(pulse(false))).toEqual({ captionsId: null, captionsUrl: null });
    expect(captionsAtDelivery(null)).toEqual({ captionsId: null, captionsUrl: null });
  });

  it("reads captionsIdFor's answer the same way", () => {
    expect(captionsOfId(CAPTIONS_ID)).toEqual({
      captionsId: CAPTIONS_ID,
      captionsUrl: `/pulsevault/artifacts/${CAPTIONS_ID}`,
    });
    expect(captionsOfId(null)).toEqual({ captionsId: null, captionsUrl: null });
    expect(captionsOfId('not-an-id')).toEqual({ captionsId: null, captionsUrl: null });
  });

  it("puts the captions' URL on the video and on its post attachment, only when there is one", () => {
    const captioned = withCaptions(video, `/pulsevault/artifacts/${CAPTIONS_ID}`);
    expect(postAttachment('m1', captioned)).toEqual({
      mediaId: 'm1',
      type: 'video',
      url: video.url,
      filename: video.title,
      captionsUrl: `/pulsevault/artifacts/${CAPTIONS_ID}`,
    });
    expect(withCaptions(video, null)).toBe(video);
    // The link flow's video has none: the attachment is the shape it always was.
    expect(postAttachment('m1', video)).toEqual({ mediaId: 'm1', type: 'video', url: video.url, filename: video.title });
  });
});

describe('the destination a row delivers to', () => {
  it("carries the row and, for a Huddle post, the session and conversation at Send", () => {
    const huddle = row({
      type: 'huddle.post',
      destination: { kind: 'huddle', teamId: TEAM },
      sessionId: SESSION,
      conversationId: 'conv-1',
    });
    expect(deliveryDestinationOf(huddle)).toEqual({
      kind: 'huddle',
      teamId: TEAM,
      pulseUploadId: UPLOAD,
      uploadType: 'huddle.post',
      sessionUpdateId: SESSION,
      conversationId: 'conv-1',
    });
  });

  it('passes a ticket its row for the attachment, and nothing about sessions', () => {
    expect(deliveryDestinationOf(row())).toEqual({
      kind: 'ticket',
      id: TICKET,
      pulseUploadId: UPLOAD,
      uploadType: 'ticket.video',
    });
    expect(deliveryDestinationOf(row({ destination: null }))).toBeNull();
  });

  it("gives a ticket's attachment the Pulse fields, null upload for the link flow", () => {
    expect(pulseAttachmentFields(video, deliveryDestinationOf(row()))).toEqual({
      source: 'pulse',
      videoid: VIDEO_ID,
      pulseUploadId: UPLOAD,
      uploadType: 'ticket.video',
    });
    expect(pulseAttachmentFields(video, { kind: 'ticket', id: TICKET })).toEqual({
      source: 'pulse',
      videoid: VIDEO_ID,
      pulseUploadId: null,
      uploadType: null,
    });
    expect(pulseAttachmentFields({ ...video, artifactId: undefined }, { kind: 'ticket', id: TICKET })).toEqual({});
  });
});

describe('session-post delivery (clock.wrapup, clock.plan)', () => {
  it('targets the postId stored on the row', () => {
    expect(sessionPostIdOf(wrapupRow())).toBe(POST);
    // The destination's own postId wins over anything else on the row.
    expect(sessionPostIdOf(wrapupRow({ postId: 'other' }))).toBe(POST);
    expect(sessionPostIdOf(row())).toBeNull();
  });

  it('builds one update on that post: the attachment with captions pushed, the marks pulled', () => {
    const attachment = postAttachment('m1', withCaptions(video, `/pulsevault/artifacts/${CAPTIONS_ID}`));
    const write = sessionPostUpdate({ postId: POST, userId: USER, uploadId: UPLOAD, attachment, now: NOW });
    expect(write.filter).toEqual({ _id: POST, userId: USER, 'attachments.url': { $ne: video.url } });
    expect(write.update).toEqual({
      $push: { attachments: attachment },
      $pull: { pendingVideos: { uploadId: UPLOAD }, missingVideos: { uploadId: UPLOAD } },
      $set: { updatedAt: NOW },
    });
    expect(write.update.$push.attachments.captionsUrl).toBe(`/pulsevault/artifacts/${CAPTIONS_ID}`);
  });

  it('never sets sessionUpdate or clockEventId on the post, so a plan stays a plan', () => {
    const write = sessionPostUpdate({
      postId: POST,
      userId: USER,
      uploadId: UPLOAD,
      attachment: postAttachment('m1', video),
      now: NOW,
    });
    const touched = JSON.stringify(write.update);
    expect(touched).not.toMatch(/sessionUpdate/);
    expect(touched).not.toMatch(/clockEventId/);
    expect(JSON.stringify(sessionPostFlagsCleared({ postId: POST, uploadId: UPLOAD }))).not.toMatch(/sessionUpdate/);
  });

  it('is delivered once the post carries the video (a replay only clears the marks)', () => {
    expect(sessionPostDelivered({ attachments: [{ url: video.url }] }, video)).toBe(true);
    expect(sessionPostDelivered({ attachments: [{ url: '/pulsevault/artifacts/other' }] }, video)).toBe(false);
    expect(sessionPostDelivered({}, video)).toBe(false);
    expect(sessionPostFlagsCleared({ postId: POST, uploadId: UPLOAD })).toEqual({
      filter: { _id: POST },
      update: { $pull: { pendingVideos: { uploadId: UPLOAD }, missingVideos: { uploadId: UPLOAD } } },
    });
  });

  it("keeps the video when the post is gone or isn't the uploader's", () => {
    expect(sessionPostCheck({ _id: POST, userId: USER }, wrapupRow())).toEqual({ ok: true });
    expect(sessionPostCheck(null, wrapupRow())).toEqual({ kept: SESSION_POST_GONE });
    expect(sessionPostCheck({ _id: POST, userId: OTHER }, wrapupRow())).toEqual({ kept: SESSION_POST_GONE });
  });

  it("notes the role's video", () => {
    expect(sessionPostNote(wrapupRow())).toBe(SESSION_POST_NOTES.wrapup);
    expect(sessionPostNote(planRow())).toBe(SESSION_POST_NOTES.plan);
  });
});

describe('a Huddle post sent in a session (H4, Q8)', () => {
  it("joins with main's joinOpenSession while the session at Send is still open", () => {
    expect(huddlePostOptions({ sessionId: SESSION, openSessionId: SESSION })).toEqual({ joinOpenSession: true });
    expect(huddlePostOptions({ sessionId: SESSION, openSessionId: OTHER_SESSION })).toEqual({ joinOpenSession: false });
    expect(huddlePostOptions({ sessionId: SESSION, openSessionId: null })).toEqual({ joinOpenSession: false });
    // Sent while clocked out: never joins whatever is open at delivery.
    expect(huddlePostOptions({ sessionId: null, openSessionId: SESSION })).toEqual({ joinOpenSession: false });
  });

  it('builds an update post in the stored session when the post is unlinked', () => {
    const write = deliveredPostUpdate({ post: { _id: POST, userId: USER }, sessionId: SESSION, videoUrl: video.url });
    expect(write).toEqual({
      filter: { _id: POST, userId: USER, $or: [{ clockEventId: null }, { sessionUpdate: true }] },
      update: { $set: { clockEventId: SESSION, sessionUpdate: true } },
    });
  });

  it('moves an update post that joined a later session back to the one at Send', () => {
    const write = deliveredPostUpdate({
      post: { _id: POST, userId: USER, clockEventId: OTHER_SESSION, sessionUpdate: true },
      sessionId: SESSION,
      videoUrl: video.url,
    });
    expect(write?.update.$set).toEqual({ clockEventId: SESSION, sessionUpdate: true });
  });

  it('never sets sessionUpdate on a plan post', () => {
    const plan = { _id: POST, userId: USER, clockEventId: OTHER_SESSION };
    expect(isPlanPost(plan)).toBe(true);
    expect(deliveredPostUpdate({ post: plan, sessionId: SESSION, videoUrl: video.url })).toBeNull();
    // Only the captions, then; the post's session fields stay as they are.
    const captioned = deliveredPostUpdate({
      post: { ...plan, attachments: [{ url: video.url }] },
      sessionId: SESSION,
      captionsUrl: `/pulsevault/artifacts/${CAPTIONS_ID}`,
      videoUrl: video.url,
    });
    expect(captioned?.update.$set).toEqual({ 'attachments.$[video].captionsUrl': `/pulsevault/artifacts/${CAPTIONS_ID}` });
    expect(JSON.stringify(captioned)).not.toMatch(/sessionUpdate/);
  });

  it('changes nothing for a post already in that session, or sent outside one', () => {
    const joined = { _id: POST, userId: USER, clockEventId: SESSION, sessionUpdate: true };
    expect(deliveredPostUpdate({ post: joined, sessionId: SESSION, videoUrl: video.url })).toBeNull();
    expect(deliveredPostUpdate({ post: { _id: POST, userId: USER }, sessionId: null, videoUrl: video.url })).toBeNull();
    expect(deliveredPostUpdate({ post: null, sessionId: SESSION, videoUrl: video.url })).toBeNull();
  });

  it("puts the captions on the video's attachment, once", () => {
    const captionsUrl = `/pulsevault/artifacts/${CAPTIONS_ID}`;
    const write = deliveredPostUpdate({
      post: { _id: POST, userId: USER, attachments: [{ url: video.url }] },
      captionsUrl,
      videoUrl: video.url,
    });
    expect(write).toEqual({
      filter: { _id: POST, userId: USER },
      update: { $set: { 'attachments.$[video].captionsUrl': captionsUrl } },
      options: { arrayFilters: [{ 'video.url': video.url }] },
    });
    expect(
      deliveredPostUpdate({
        post: { _id: POST, userId: USER, attachments: [{ url: video.url, captionsUrl }] },
        captionsUrl,
        videoUrl: video.url,
      }),
    ).toBeNull();
  });
});

describe('a kept video', () => {
  it('goes to the library (not embedded) with its reason', () => {
    expect(keptMediaUpdate('Ticket not found — it was gone before the video finished uploading.')).toEqual({
      $set: { keptReason: 'Ticket not found — it was gone before the video finished uploading.' },
      $unset: { embedded: '' },
    });
    expect(keptMediaUpdate(null).$set.keptReason).toBe('Kept in your library');
  });
});

describe('the row once its video landed', () => {
  it('records the outcome, what it became, its captions, and clears the overdue flag', () => {
    expect(
      landedRowFields({
        to: 'delivered',
        outcome: { state: 'done', note: 'Attached to ticket x' },
        mediaId: 'm1',
        attachmentId: 'a1',
        captionsArtifactId: CAPTIONS_ID,
        now: NOW,
      }),
    ).toEqual({
      state: 'delivered',
      note: 'Attached to ticket x',
      reason: null,
      mediaId: 'm1',
      attachmentId: 'a1',
      captionsArtifactId: CAPTIONS_ID,
      overdueAt: null,
      deliveredAt: NOW,
      updatedAt: NOW,
    });
    expect(landedRowFields({ to: 'kept', outcome: { state: 'kept', reason: 'Gone' }, now: NOW })).toMatchObject({
      state: 'kept',
      note: null,
      reason: 'Gone',
      mediaId: null,
      captionsArtifactId: null,
      overdueAt: null,
    });
  });
});

describe('pushes', () => {
  it('says where a delivered video went, with the place to open', () => {
    expect(landedPush(row(), { state: 'delivered', outcome: { state: 'done' } })).toEqual({
      userId: USER,
      title: 'Video delivered',
      body: 'Video attached to Fix login',
      data: { type: 'pulse-upload', uploadId: UPLOAD, state: 'delivered', url: `/app/tickets/${TICKET}` },
    });
    expect(landedPush(wrapupRow(), { state: 'delivered', outcome: { state: 'done' } }).body).toBe(
      'Video attached to your wrap-up',
    );
    expect(landedPush(planRow(), { state: 'delivered', outcome: { state: 'done' } }).body).toBe(
      'Video attached to your plan',
    );
  });

  it('says why a kept video is in the library, and opens its watch page', () => {
    const push = landedPush(row(), {
      state: 'kept',
      outcome: { state: 'kept', reason: 'Ticket not found — it was gone before the video finished uploading.' },
      artifactId: VIDEO_ID,
    });
    expect(push.body).toBe('Saved to your library: Ticket not found — it was gone before the video finished uploading');
    expect(push.data).toEqual({ type: 'pulse-upload', uploadId: UPLOAD, state: 'kept', url: `/watch/${VIDEO_ID}` });
  });

  it("links each place's page", () => {
    expect(pushUrlOf(row({ destination: { kind: 'clock', id: SESSION } }))).toBe('/app/clock');
    expect(pushUrlOf(wrapupRow())).toBe('/app/clock');
    const huddle = row({ type: 'huddle.post', destination: { kind: 'huddle', teamId: TEAM } });
    expect(pushUrlOf(huddle, { postId: POST })).toBe(huddlePostPath(TEAM, POST));
    expect(huddlePostPath(TEAM, POST)).toBe(`/app/huddle?team=${TEAM}&post=${POST}`);
    expect(pushUrlOf(huddle)).toBe(`/app/huddle?team=${TEAM}`);
    expect(pushUrlOf(row({ destination: { kind: 'library' } }))).toBe(`/watch/${VIDEO_ID}`);
  });

  it('pushes once about an overdue clock video, naming the phone', () => {
    expect(overduePush(wrapupRow({ state: 'reserved' }))).toEqual({
      userId: USER,
      title: "Wrap-up video hasn't arrived",
      body: "Your wrap-up video hasn't arrived yet. Open TimeHuddle on your iPhone to send it.",
      data: { type: 'pulse-upload', uploadId: UPLOAD, state: 'reserved', url: '/app/clock' },
    });
    expect(overduePush(planRow({ state: 'intent', platform: 'android' }))?.body).toBe(
      "Your plan video hasn't arrived yet. Open TimeHuddle on your Android phone to send it.",
    );
    // Not a clock type: overdue for support only, no push.
    expect(overduePush(row({ state: 'reserved' }))).toBeNull();
  });

  it("says a clock video didn't arrive when PulseVault gave up on it, not when the draft was deleted", () => {
    expect(missingPush({ row: wrapupRow(), to: 'abandoned', reason: 'abandoned' })).toMatchObject({
      userId: USER,
      body: "Wrap-up video didn't arrive",
      data: { type: 'pulse-upload', uploadId: UPLOAD, state: 'abandoned', url: '/app/clock' },
    });
    expect(missingPush({ row: planRow(), to: 'abandoned', reason: 'abandoned' })?.body).toBe("Plan video didn't arrive");
    expect(missingPush({ row: wrapupRow(), to: 'abandoned', reason: 'deleted' })).toBeNull();
    expect(missingPush({ row: wrapupRow(), to: 'canceled', reason: 'canceled' })).toBeNull();
    expect(missingPush({ row: row(), to: 'abandoned', reason: 'abandoned' })).toBeNull();
  });
});

describe('the overdue sweep', () => {
  it('runs hourly unless the environment says otherwise', () => {
    expect(sweepIntervalMs(undefined)).toBe(PULSE_SWEEP_INTERVAL_MS);
    expect(PULSE_SWEEP_INTERVAL_MS).toBe(HOUR);
    expect(sweepIntervalMs('2000')).toBe(2000);
    expect(sweepIntervalMs('10')).toBe(PULSE_SWEEP_INTERVAL_MS);
    expect(sweepIntervalMs('soon')).toBe(PULSE_SWEEP_INTERVAL_MS);
  });

  it('marks a row once, only while its video still has not landed', () => {
    const sentAt = new Date(NOW.getTime() - 25 * HOUR);
    const reserved = wrapupRow({ state: 'reserved', sentAt, overdueAt: null });
    // The sweep's query picks a 25 h reserved row.
    const query = overdueQuery(NOW.getTime());
    expect(query.state.$in).toContain('reserved');
    expect(query.overdueAt).toBeNull();
    const cutoff = (query.$or[0].sentAt as { $lte: Date }).$lte;
    expect(cutoff.getTime()).toBe(NOW.getTime() - PULSE_OVERDUE_AFTER_MS);
    expect(sentAt.getTime()).toBeLessThan(cutoff.getTime());

    expect(overdueMark(reserved, NOW)).toEqual({
      filter: { _id: UPLOAD, state: { $in: ['intent', 'reserved', 'uploading'] }, overdueAt: null },
      update: { $set: { overdueAt: NOW } },
    });
    // A flag, never a state: the row is not abandoned (O14).
    expect(JSON.stringify(overdueMark(reserved, NOW).update)).not.toMatch(/state/);
  });

  it("marks a clock type's pending entry on its post, which delivery's pull clears", () => {
    expect(overduePostMark({ row: wrapupRow(), postId: POST, now: NOW })).toEqual({
      filter: { _id: POST, userId: USER, 'pendingVideos.uploadId': UPLOAD },
      update: { $set: { 'pendingVideos.$.overdueAt': NOW } },
    });
    expect(overduePostMark({ row: row(), postId: POST, now: NOW })).toBeNull();
    expect(overduePostMark({ row: wrapupRow(), postId: null, now: NOW })).toBeNull();
    const delivered = sessionPostUpdate({
      postId: POST,
      userId: USER,
      uploadId: UPLOAD,
      attachment: postAttachment('m1', video),
      now: NOW,
    });
    expect(delivered.update.$pull.pendingVideos).toEqual({ uploadId: UPLOAD });
  });
});

describe('account deletion', () => {
  it("cancels the user's unfinished rows, then removes their videos, attachments and rows", () => {
    const plan = accountPulseCleanup(USER, NOW);
    expect(plan.cancel).toEqual({
      filter: { userId: USER, state: { $in: [...UNFINISHED_STATES] } },
      update: { $set: { state: 'canceled', reason: ACCOUNT_DELETED_REASON, updatedAt: NOW } },
    });
    expect(UNFINISHED_STATES).toEqual(['intent', 'reserved', 'uploading', 'processing']);
    expect(plan.videoItems).toEqual({ userId: USER, videoid: { $type: 'string' } });
    expect(plan.attachments).toEqual({ addedBy: USER, type: 'video' });
    expect(plan.uploads).toEqual({ userId: USER });
  });

  it('removes every PulseVault video once: media items and rows, replaced artifacts too', () => {
    const items = [{ videoid: 'v1' }, { videoid: 'v2' }, { videoid: null }];
    const rows = [
      { artifactId: 'v2', replacedArtifactIds: ['v0'] },
      { artifactId: 'v3', replacedArtifactIds: [] },
      { artifactId: null },
    ];
    expect(artifactsToRemove(rows, items).sort()).toEqual(['v0', 'v1', 'v2', 'v3']);
    expect(artifactsToRemove([], [])).toEqual([]);
  });
});
