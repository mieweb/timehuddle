/**
 * clock.stopWithVideo / clock.startWithPlan — wormhole REST + TUS integration
 * tests (huddle-server §9, TH-5): the clock action happens at Send, at `at`,
 * on a plan-first team; the video lands on that post later and never clocks
 * anyone; a second call for the draft changes nothing; a too-large video
 * changes nothing; a video that won't come marks its post, and a later one
 * clears the mark.
 *
 * Needs the test backend (tests/setup.ts) with PulseVault mounted; the video
 * upload uses the e2e fixture. The delivery cases need the session-post
 * delivery in pulse-upload-delivery.js (PR3-S8). Run by PR3-V1.
 *
 * A test against a running server can't spy on clockStop. "Delivery never
 * clocks" is checked by what clockStop and clockStart would change: the
 * session's endTime stays `at`, and a session opened after the clock-out
 * stays open once the video lands.
 */
import { randomBytes } from 'crypto';
import { readFileSync } from 'fs';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { METEOR_URL } from './setup';
import { createUserAndGetJwt, wormhole, getDb, closeDb, purgeUser, ObjectId } from './helpers';

const OWNER = { name: 'Pulse Clock Owner', email: 'wh-pulse-clock-owner@test.dev', password: 'Password1!' };
const OUTSIDER = { name: 'Pulse Clock Outsider', email: 'wh-pulse-clock-outsider@test.dev', password: 'Password1!' };

const VIDEO = readFileSync(new URL('../../tests/e2e/fixtures/test-video.mp4', import.meta.url));
const MINUTE = 60 * 1000;

let ownerJwt: string;
let outsiderJwt: string;
let ownerId: string;
const teamIds: string[] = [];

const INSTALLATION = `pr3s9-${randomBytes(4).toString('hex')}`;
let drafts = 0;

/** A new draft on this "phone": its draftKey and a clientKey for one export of it. */
function newDraft() {
  drafts += 1;
  const draftKey = `${INSTALLATION}:draft-${drafts}`;
  return { draftKey, clientKey: () => `${draftKey}:${randomBytes(8).toString('hex')}` };
}

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

type ClockEvent = { id: string; startTime: number; endTime: number | null };
type ClockResult = { uploadId: string; postId: string; clockEvent: ClockEvent; conversationId?: string };
type Grant = { uploadId: string; clientKey: string; artifactId: string; token: string; state: string };

/** A plan-first team of its own for one test, so its sessions don't meet another test's. */
async function newTeam(requirePlanForClock = true) {
  const db = await getDb();
  const _id = new ObjectId();
  await db.collection('teams').insertOne({
    _id,
    name: `WH Pulse Clock ${teamIds.length + 1}`,
    members: [ownerId],
    admins: [],
    code: `WHPC${randomBytes(3).toString('hex').toUpperCase()}`,
    isPersonal: false,
    settings: { requirePlanForClock },
    createdAt: new Date(),
  });
  const teamId = _id.toHexString();
  teamIds.push(teamId);
  return teamId;
}

async function clockIn(teamId: string, at: number) {
  const res = await wormhole<ClockEvent>('clock.start', { teamId, at }, ownerJwt);
  expect(res.ok, res.error).toBe(true);
  return res.result;
}

function stopWithVideo(teamId: string, clockEventId: string, draftKey: string, extra: Record<string, unknown> = {}) {
  return wormhole<ClockResult>(
    'clock.stopWithVideo',
    { teamId, clockEventId, postDate: today(), at: Date.now() - 5 * MINUTE, draftKey, bytes: VIDEO.length, name: 'Shipped it', ...extra },
    ownerJwt,
  );
}

function startWithPlan(teamId: string, draftKey: string, extra: Record<string, unknown> = {}, jwt = ownerJwt) {
  return wormhole<ClockResult>(
    'clock.startWithPlan',
    { teamId, postDate: today(), at: Date.now() - 3 * MINUTE, draftKey, bytes: VIDEO.length, name: 'Plan for today', ...extra },
    jwt,
  );
}

function begin(type: string, target: Record<string, unknown>, clientKey: string, draftKey: string) {
  return wormhole<Grant>(
    'pulseUploads.begin',
    { clientKey, draftKey, type, target, sentAt: Date.now(), bytes: VIDEO.length, client: { platform: 'ios' } },
    ownerJwt,
  );
}

