/**
 * Huddle post authoring over wormhole REST.
 *
 * createPost/updatePost/publishPost used to authenticate via `this.userId`,
 * which only exists on a DDP session — so posting required a live WebSocket.
 * That breaks on mobile, where the WebView drops the socket whenever the app
 * is backgrounded (recording a Pulse video, for one) and the write silently
 * strands with no error. They now go through `requireIdentity`, which accepts
 * a bearer token as well, so the same methods work over REST.
 *
 * plan-gate.test.ts covers the same methods over DDP — between the two, both
 * transports stay green.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createUserAndGetJwt, wormhole, getDb, closeDb, purgeUser, ObjectId } from './helpers';

const AUTHOR = { name: 'REST Author', email: 'wh-post-author@test.dev', password: 'Password1!' };
const OUTSIDER = { name: 'REST Outsider', email: 'wh-post-outsider@test.dev', password: 'Password1!' };

const TEAM_CODE = 'WHPOST01';

function todayString(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

let authorJwt: string;
let outsiderJwt: string;
let authorUserId: string;
let teamId: string;

beforeAll(async () => {
  await purgeUser(AUTHOR.email);
  await purgeUser(OUTSIDER.email);
  const authorAuth = await createUserAndGetJwt(AUTHOR);
  const outsiderAuth = await createUserAndGetJwt(OUTSIDER);
  authorJwt = authorAuth.jwt;
  outsiderJwt = outsiderAuth.jwt;

  const db = await getDb();
  authorUserId = String(
    (await db.collection('users').findOne({ 'emails.address': AUTHOR.email }))!._id,
  );

  const teamDoc = {
    _id: new ObjectId(),
    name: 'WH Post Team',
    members: [authorUserId],
    admins: [authorUserId],
    code: TEAM_CODE,
    isPersonal: false,
    createdAt: new Date(),
  };
  await db.collection('teams').insertOne(teamDoc);
  teamId = teamDoc._id.toHexString();
});

afterAll(async () => {
  const db = await getDb();
  await db.collection('teams').deleteMany({ code: TEAM_CODE });
  await db.collection('huddlePosts').deleteMany({ teamId });
  await purgeUser(AUTHOR.email);
  await purgeUser(OUTSIDER.email);
  await closeDb();
});

describe('huddle post authoring over REST', () => {
  it('creates a post attributed to the bearer token holder', async () => {
    const res = await wormhole<{ id: string }>(
      'huddle.createPost',
      {
        teamId,
        content: { text: 'Posted over REST', mentions: [] },
        postDate: todayString(),
      },
      authorJwt,
    );

    expect(res.ok).toBe(true);
    expect(res.result.id).toBeTruthy();

    const db = await getDb();
    const post = await db.collection('huddlePosts').findOne({ _id: new ObjectId(res.result.id) });
    expect(post).toBeTruthy();
    // The identity must come from the token, not a DDP session.
    expect(post!.userId).toBe(authorUserId);
    expect(post!.content.text).toBe('Posted over REST');
  });

  it('round-trips attachments, so a Pulse video survives the REST path', async () => {
    const attachment = {
      mediaId: 'e5adf23f-4bca-4c15-b90e-25105b96f8a2',
      type: 'video',
      url: 'https://example.test/pulsevault/artifacts/e5adf23f-4bca-4c15-b90e-25105b96f8a2',
      filename: 'clip.mp4',
    };

    const res = await wormhole<{ id: string }>(
      'huddle.createPost',
      {
        teamId,
        content: { text: 'With a video', mentions: [] },
        attachments: [attachment],
        postDate: todayString(),
      },
      authorJwt,
    );
    expect(res.ok).toBe(true);

    const db = await getDb();
    const post = await db.collection('huddlePosts').findOne({ _id: new ObjectId(res.result.id) });
    expect(post!.attachments).toHaveLength(1);
    expect(post!.attachments[0]).toMatchObject(attachment);
  });

  it('updates a post over REST', async () => {
    const created = await wormhole<{ id: string }>(
      'huddle.createPost',
      { teamId, content: { text: 'Before edit', mentions: [] }, postDate: todayString() },
      authorJwt,
    );

    const updated = await wormhole(
      'huddle.updatePost',
      { postId: created.result.id, content: { text: 'After edit', mentions: [] } },
      authorJwt,
    );
    expect(updated.ok).toBe(true);

    const db = await getDb();
    const post = await db.collection('huddlePosts').findOne({
      _id: new ObjectId(created.result.id),
    });
    expect(post!.content.text).toBe('After edit');
  });

  it('publishes a draft over REST', async () => {
    const draft = await wormhole<{ id: string }>(
      'huddle.createPost',
      { teamId, content: { text: 'Draft plan', mentions: [] }, draft: true },
      authorJwt,
    );

    const db = await getDb();
    const before = await db.collection('huddlePosts').findOne({
      _id: new ObjectId(draft.result.id),
    });
    expect(before!.status).toBe('draft');

    const published = await wormhole(
      'huddle.publishPost',
      { postId: draft.result.id, postDate: todayString() },
      authorJwt,
    );
    expect(published.ok).toBe(true);

    const after = await db.collection('huddlePosts').findOne({
      _id: new ObjectId(draft.result.id),
    });
    expect(after!.status).toBeUndefined();
    expect(after!.postDate).toBe(todayString());
  });

  it('rejects an unauthenticated create', async () => {
    const res = await wormhole(
      'huddle.createPost',
      { teamId, content: { text: 'No token', mentions: [] } },
      '',
    );
    expect(res.ok).toBe(false);
  });

  it('rejects a non-member create', async () => {
    const res = await wormhole(
      'huddle.createPost',
      { teamId, content: { text: 'Not my team', mentions: [] } },
      outsiderJwt,
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/team member/i);
  });
});
