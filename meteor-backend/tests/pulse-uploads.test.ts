/**
 * pulseUploads — wormhole REST, TUS and DDP integration tests (huddle-server
 * §3–§7, TH-3): begin is idempotent per clientKey and keeps one row per
 * draft; a gone artifact is minted again; an Edit's newer clientKey retires
 * the older export; tokens are the owner's; a cancelled row refuses
 * PulseVault; captions that go up first never move the row; a too-large
 * video is refused before any write; a clock intent is adopted by draftKey;
 * a delivered video attaches once; a Huddle key publishes only your own rows.
 *
 * Needs the test backend (tests/setup.ts) with PulseVault mounted. The video
 * upload uses the e2e fixture; conform runs if ffmpeg is on that machine.
 * Run by PR3-V1.
 */
import { randomBytes, randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { METEOR_URL } from './setup';
import { createUserAndGetJwt, DDPConnection, wormhole, getDb, closeDb, purgeUser, ObjectId } from './helpers';

const OWNER = { name: 'Pulse Uploads Owner', email: 'wh-pulse-uploads-owner@test.dev', password: 'Password1!' };
const MATE = { name: 'Pulse Uploads Mate', email: 'wh-pulse-uploads-mate@test.dev', password: 'Password1!' };

const VIDEO = readFileSync(new URL('../../tests/e2e/fixtures/test-video.mp4', import.meta.url));
const VTT = Buffer.from('WEBVTT\n\n00:00.000 --> 00:01.000\nHello\n');

let ownerJwt: string;
let mateJwt: string;
let ownerId: string;
let mateId: string;
let teamId: string;
let ticketId: string;
let savedFlag: Record<string, unknown> | null = null;

const INSTALLATION = `pr3s7-${randomBytes(4).toString('hex')}`;
let drafts = 0;

/** A new draft on this "phone": its draftKey and a clientKey for one export of it. */
function newDraft() {
  drafts += 1;
  const draftKey = `${INSTALLATION}:draft-${drafts}`;
  return { draftKey, clientKey: (key = draftKey) => `${key}:${randomBytes(8).toString('hex')}` };
}

type Grant = {
  uploadId: string;
  clientKey: string;
  artifactId: string;
  endpoint: string;
  token: string;
  expiresAt: number;
  state: string;
  label: string;
};
type PublicUpload = { id: string; state: string; targetKey: string; clientKey?: string };

/**
 * helpers' wormhole, plus the Meteor.Error's code: Wormhole answers every
 * refusal with HTTP 500 and puts the code in the body, so the code is what
 * tells one refusal from another.
 */
async function call<T = unknown>(method: string, params: Record<string, unknown>, jwt: string) {
  const res = await fetch(`${METEOR_URL}/api/${method.replace(/\./g, '_')}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
    body: JSON.stringify(params),
  });
  const body = (await res.json().catch(() => ({}))) as { result?: T; error?: string; reason?: string; message?: string };
  return { status: res.status, ok: res.ok, result: body.result as T, error: body.reason ?? body.message, code: body.error };
}

function beginTicket(clientKey: string, draftKey: string, extra: Record<string, unknown> = {}, jwt = ownerJwt) {
  return call<Grant>(
    'pulseUploads.begin',
    {
      clientKey,
      draftKey,
      type: 'ticket.video',
      target: { kind: 'ticket', id: ticketId },
      sentAt: Date.now(),
      name: 'Fix login',
      bytes: VIDEO.length,
      client: { appVersion: '2.8.0 (70)', contractVersion: '1.1', platform: 'ios' },
      ...extra,
    },
    jwt,
  );
}

async function rowOf(uploadId: string) {
  const db = await getDb();
  return db.collection('pulseUploads').findOne({ _id: uploadId as unknown as ObjectId });
}

const metadata = (fields: Record<string, string>) =>
  Object.entries(fields)
    .map(([key, value]) => `${key} ${Buffer.from(value, 'utf8').toString('base64')}`)
    .join(',');

/** A TUS create on PulseVault under `token`; returns the response. */
function tusCreate(token: string, fields: Record<string, string>, length: number) {
  return fetch(`${METEOR_URL}/pulsevault/upload`, {
    method: 'POST',
    headers: {
      'Tus-Resumable': '1.0.0',
      'Upload-Length': String(length),
      'Upload-Metadata': metadata(fields),
      Authorization: `Bearer ${token}`,
    },
  });
}

/** The whole body in one PATCH to the upload a create answered with. */
function tusPatch(token: string, created: Response, body: Buffer) {
  return fetch(new URL(created.headers.get('location')!, METEOR_URL), {
    method: 'PATCH',
    headers: {
      'Tus-Resumable': '1.0.0',
      'Upload-Offset': '0',
      'Content-Type': 'application/offset+octet-stream',
      Authorization: `Bearer ${token}`,
    },
    body,
  });
}

const videoFields = (artifactId: string) => ({ artifactId, filename: 'pulse.mp4', kind: 'video', name: 'Fix login' });

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

beforeAll(async () => {
  await Promise.all([OWNER, MATE].map((user) => purgeUser(user.email)));
  const [owner, mate] = await Promise.all([OWNER, MATE].map((user) => createUserAndGetJwt(user)));
  ownerJwt = owner.jwt;
  mateJwt = mate.jwt;
  ownerId = owner.userId;
  mateId = mate.userId;

  const db = await getDb();
  const team = new ObjectId();
  teamId = team.toHexString();
  await db.collection('teams').insertOne({
    _id: team,
    name: 'WH Pulse Uploads',
    members: [ownerId, mateId],
    admins: [mateId],
    code: `WHPU${randomBytes(2).toString('hex').toUpperCase()}`,
    isPersonal: false,
    createdAt: new Date(),
  });
  const ticket = new ObjectId();
  ticketId = ticket.toHexString();
  await db.collection('tickets').insertOne({
    _id: ticket,
    teamId,
    title: 'Pulse uploads ticket',
    github: '',
    status: 'open',
    createdBy: ownerId,
    assignedTo: [],
    createdAt: new Date(),
  });
  savedFlag = await db.collection('appFlags').findOne({ _id: 'pulse' as unknown as ObjectId });
});

afterAll(async () => {
  const db = await getDb();
  await db.collection('pulseUploads').deleteMany({ userId: { $in: [ownerId, mateId] } });
  await db.collection('attachments').deleteMany({ addedBy: { $in: [ownerId, mateId] } });
  await db.collection('mediaitems').deleteMany({ userId: { $in: [ownerId, mateId] } });
  await db.collection('huddlePosts').deleteMany({ userId: { $in: [ownerId, mateId] } });
  await db.collection('tickets').deleteOne({ _id: new ObjectId(ticketId) });
  await db.collection('teams').deleteOne({ _id: new ObjectId(teamId) });
  const flags = db.collection('appFlags');
  if (savedFlag) await flags.replaceOne({ _id: 'pulse' as unknown as ObjectId }, savedFlag, { upsert: true });
  else await flags.deleteOne({ _id: 'pulse' as unknown as ObjectId });
  await Promise.all([OWNER, MATE].map((user) => purgeUser(user.email)));
  await closeDb();
});

describe('pulseUploads.begin', () => {
  it('has the six indexes', async () => {
    const db = await getDb();
    const names = (await db.collection('pulseUploads').indexes()).map((index) => index.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'pulseUploads_user_clientKey',
        'pulseUploads_artifactId',
        'pulseUploads_replaced',
        'pulseUploads_user_draftKey',
        'pulseUploads_targetKey_state',
        'pulseUploads_user_state_updated',
      ]),
    );
  });

  it('gives the same clientKey the same row and artifact, with a fresh 2 h token', async () => {
    const draft = newDraft();
    const clientKey = draft.clientKey();
    const first = await beginTicket(clientKey, draft.draftKey);
    const again = await beginTicket(clientKey, draft.draftKey);
    expect(first.ok, first.error).toBe(true);
    expect(again.result.uploadId).toBe(first.result.uploadId);
    expect(again.result.artifactId).toBe(first.result.artifactId);
    expect(first.result).toMatchObject({ clientKey, state: 'reserved', label: 'Pulse uploads ticket' });
    expect(first.result.endpoint).toMatch(/\/pulsevault$/);
    expect(first.result.expiresAt - Date.now()).toBeGreaterThan(115 * 60 * 1000);

    const row = await rowOf(first.result.uploadId);
    expect(row).toMatchObject({
      userId: ownerId,
      draftKey: draft.draftKey,
      targetKey: `ticket:${ticketId}`,
      destination: { kind: 'ticket', id: ticketId },
      teamId,
      platform: 'ios',
      attempts: 1,
    });
    expect(row!.sentAt).toBeInstanceOf(Date);
  });

  it('mints a new artifact when PulseVault lost the old one (artifactGone)', async () => {
    const draft = newDraft();
    const clientKey = draft.clientKey();
    const first = await beginTicket(clientKey, draft.draftKey);
    const renewed = await beginTicket(clientKey, draft.draftKey, { artifactGone: true });
    expect(renewed.ok, renewed.error).toBe(true);
    expect(renewed.result.uploadId).toBe(first.result.uploadId);
    expect(renewed.result.artifactId).not.toBe(first.result.artifactId);
    const row = await rowOf(first.result.uploadId);
    expect(row!.replacedArtifactIds).toEqual([first.result.artifactId]);
    // The old artifact's token can no longer start an upload.
    const late = await tusCreate(first.result.token, videoFields(first.result.artifactId), VIDEO.length);
    expect(late.status).toBe(403);
  });

  it("retires the older export when an Edit's newer clientKey begins", async () => {
    const draft = newDraft();
    const older = draft.clientKey();
    const newer = draft.clientKey();
    const first = await beginTicket(older, draft.draftKey);
    const edited = await beginTicket(newer, draft.draftKey);
    expect(edited.ok, edited.error).toBe(true);
    expect(edited.result.uploadId).toBe(first.result.uploadId);
    expect(edited.result.artifactId).not.toBe(first.result.artifactId);

    const row = await rowOf(first.result.uploadId);
    expect(row).toMatchObject({ clientKey: newer, replacedClientKeys: [older], state: 'reserved' });
    expect(row!.replacedArtifactIds).toEqual([first.result.artifactId]);

    // A late call for the older export changes nothing while the newer one is under way.
    const lateBegin = await beginTicket(older, draft.draftKey);
    expect(lateBegin).toMatchObject({ ok: false, code: 'conflict' });
    const lateToken = await call('pulseUploads.token', { uploadId: first.result.uploadId, clientKey: older }, ownerJwt);
    expect(lateToken).toMatchObject({ ok: false, code: 'conflict' });
    const lateCancel = await wormhole<{ state: string }>('pulseUploads.cancel', { clientKey: older }, ownerJwt);
    expect(lateCancel.result.state).toBe('reserved');
    expect((await rowOf(first.result.uploadId))!.clientKey).toBe(newer);
  });

  it('refuses a too-large video before writing anything', async () => {
    const draft = newDraft();
    const res = await beginTicket(draft.clientKey(), draft.draftKey, { bytes: 600 * 1024 * 1024 });
    expect(res).toMatchObject({ ok: false, code: 'too-large' });
    expect(res.error).toMatch(/Too large/);
    const db = await getDb();
    expect(await db.collection('pulseUploads').countDocuments({ draftKey: draft.draftKey })).toBe(0);
  });

  it('refuses a place the caller cannot see, and records it for support', async () => {
    const db = await getDb();
    const elsewhere = new ObjectId();
    await db.collection('teams').insertOne({ _id: elsewhere, name: 'WH Pulse Elsewhere', members: [], admins: [], createdAt: new Date() });
    const hidden = new ObjectId();
    await db.collection('tickets').insertOne({ _id: hidden, teamId: elsewhere.toHexString(), title: 'Hidden', status: 'open', createdAt: new Date() });
    try {
      const draft = newDraft();
      const res = await call(
        'pulseUploads.begin',
        { clientKey: draft.clientKey(), draftKey: draft.draftKey, type: 'ticket.video', target: { kind: 'ticket', id: hidden.toHexString() }, sentAt: Date.now() },
        ownerJwt,
      );
      expect(res).toMatchObject({ ok: false, code: 'forbidden' });
      const row = await db.collection('pulseUploads').findOne({ draftKey: draft.draftKey });
      // The caller isn't in the ticket's team, so the refusal stays team-less:
      // a team's admins only see refusals from their own members.
      expect(row).toMatchObject({ state: 'failed', artifactId: null, teamId: null });
    } finally {
      await db.collection('tickets').deleteOne({ _id: hidden });
      await db.collection('teams').deleteOne({ _id: elsewhere });
    }
  });

  it("adopts the clock call's intent row by draftKey", async () => {
    const draft = newDraft();
    const session = new ObjectId().toHexString();
    const intentId = randomUUID();
    const db = await getDb();
    await db.collection('pulseUploads').insertOne({
      _id: intentId as unknown as ObjectId,
      userId: ownerId,
      clientKey: null,
      draftKey: draft.draftKey,
      type: 'clock.wrapup',
      target: { kind: 'clock', id: session },
      targetKey: `clock:${session}`,
      destination: { kind: 'session-post', postId: new ObjectId().toHexString(), role: 'wrapup' },
      teamId,
      label: 'Wrap-up',
      sentAt: new Date(),
      clockEventId: session,
      artifactId: null,
      replacedArtifactIds: [],
      replacedClientKeys: [],
      fallback: null,
      state: 'intent',
      attempts: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const clientKey = draft.clientKey();
    const res = await wormhole<Grant>(
      'pulseUploads.begin',
      { clientKey, draftKey: draft.draftKey, type: 'clock.wrapup', target: { kind: 'clock', id: session }, sentAt: Date.now() },
      ownerJwt,
    );
    expect(res.ok, res.error).toBe(true);
    expect(res.result).toMatchObject({ uploadId: intentId, clientKey, state: 'reserved' });
    expect(await rowOf(intentId)).toMatchObject({ clientKey, state: 'reserved', artifactId: res.result.artifactId, fallback: null });
  });
});

describe('pulseUploads.token and cancel', () => {
  it("re-mints only for the row's owner", async () => {
    const draft = newDraft();
    const grant = (await beginTicket(draft.clientKey(), draft.draftKey)).result;
    const own = await wormhole<{ token: string; expiresAt: number }>('pulseUploads.token', { uploadId: grant.uploadId }, ownerJwt);
    expect(own.ok, own.error).toBe(true);
    expect(own.result.token).toBeTruthy();
    const theirs = await call('pulseUploads.token', { uploadId: grant.uploadId }, mateJwt);
    expect(theirs).toMatchObject({ ok: false, code: 'not-found' });
  });

  it('a cancelled row refuses PulseVault, and a token', async () => {
    const draft = newDraft();
    const grant = (await beginTicket(draft.clientKey(), draft.draftKey)).result;
    const cancelled = await wormhole<{ state: string }>('pulseUploads.cancel', { uploadId: grant.uploadId }, ownerJwt);
    expect(cancelled.result.state).toBe('canceled');
    const create = await tusCreate(grant.token, videoFields(grant.artifactId), VIDEO.length);
    expect(create.status).toBe(403);
    const token = await call('pulseUploads.token', { uploadId: grant.uploadId }, ownerJwt);
    expect(token).toMatchObject({ ok: false, code: 'conflict' });
  });
});

describe('PulseVault hooks', () => {
  it('captions that go up first leave the row reserved; the video create moves it to uploading', async () => {
    const draft = newDraft();
    const grant = (await beginTicket(draft.clientKey(), draft.draftKey)).result;
    const captions = await tusCreate(
      grant.token,
      { artifactId: randomUUID(), filename: 'captions.vtt', kind: 'captions', relatedTo: grant.artifactId },
      VTT.length,
    );
    expect(captions.status).toBe(201);
    expect((await tusPatch(grant.token, captions, VTT)).status).toBe(204);
    expect((await rowOf(grant.uploadId))!.state).toBe('reserved');

    const video = await tusCreate(grant.token, videoFields(grant.artifactId), VIDEO.length);
    expect(video.status).toBe(201);
    expect((await rowOf(grant.uploadId))!.state).toBe('uploading');
    // Clean up: nothing more lands under it.
    await wormhole('pulseUploads.cancel', { uploadId: grant.uploadId, reason: 'deleted' }, ownerJwt);
    expect((await rowOf(grant.uploadId))!.state).toBe('abandoned');
  });

  it('delivers the video once: one attachment, and a resend gets the outcome', async () => {
    const draft = newDraft();
    const clientKey = draft.clientKey();
    const grant = (await beginTicket(clientKey, draft.draftKey)).result;
    const created = await tusCreate(grant.token, videoFields(grant.artifactId), VIDEO.length);
    expect(created.status).toBe(201);
    expect((await tusPatch(grant.token, created, VIDEO)).status).toBe(204);

    const row = await waitForState(grant.uploadId, ['delivered', 'kept']);
    expect(row).toMatchObject({ state: 'delivered', reason: null });
    expect(row.deliveredAt).toBeInstanceOf(Date);

    const db = await getDb();
    const attached = () =>
      db.collection('attachments').countDocuments({
        type: 'video',
        url: `/pulsevault/artifacts/${grant.artifactId}`,
        'attachedTo.kind': 'ticket',
        'attachedTo.id': ticketId,
      });
    expect(await attached()).toBe(1);

    // A resend after a kill: the same row, its outcome, nothing attached twice.
    const resend = await beginTicket(clientKey, draft.draftKey);
    expect(resend.result).toMatchObject({ uploadId: grant.uploadId, artifactId: grant.artifactId, state: 'delivered' });
    expect(await attached()).toBe(1);

    // The outcome Pulse polls carries the row.
    const status = await fetch(`${METEOR_URL}/pulsevault/artifacts/${grant.artifactId}/status`, {
      headers: { Authorization: `Bearer ${grant.token}` },
    });
    expect(status.status).toBe(200);
    expect(((await status.json()) as { outcome?: unknown }).outcome).toMatchObject({ state: 'done', uploadId: grant.uploadId });

    const listed = await wormhole<{ uploads: PublicUpload[] }>('pulseUploads.list', { targetKey: `ticket:${ticketId}`, states: ['delivered'] }, ownerJwt);
    expect(listed.result.uploads.map((u) => u.id)).toContain(grant.uploadId);
  });
});

describe('pulseUploadTypes.list', () => {
  it("returns the types, the runtime pause and the caller's teams' Pulse settings", async () => {
    const db = await getDb();
    await db.collection('appFlags').deleteOne({ _id: 'pulse' as unknown as ObjectId });
    const off = await wormhole<{ types: Array<{ id: string }>; runtimePaused: boolean; teams: Record<string, unknown> }>(
      'pulseUploadTypes.list',
      {},
      ownerJwt,
    );
    expect(off.ok, off.error).toBe(true);
    expect(off.result.runtimePaused).toBe(false);
    expect(off.result.types.map((type) => type.id)).toContain('ticket.video');
    expect(off.result.teams[teamId]).toEqual({ pulseInApp: false, pulseClockInOut: false, pulseSharedDevice: false });

    await db.collection('appFlags').updateOne({ _id: 'pulse' as unknown as ObjectId }, { $set: { runtimePaused: true } }, { upsert: true });
    const paused = await wormhole<{ runtimePaused: boolean }>('pulseUploadTypes.list', {}, ownerJwt);
    expect(paused.result.runtimePaused).toBe(true);
  });
});

describe('publications', () => {
  it("a Huddle team's key publishes only the caller's own rows (#871 R21)", async () => {
    const draft = newDraft();
    const grant = await wormhole<Grant>(
      'pulseUploads.begin',
      { clientKey: draft.clientKey(), draftKey: draft.draftKey, type: 'huddle.post', target: { kind: 'huddle', teamId }, sentAt: Date.now() },
      ownerJwt,
    );
    expect(grant.ok, grant.error).toBe(true);
    const key = `huddle:${teamId}`;
    const watch = async (user: typeof OWNER, name: string, params: unknown[]) => {
      const ddp = new DDPConnection(METEOR_URL.replace('http://', 'ws://') + '/websocket');
      await ddp.connect();
      await ddp.login(user.email, user.password);
      await ddp.subscribe(name, params);
      const docs = [...(ddp.docs.get('pulseUploads')?.entries() ?? [])];
      ddp.close();
      return new Map(docs);
    };
    const mine = await watch(OWNER, 'pulseUploads.forTarget', [key]);
    expect(mine.get(grant.result.uploadId)).toMatchObject({ state: 'reserved', targetKey: key });
    expect(mine.get(grant.result.uploadId)).not.toHaveProperty('clientKey');
    const theirs = await watch(MATE, 'pulseUploads.forTarget', [key]);
    expect(theirs.has(grant.result.uploadId)).toBe(false);
    const own = await watch(OWNER, 'pulseUploads.mine', []);
    expect(own.get(grant.result.uploadId)).toMatchObject({ draftKey: draft.draftKey });
  });

  it("a ticket's key publishes everyone's rows to the ticket's team", async () => {
    const draft = newDraft();
    const grant = (await beginTicket(draft.clientKey(), draft.draftKey)).result;
    const ddp = new DDPConnection(METEOR_URL.replace('http://', 'ws://') + '/websocket');
    await ddp.connect();
    await ddp.login(MATE.email, MATE.password);
    await ddp.subscribe('pulseUploads.forTarget', [`ticket:${ticketId}`]);
    expect(ddp.docs.get('pulseUploads')?.get(grant.uploadId)).toMatchObject({ userId: ownerId, state: 'reserved' });
    ddp.close();
  });
});
