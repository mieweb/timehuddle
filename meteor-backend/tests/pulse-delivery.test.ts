/**
 * Delivery of Pulse videos sent from the app — wormhole REST, TUS and direct
 * Mongo integration tests (huddle-server §8, §10, §11, §14):
 *  - a video whose ticket is gone is kept, and media.list shows it with why;
 *  - a wrap-up video lands on the post stored at Send, with its captions,
 *    clears the post's pending mark, and never makes the post an update;
 *  - a Huddle post sent while clocked in joins that session as an update;
 *  - attachments.list gives a captioned video its captionsUrl;
 *  - the sweep marks a reserved row 24 h past Send overdue, once, with one
 *    push for a clock type and the post's pending entry marked;
 *  - deleting the account removes the user's videos (PulseVault files
 *    included), their attachments and their pulseUploads rows.
 *
 * Needs the test backend (tests/setup.ts) with PulseVault mounted. The sweep
 * case needs that backend started with `PULSE_UPLOADS_SWEEP_MS` (e.g. 2000)
 * and the same variable set for this run; without it the case is skipped,
 * since the sweep otherwise runs hourly. Run by PR3-V1.
 */
import { randomBytes, randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { METEOR_URL } from './setup';
import { createUserAndGetJwt, wormhole, getDb, closeDb, purgeUser, ObjectId } from './helpers';

const OWNER = { name: 'Pulse Delivery Owner', email: 'wh-pulse-delivery-owner@test.dev', password: 'Password1!' };
const LEAVER = { name: 'Pulse Delivery Leaver', email: 'wh-pulse-delivery-leaver@test.dev', password: 'Password1!' };

const VIDEO = readFileSync(new URL('../../tests/e2e/fixtures/test-video.mp4', import.meta.url));
const VTT = Buffer.from('WEBVTT\n\n00:00.000 --> 00:01.000\nHello\n');
const SWEEP_MS = Number(process.env.PULSE_UPLOADS_SWEEP_MS ?? 0);

let ownerJwt: string;
let leaverJwt: string;
let ownerId: string;
let leaverId: string;
let teamId: string;
let ticketId: string;

const INSTALLATION = `pr3s8-${randomBytes(4).toString('hex')}`;
let drafts = 0;

function newDraft() {
  drafts += 1;
  const draftKey = `${INSTALLATION}:draft-${drafts}`;
  return { draftKey, clientKey: `${draftKey}:${randomBytes(8).toString('hex')}` };
}

type Grant = { uploadId: string; clientKey: string; artifactId: string; token: string; state: string };

const client = { appVersion: '2.8.0 (70)', contractVersion: '1.1', platform: 'ios' };

function begin(fields: Record<string, unknown>, jwt = ownerJwt) {
  const draft = newDraft();
  return wormhole<Grant>(
    'pulseUploads.begin',
    { ...draft, sentAt: Date.now(), name: 'Fix login', bytes: VIDEO.length, client, ...fields },
    jwt,
  );
}

const beginTicket = (id = ticketId, jwt = ownerJwt) => begin({ type: 'ticket.video', target: { kind: 'ticket', id } }, jwt);

async function rowOf(uploadId: string) {
  const db = await getDb();
  return db.collection('pulseUploads').findOne({ _id: uploadId as unknown as ObjectId });
}

const metadata = (fields: Record<string, string>) =>
  Object.entries(fields)
    .map(([key, value]) => `${key} ${Buffer.from(value, 'utf8').toString('base64')}`)
    .join(',');

async function tusUpload(token: string, fields: Record<string, string>, body: Buffer) {
  const created = await fetch(`${METEOR_URL}/pulsevault/upload`, {
    method: 'POST',
    headers: {
      'Tus-Resumable': '1.0.0',
      'Upload-Length': String(body.length),
      'Upload-Metadata': metadata(fields),
      Authorization: `Bearer ${token}`,
    },
  });
  expect(created.status).toBe(201);
  const patched = await fetch(new URL(created.headers.get('location')!, METEOR_URL), {
    method: 'PATCH',
    headers: {
      'Tus-Resumable': '1.0.0',
      'Upload-Offset': '0',
      'Content-Type': 'application/offset+octet-stream',
      Authorization: `Bearer ${token}`,
    },
    body,
  });
  expect(patched.status).toBe(204);
}

/** The video (after its captions, as Pulse sends them, when `captions`). */
async function uploadVideo(grant: Grant, { captions = false } = {}) {
  if (captions) {
    await tusUpload(
      grant.token,
      { artifactId: randomUUID(), filename: 'captions.vtt', kind: 'captions', relatedTo: grant.artifactId },
      VTT,
    );
  }
  await tusUpload(grant.token, { artifactId: grant.artifactId, filename: 'pulse.mp4', kind: 'video', name: 'Fix login' }, VIDEO);
}

async function waitFor<T>(read: () => Promise<T>, done: (value: T) => boolean, timeoutMs = 90_000) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() > until) throw new Error(`timed out; last value ${JSON.stringify(value)}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

const landed = (uploadId: string) =>
  waitFor(() => rowOf(uploadId), (row) => row?.state === 'delivered' || row?.state === 'kept');

beforeAll(async () => {
  await Promise.all([OWNER, LEAVER].map((user) => purgeUser(user.email)));
  const [owner, leaver] = await Promise.all([OWNER, LEAVER].map((user) => createUserAndGetJwt(user)));
  ownerJwt = owner.jwt;
  leaverJwt = leaver.jwt;
  ownerId = owner.userId;
  leaverId = leaver.userId;

  const db = await getDb();
  const team = new ObjectId();
  teamId = team.toHexString();
  await db.collection('teams').insertOne({
    _id: team,
    name: 'WH Pulse Delivery',
    members: [ownerId, leaverId],
    admins: [ownerId],
    code: `WHPD${randomBytes(2).toString('hex').toUpperCase()}`,
    isPersonal: false,
    createdAt: new Date(),
  });
  const ticket = new ObjectId();
  ticketId = ticket.toHexString();
  await db.collection('tickets').insertOne({
    _id: ticket,
    teamId,
    title: 'Pulse delivery ticket',
    github: '',
    status: 'open',
    createdBy: ownerId,
    assignedTo: [],
    createdAt: new Date(),
  });
});

afterAll(async () => {
  const db = await getDb();
  const users = [ownerId, leaverId];
  await db.collection('pulseUploads').deleteMany({ userId: { $in: users } });
  await db.collection('attachments').deleteMany({ addedBy: { $in: users } });
  await db.collection('mediaitems').deleteMany({ userId: { $in: users } });
  await db.collection('huddlePosts').deleteMany({ userId: { $in: users } });
  await db.collection('notifications').deleteMany({ userId: { $in: users } });
  await db.collection('clockevents').deleteMany({ userId: { $in: users } });
  await db.collection('tickets').deleteMany({ teamId });
  await db.collection('teams').deleteOne({ _id: new ObjectId(teamId) });
  await Promise.all([OWNER, LEAVER].map((user) => purgeUser(user.email)));
  await closeDb();
});

describe('kept videos', () => {
  it('reach the library, and media.list says why', async () => {
    const db = await getDb();
    const gone = new ObjectId();
    await db.collection('tickets').insertOne({ _id: gone, teamId, title: 'Soon gone', status: 'open', createdAt: new Date() });
    const grant = await beginTicket(gone.toHexString());
    expect(grant.ok, grant.error).toBe(true);
    // Deleted while the video was on its way (tickets.delete soft-deletes).
    await db.collection('tickets').updateOne({ _id: gone }, { $set: { status: 'deleted' } });
    await uploadVideo(grant.result);

    const row = await landed(grant.result.uploadId);
    expect(row).toMatchObject({ state: 'kept', attachmentId: null, overdueAt: null });
    expect(row!.reason).toMatch(/Ticket not found/);
    expect(row!.mediaId).toEqual(expect.any(String));

    const media = await wormhole<{ items: Array<{ videoid: string | null; keptReason: string | null }> }>('media.list', {}, ownerJwt);
    expect(media.ok, media.error).toBe(true);
    const item = media.result.items.find((each) => each.videoid === grant.result.artifactId);
    expect(item?.keptReason).toMatch(/Ticket not found/);
    expect(
      await db.collection('notifications').countDocuments({ userId: ownerId, 'data.uploadId': grant.result.uploadId, 'data.state': 'kept' }),
    ).toBe(1);
  });
});

describe('delivered videos', () => {
  it("go on the wrap-up post stored at Send, with captions, and leave it the session's post", async () => {
    const db = await getDb();
    const session = new ObjectId();
    await db.collection('clockevents').insertOne({ _id: session, userId: ownerId, teamId, startTime: new Date(Date.now() - 3_600_000), endTime: new Date() });
    const post = new ObjectId();
    const intentId = randomUUID();
    await db.collection('huddlePosts').insertOne({
      _id: post,
      teamId,
      userId: ownerId,
      content: { text: 'Plan\n\n**Wrap-up:** Fix login', mentions: [] },
      attachments: [],
      clockEventId: session.toHexString(),
      wrapUpAt: new Date(),
      pendingVideos: [{ uploadId: intentId, role: 'wrapup', at: new Date() }],
      likes: [],
      commentCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const draft = newDraft();
    await db.collection('pulseUploads').insertOne({
      _id: intentId as unknown as ObjectId,
      userId: ownerId,
      clientKey: null,
      draftKey: draft.draftKey,
      type: 'clock.wrapup',
      target: { kind: 'clock', id: session.toHexString() },
      targetKey: `clock:${session.toHexString()}`,
      destination: { kind: 'session-post', postId: post.toHexString(), role: 'wrapup' },
      teamId,
      label: 'Wrap-up',
      sentAt: new Date(),
      postId: post.toHexString(),
      clockEventId: session.toHexString(),
      artifactId: null,
      replacedArtifactIds: [],
      replacedClientKeys: [],
      fallback: null,
      overdueAt: null,
      state: 'intent',
      attempts: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const grant = await wormhole<Grant>(
      'pulseUploads.begin',
      { ...draft, type: 'clock.wrapup', target: { kind: 'clock', id: session.toHexString() }, sentAt: Date.now(), client },
      ownerJwt,
    );
    expect(grant.ok, grant.error).toBe(true);
    expect(grant.result.uploadId).toBe(intentId);
    await uploadVideo(grant.result, { captions: true });

    const row = await landed(intentId);
    expect(row).toMatchObject({ state: 'delivered', note: 'Wrap-up video added' });
    expect(row!.captionsArtifactId).toEqual(expect.any(String));
    const after = await db.collection('huddlePosts').findOne({ _id: post });
    expect(after!.attachments).toHaveLength(1);
    expect(after!.attachments[0]).toMatchObject({
      type: 'video',
      url: `/pulsevault/artifacts/${grant.result.artifactId}`,
      captionsUrl: `/pulsevault/artifacts/${row!.captionsArtifactId}`,
    });
    expect(after!.pendingVideos).toEqual([]);
    expect(after!.clockEventId).toBe(session.toHexString());
    expect(after!.sessionUpdate).toBeUndefined();
  });

  it('a Huddle post sent while clocked in joins that session as an update', async () => {
    const db = await getDb();
    const session = new ObjectId();
    await db.collection('clockevents').insertOne({ _id: session, userId: ownerId, teamId, startTime: new Date(Date.now() - 60_000), endTime: null });
    try {
      const grant = await begin({ type: 'huddle.post', target: { kind: 'huddle', teamId } });
      expect(grant.ok, grant.error).toBe(true);
      expect(await rowOf(grant.result.uploadId)).toMatchObject({ sessionId: session.toHexString() });
      await uploadVideo(grant.result);
      expect(await landed(grant.result.uploadId)).toMatchObject({ state: 'delivered' });
      const post = await db
        .collection('huddlePosts')
        .findOne({ userId: ownerId, teamId, 'attachments.url': `/pulsevault/artifacts/${grant.result.artifactId}` });
      expect(post).toMatchObject({ clockEventId: session.toHexString(), sessionUpdate: true });
    } finally {
      await db.collection('clockevents').updateOne({ _id: session }, { $set: { endTime: new Date() } });
    }
  });

  it("attachments.list gives a captioned video its captionsUrl, and the row what it became", async () => {
    const grant = await beginTicket();
    expect(grant.ok, grant.error).toBe(true);
    await uploadVideo(grant.result, { captions: true });
    const row = await landed(grant.result.uploadId);
    expect(row).toMatchObject({ state: 'delivered' });
    expect(row!.attachmentId).toEqual(expect.any(String));
    expect(row!.mediaId).toEqual(expect.any(String));

    const list = await wormhole<{ attachments: Array<{ id: string; url: string; captionsUrl?: string | null }> }>(
      'attachments.list',
      { kind: 'ticket', id: ticketId },
      ownerJwt,
    );
    expect(list.ok, list.error).toBe(true);
    const attachment = list.result.attachments.find((each) => each.id === row!.attachmentId);
    expect(attachment?.captionsUrl).toBe(`/pulsevault/artifacts/${row!.captionsArtifactId}`);

    const db = await getDb();
    const stored = await db.collection('attachments').findOne({ _id: new ObjectId(row!.attachmentId) });
    expect(stored).toMatchObject({ source: 'pulse', videoid: grant.result.artifactId, pulseUploadId: grant.result.uploadId, uploadType: 'ticket.video' });
    expect(
      await db.collection('notifications').findOne({ userId: ownerId, 'data.uploadId': grant.result.uploadId }),
    ).toMatchObject({ body: 'Video attached to Pulse delivery ticket', data: { type: 'pulse-upload', state: 'delivered', url: `/app/tickets/${ticketId}` } });
  });
});

describe.skipIf(!SWEEP_MS)('the overdue sweep', () => {
  it('marks a reserved row 25 h past Send overdue, once, and never abandons it', async () => {
    const grant = await beginTicket();
    expect(grant.ok, grant.error).toBe(true);
    const db = await getDb();
    await db
      .collection('pulseUploads')
      .updateOne({ _id: grant.result.uploadId as unknown as ObjectId }, { $set: { sentAt: new Date(Date.now() - 25 * 3_600_000) } });
    const row = await waitFor(() => rowOf(grant.result.uploadId), (value) => value?.overdueAt instanceof Date, SWEEP_MS * 3 + 5_000);
    expect(row!.state).toBe('reserved');
    // Not a clock type: overdue for support only, no push.
    expect(await db.collection('notifications').countDocuments({ 'data.uploadId': grant.result.uploadId })).toBe(0);
  });

  it("pushes once for a clock video and marks its post's pending entry", async () => {
    const db = await getDb();
    const post = new ObjectId();
    const uploadId = randomUUID();
    await db.collection('huddlePosts').insertOne({
      _id: post,
      teamId,
      userId: ownerId,
      content: { text: '**Wrap-up**', mentions: [] },
      attachments: [],
      pendingVideos: [{ uploadId, role: 'wrapup', at: new Date() }],
      likes: [],
      commentCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const draft = newDraft();
    const sentAt = new Date(Date.now() - 25 * 3_600_000);
    await db.collection('pulseUploads').insertOne({
      _id: uploadId as unknown as ObjectId,
      userId: ownerId,
      clientKey: null,
      draftKey: draft.draftKey,
      type: 'clock.wrapup',
      target: { kind: 'clock', id: new ObjectId().toHexString() },
      targetKey: 'clock:x',
      destination: { kind: 'session-post', postId: post.toHexString(), role: 'wrapup' },
      teamId,
      label: 'Wrap-up',
      platform: 'ios',
      sentAt,
      postId: post.toHexString(),
      artifactId: null,
      replacedArtifactIds: [],
      overdueAt: null,
      state: 'intent',
      createdAt: sentAt,
      updatedAt: sentAt,
    });
    const row = await waitFor(() => rowOf(uploadId), (value) => value?.overdueAt instanceof Date, SWEEP_MS * 3 + 5_000);
    expect(row!.state).toBe('intent');
    const flagged = await db.collection('huddlePosts').findOne({ _id: post });
    expect(flagged!.pendingVideos[0].overdueAt).toBeInstanceOf(Date);
    // Two more passes: still one push.
    await new Promise((resolve) => setTimeout(resolve, SWEEP_MS * 2 + 500));
    const pushes = await db.collection('notifications').find({ userId: ownerId, 'data.uploadId': uploadId }).toArray();
    expect(pushes).toHaveLength(1);
    expect(pushes[0].body).toBe("Your wrap-up video hasn't arrived yet. Open TimeHuddle on your iPhone to send it.");
  });
});

describe('account deletion', () => {
  it("removes the user's videos and their files, their video attachments and their rows", async () => {
    const delivered = await beginTicket(ticketId, leaverJwt);
    expect(delivered.ok, delivered.error).toBe(true);
    await uploadVideo(delivered.result);
    expect(await landed(delivered.result.uploadId)).toMatchObject({ state: 'delivered' });
    const pending = await beginTicket(ticketId, leaverJwt);
    expect(pending.ok, pending.error).toBe(true);

    const artifact = `${METEOR_URL}/pulsevault/artifacts/${delivered.result.artifactId}`;
    const served = async () => {
      const res = await fetch(artifact, { headers: { Range: 'bytes=0-0' } });
      await res.body?.cancel();
      return res.status;
    };
    expect([200, 206]).toContain(await served());

    const res = await fetch(`${METEOR_URL}/api/me/account`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${leaverJwt}` },
    });
    expect(res.status).toBe(200);

    const db = await getDb();
    expect(await db.collection('mediaitems').countDocuments({ userId: leaverId })).toBe(0);
    expect(await db.collection('attachments').countDocuments({ addedBy: leaverId, type: 'video' })).toBe(0);
    expect(await db.collection('pulseUploads').countDocuments({ userId: leaverId })).toBe(0);
    expect(await served()).toBe(404);
  });
});