async function sessionOf(id: string) {
  return (await getDb()).collection('clockevents').findOne({ _id: new ObjectId(id) });
}
async function postOf(id: string) {
  return (await getDb()).collection('huddlePosts').findOne({ _id: new ObjectId(id) });
}
async function rowOf(uploadId: string) {
  return (await getDb()).collection('pulseUploads').findOne({ _id: uploadId as unknown as ObjectId });
}

const metadata = (fields: Record<string, string>) =>
  Object.entries(fields)
    .map(([key, value]) => `${key} ${Buffer.from(value, 'utf8').toString('base64')}`)
    .join(',');

/** The whole video under `grant`: one TUS create and one PATCH. */
async function uploadVideo(grant: Grant) {
  const created = await fetch(`${METEOR_URL}/pulsevault/upload`, {
    method: 'POST',
    headers: {
      'Tus-Resumable': '1.0.0',
      'Upload-Length': String(VIDEO.length),
      'Upload-Metadata': metadata({ artifactId: grant.artifactId, filename: 'pulse.mp4', kind: 'video', name: 'Shipped it' }),
      Authorization: `Bearer ${grant.token}`,
    },
  });
  expect(created.status).toBe(201);
  const patched = await fetch(new URL(created.headers.get('location')!, METEOR_URL), {
    method: 'PATCH',
    headers: {
      'Tus-Resumable': '1.0.0',
      'Upload-Offset': '0',
      'Content-Type': 'application/offset+octet-stream',
      Authorization: `Bearer ${grant.token}`,
    },
    body: VIDEO,
  });
  expect(patched.status).toBe(204);
}

/** Wait until the row is in one of `states` (delivery runs after conform). */
async function waitForState(uploadId: string, states: string[], timeoutMs = 90_000) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const row = await rowOf(uploadId);
    if (row && states.includes(row.state)) return row;
    if (Date.now() > until) throw new Error(`upload ${uploadId} stayed ${row?.state}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

const videoUrl = (grant: Grant) => `/pulsevault/artifacts/${grant.artifactId}`;
type Attachment = { type: string; url: string };
const videosOn = (post: Record<string, unknown> | null) =>
  ((post?.attachments ?? []) as Attachment[]).filter((a) => a.type === 'video');
const marked = (list: Array<{ uploadId: string }> | undefined) => (list ?? []).map((mark) => mark.uploadId);

beforeAll(async () => {
  await Promise.all([OWNER, OUTSIDER].map((user) => purgeUser(user.email)));
  const [owner, outsider] = await Promise.all([OWNER, OUTSIDER].map((user) => createUserAndGetJwt(user)));
  ownerJwt = owner.jwt;
  outsiderJwt = outsider.jwt;
  ownerId = owner.userId;
});

afterAll(async () => {
  const db = await getDb();
  await db.collection('pulseUploads').deleteMany({ userId: ownerId });
  await db.collection('attachments').deleteMany({ addedBy: ownerId });
  await db.collection('mediaitems').deleteMany({ userId: ownerId });
  await db.collection('huddlePosts').deleteMany({ teamId: { $in: teamIds } });
  await db.collection('clockevents').deleteMany({ teamId: { $in: teamIds } });
  await db.collection('teams').deleteMany({ _id: { $in: teamIds.map((id) => new ObjectId(id)) } });
  await Promise.all([OWNER, OUTSIDER].map((user) => purgeUser(user.email)));
  await closeDb();
});

describe('clock.stopWithVideo', () => {
  it('clocks out at `at` on a plan-first team with no session post: the post is made with the wrap-up, the video expected', async () => {
    const teamId = await newTeam();
    const session = await clockIn(teamId, Date.now() - 20 * MINUTE);
    const draft = newDraft();
    const at = Date.now() - 5 * MINUTE;
    const res = await stopWithVideo(teamId, session.id, draft.draftKey, { at });
    expect(res.ok, res.error).toBe(true);
    expect(res.result.clockEvent).toMatchObject({ id: session.id, endTime: at });
    expect((await sessionOf(session.id))!.endTime).toBe(at);

    const post = await postOf(res.result.postId);
    expect(post).toMatchObject({ userId: ownerId, teamId, clockEventId: session.id, content: { text: '**Wrap-up:** Shipped it' } });
    expect(post!.wrapUpAt).toBeInstanceOf(Date);
    expect(post!.sessionUpdate).toBeUndefined();
    expect(videosOn(post)).toEqual([]);
    expect(post!.pendingVideos).toEqual([{ uploadId: res.result.uploadId, role: 'wrapup', at: new Date(at) }]);

    expect(await rowOf(res.result.uploadId)).toMatchObject({
      state: 'intent',
      type: 'clock.wrapup',
      draftKey: draft.draftKey,
      clientKey: null,
      postId: res.result.postId,
      clockEventId: session.id,
      destination: { kind: 'session-post', postId: res.result.postId, role: 'wrapup' },
      sentAt: new Date(at),
    });

    // The feed shows it as on its way.
    const feed = await wormhole<{ post: { pendingVideos: unknown[]; missingVideos: unknown[] } | null }>(
      'huddle.getMyPostForSession',
      { teamId, clockEventId: session.id },
      ownerJwt,
    );
    expect(feed.result.post).toMatchObject({
      pendingVideos: [{ uploadId: res.result.uploadId, role: 'wrapup', at: new Date(at).toISOString() }],
      missingVideos: [],
    });
  });

  it("appends to the session's plan post, never to an update post", async () => {
    const teamId = await newTeam();
    const session = await clockIn(teamId, Date.now() - 20 * MINUTE);
    const db = await getDb();
    const plan = new ObjectId();
    const update = new ObjectId();
    await db.collection('huddlePosts').insertMany([
      { _id: plan, teamId, userId: ownerId, clockEventId: session.id, content: { text: 'Plan', mentions: [] }, attachments: [], createdAt: new Date(Date.now() - 19 * MINUTE), updatedAt: new Date() },
      { _id: update, teamId, userId: ownerId, clockEventId: session.id, sessionUpdate: true, content: { text: 'Update', mentions: [] }, attachments: [], createdAt: new Date(Date.now() - 10 * MINUTE), updatedAt: new Date() },
    ]);
    const res = await stopWithVideo(teamId, session.id, newDraft().draftKey);
    expect(res.ok, res.error).toBe(true);
    expect(res.result.postId).toBe(plan.toHexString());
    expect((await postOf(plan.toHexString()))!.content.text).toBe('Plan\n\n**Wrap-up:** Shipped it');
    const untouched = await postOf(update.toHexString());
    expect(untouched!.wrapUpAt).toBeUndefined();
    expect(untouched!.pendingVideos).toBeUndefined();
  });

  it('the same draftKey twice: one clock change, one line, the same answer', async () => {
    const teamId = await newTeam();
    const session = await clockIn(teamId, Date.now() - 20 * MINUTE);
    const draft = newDraft();
    const first = await stopWithVideo(teamId, session.id, draft.draftKey);
    const again = await stopWithVideo(teamId, session.id, draft.draftKey, { at: Date.now(), name: 'Edited' });
    expect(again.ok, again.error).toBe(true);
    expect(again.result).toMatchObject({ uploadId: first.result.uploadId, postId: first.result.postId });
    expect(again.result.clockEvent.endTime).toBe(first.result.clockEvent.endTime);

    const db = await getDb();
    expect(await db.collection('pulseUploads').countDocuments({ draftKey: draft.draftKey })).toBe(1);
    expect(await db.collection('clockevents').countDocuments({ teamId })).toBe(1);
    const post = await postOf(first.result.postId);
    expect(post!.content.text).toBe('**Wrap-up:** Shipped it');
    expect(post!.pendingVideos).toHaveLength(1);
  });

  it('a retry after the clock-out failed runs only the clock-out, at the first call’s time', async () => {
    const teamId = await newTeam();
    const session = await clockIn(teamId, Date.now() - 20 * MINUTE);
    const draft = newDraft();
    const at = Date.now() - 5 * MINUTE;
    const first = await stopWithVideo(teamId, session.id, draft.draftKey, { at });
    expect(first.ok, first.error).toBe(true);
    // As if clockStop had failed after the line was written.
    const db = await getDb();
    await db.collection('clockevents').updateOne({ _id: new ObjectId(session.id) }, { $set: { endTime: null } });

    const retry = await stopWithVideo(teamId, session.id, draft.draftKey, { at: Date.now() });
    expect(retry.ok, retry.error).toBe(true);
    expect(retry.result.clockEvent.endTime).toBe(at);
    expect((await postOf(first.result.postId))!.content.text).toBe('**Wrap-up:** Shipped it');
  });

  it('refuses a too-large video before any change', async () => {
    const teamId = await newTeam();
    const session = await clockIn(teamId, Date.now() - 20 * MINUTE);
    const draft = newDraft();
    const res = await stopWithVideo(teamId, session.id, draft.draftKey, { bytes: 600 * 1024 * 1024 });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Too large/);
    const db = await getDb();
    expect((await sessionOf(session.id))!.endTime).toBeNull();
    expect(await db.collection('pulseUploads').countDocuments({ draftKey: draft.draftKey })).toBe(0);
    expect(await db.collection('huddlePosts').countDocuments({ teamId })).toBe(0);
  });

  it('refuses a session that already ended, writing nothing', async () => {
    const teamId = await newTeam(false);
    const session = await clockIn(teamId, Date.now() - 20 * MINUTE);
    expect((await wormhole('clock.stop', { teamId }, ownerJwt)).ok).toBe(true);
    const draft = newDraft();
    const res = await stopWithVideo(teamId, session.id, draft.draftKey);
    expect(res.ok).toBe(false);
    const db = await getDb();
    expect(await db.collection('pulseUploads').countDocuments({ draftKey: draft.draftKey })).toBe(0);
  });
});

describe('the wrap-up video, later', () => {
  it('attaches to the post and never clocks: a session opened since stays open', async () => {
    const teamId = await newTeam();
    const session = await clockIn(teamId, Date.now() - 20 * MINUTE);
    const draft = newDraft();
    const at = Date.now() - 5 * MINUTE;
    const stop = await stopWithVideo(teamId, session.id, draft.draftKey, { at });
    expect(stop.ok, stop.error).toBe(true);
    // Hours later in real life: clocked in again before the video gets through.
    const next = await clockIn(teamId, Date.now());

    const grant = await begin('clock.wrapup', { kind: 'clock', id: session.id }, draft.clientKey(), draft.draftKey);
    expect(grant.ok, grant.error).toBe(true);
    expect(grant.result.uploadId).toBe(stop.result.uploadId);
    await uploadVideo(grant.result);
    expect(await waitForState(grant.result.uploadId, ['delivered', 'kept'])).toMatchObject({ state: 'delivered' });

    expect((await sessionOf(session.id))!.endTime).toBe(at);
    expect((await sessionOf(next.id))!.endTime).toBeNull();
    const post = await postOf(stop.result.postId);
    expect(videosOn(post).map((a) => a.url)).toEqual([videoUrl(grant.result)]);
    expect(marked(post!.pendingVideos)).toEqual([]);
  });

  it('Send → Edit → Send attaches once, and flags nothing', async () => {
    const teamId = await newTeam();
    const session = await clockIn(teamId, Date.now() - 20 * MINUTE);
    const draft = newDraft();
    const stop = await stopWithVideo(teamId, session.id, draft.draftKey);
    expect(stop.ok, stop.error).toBe(true);
    const target = { kind: 'clock', id: session.id };
    const first = await begin('clock.wrapup', target, draft.clientKey(), draft.draftKey);
    expect(first.ok, first.error).toBe(true);
    // The Edit: a new export of the same draft, sent again.
    const again = await stopWithVideo(teamId, session.id, draft.draftKey);
    expect(again.result.uploadId).toBe(stop.result.uploadId);
    const edited = await begin('clock.wrapup', target, draft.clientKey(), draft.draftKey);
    expect(edited.ok, edited.error).toBe(true);
    expect(edited.result.uploadId).toBe(first.result.uploadId);
    expect(edited.result.artifactId).not.toBe(first.result.artifactId);

    await uploadVideo(edited.result);
    expect(await waitForState(edited.result.uploadId, ['delivered', 'kept'])).toMatchObject({ state: 'delivered' });
    const post = await postOf(stop.result.postId);
    expect(videosOn(post).map((a) => a.url)).toEqual([videoUrl(edited.result)]);
    expect(marked(post!.pendingVideos)).toEqual([]);
    expect(marked(post!.missingVideos)).toEqual([]);
  });

  it('cancelled after the clock-out: the post says it is missing, the clock is unchanged; a later delivery clears it', async () => {
    const teamId = await newTeam();
    const session = await clockIn(teamId, Date.now() - 20 * MINUTE);
    const draft = newDraft();
    const at = Date.now() - 5 * MINUTE;
    const stop = await stopWithVideo(teamId, session.id, draft.draftKey, { at });
    expect(stop.ok, stop.error).toBe(true);
    const clientKey = draft.clientKey();
    const grant = await begin('clock.wrapup', { kind: 'clock', id: session.id }, clientKey, draft.draftKey);
    expect(grant.ok, grant.error).toBe(true);

    const cancelled = await wormhole<{ state: string }>('pulseUploads.cancel', { uploadId: grant.result.uploadId }, ownerJwt);
    expect(cancelled.result.state).toBe('canceled');
    let post = await postOf(stop.result.postId);
    expect(marked(post!.pendingVideos)).toEqual([]);
    expect(marked(post!.missingVideos)).toEqual([stop.result.uploadId]);
    expect((await sessionOf(session.id))!.endTime).toBe(at);

    // Cancelling again marks it once.
    await wormhole('pulseUploads.cancel', { uploadId: grant.result.uploadId, reason: 'deleted' }, ownerJwt);
    expect(marked((await postOf(stop.result.postId))!.missingVideos)).toEqual([stop.result.uploadId]);

    // Sent again after all: the video lands and the mark goes.
    const resent = await begin('clock.wrapup', { kind: 'clock', id: session.id }, clientKey, draft.draftKey);
    expect(resent.ok, resent.error).toBe(true);
    await uploadVideo(resent.result);
    expect(await waitForState(resent.result.uploadId, ['delivered', 'kept'])).toMatchObject({ state: 'delivered' });
    post = await postOf(stop.result.postId);
    expect(videosOn(post)).toHaveLength(1);
    expect(marked(post!.missingVideos)).toEqual([]);
    expect((await sessionOf(session.id))!.endTime).toBe(at);
  });
});

describe('clock.startWithPlan', () => {
  it('makes the plan post, clocks in at `at` with it, and the video fills that post without clocking again', async () => {
    const teamId = await newTeam();
    const draft = newDraft();
    const at = Date.now() - 3 * MINUTE;
    const res = await startWithPlan(teamId, draft.draftKey, { at });
    expect(res.ok, res.error).toBe(true);
    expect(res.result.clockEvent).toMatchObject({ startTime: at, endTime: null });

    const post = await postOf(res.result.postId);
    expect(post).toMatchObject({ teamId, userId: ownerId, clockEventId: res.result.clockEvent.id, content: { text: 'Plan for today' } });
    expect(post!.sessionUpdate).toBeUndefined();
    expect(post!.pendingVideos).toEqual([{ uploadId: res.result.uploadId, role: 'plan', at: new Date(at) }]);
    expect(await rowOf(res.result.uploadId)).toMatchObject({
      state: 'intent',
      type: 'clock.plan',
      postId: res.result.postId,
      clockEventId: res.result.clockEvent.id,
      destination: { kind: 'session-post', postId: res.result.postId, role: 'plan' },
    });

    // Twice: the same answer, one post, one session.
    const again = await startWithPlan(teamId, draft.draftKey, { at: Date.now() });
    expect(again.result).toMatchObject({ uploadId: res.result.uploadId, postId: res.result.postId });
    expect(again.result.clockEvent).toMatchObject({ id: res.result.clockEvent.id, startTime: at });
    const db = await getDb();
    expect(await db.collection('huddlePosts').countDocuments({ teamId })).toBe(1);
    expect(await db.collection('clockevents').countDocuments({ teamId })).toBe(1);

    const grant = await begin('clock.plan', { kind: 'clock-plan', teamId, postDate: today() }, draft.clientKey(), draft.draftKey);
    expect(grant.ok, grant.error).toBe(true);
    expect(grant.result.uploadId).toBe(res.result.uploadId);
    await uploadVideo(grant.result);
    expect(await waitForState(grant.result.uploadId, ['delivered', 'kept'])).toMatchObject({ state: 'delivered' });

    const filled = await postOf(res.result.postId);
    expect(videosOn(filled).map((a) => a.url)).toEqual([videoUrl(grant.result)]);
    expect(filled!.sessionUpdate).toBeUndefined();
    expect(marked(filled!.pendingVideos)).toEqual([]);
    expect(await db.collection('huddlePosts').countDocuments({ teamId })).toBe(1);
    expect(await db.collection('clockevents').countDocuments({ teamId })).toBe(1);
    expect((await sessionOf(res.result.clockEvent.id))!.endTime).toBeNull();
  });

  it('refuses a team the caller is not on, and a too-large video, writing nothing', async () => {
    const teamId = await newTeam();
    const db = await getDb();
    const outside = newDraft();
    const refused = await startWithPlan(teamId, outside.draftKey, {}, outsiderJwt);
    expect(refused.ok).toBe(false);
    const big = newDraft();
    const tooLarge = await startWithPlan(teamId, big.draftKey, { bytes: 600 * 1024 * 1024 });
    expect(tooLarge.ok).toBe(false);
    expect(tooLarge.error).toMatch(/Too large/);
    expect(await db.collection('pulseUploads').countDocuments({ draftKey: { $in: [outside.draftKey, big.draftKey] } })).toBe(0);
    expect(await db.collection('huddlePosts').countDocuments({ teamId })).toBe(0);
    expect(await db.collection('clockevents').countDocuments({ teamId })).toBe(0);
  });
});
