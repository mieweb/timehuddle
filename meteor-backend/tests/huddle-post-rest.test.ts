/**
 * Huddle post authoring over wormhole REST.
 *
 * createPost/updatePost used to authenticate via `this.userId`,
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
import {
  createUserAndGetJwt,
  DDPConnection,
  wormhole,
  getDb,
  closeDb,
  purgeUser,
  ObjectId,
} from './helpers';
import { METEOR_URL } from './setup';

const AUTHOR = { name: 'REST Author', email: 'wh-post-author@test.dev', password: 'Password1!' };
const OUTSIDER = { name: 'REST Outsider', email: 'wh-post-outsider@test.dev', password: 'Password1!' };

const TEAM_CODE = 'WHPOST01';
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

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

async function deletePostViaDdp(postId: string) {
  const ddp = new DDPConnection(METEOR_URL.replace(/^http/, 'ws') + '/websocket');
  try {
    await ddp.connect();
    await ddp.login(AUTHOR.email, AUTHOR.password);
    return await ddp.call('huddle.deletePost', [{ postId }]);
  } finally {
    ddp.close();
  }
}

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

  it('stores a pasted inline image as media instead of base64 in the post', async () => {
    const res = await wormhole<{ id: string }>(
      'huddle.createPost',
      {
        teamId,
        content: { text: `Look:\n\n![shot](data:image/png;base64,${TINY_PNG_BASE64})`, mentions: [] },
        postDate: todayString(),
      },
      authorJwt,
    );
    expect(res.ok).toBe(true);

    const db = await getDb();
    const post = await db.collection('huddlePosts').findOne({ _id: new ObjectId(res.result.id) });
    expect(post!.content.text).not.toContain('data:image/');
    const [, url] = post!.content.text.match(/!\[shot\]\((\/uploads\/media\/[^)]+)\)/)!;
    const media = await db.collection('mediaitems').findOne({ url });
    expect(media).toMatchObject({ userId: authorUserId, mimeType: 'image/png', size: 70, embedded: true });
    expect((await fetch(`${METEOR_URL}${url}`)).status).toBe(200);

    const updated = await wormhole(
      'huddle.updatePost',
      { postId: res.result.id, content: { text: 'Screenshot removed', mentions: [] } },
      authorJwt,
    );
    expect(updated.ok).toBe(true);
    expect(await db.collection('mediaitems').findOne({ url })).toBeNull();
    expect((await fetch(`${METEOR_URL}${url}`)).status).toBe(404);
  });

  it('keeps embedded media while another post references it, then removes it on delete', async () => {
    const created = await wormhole<{ id: string }>(
      'huddle.createPost',
      {
        teamId,
        content: { text: `![shot](data:image/png;base64,${TINY_PNG_BASE64})`, mentions: [] },
        postDate: todayString(),
      },
      authorJwt,
    );
    expect(created.ok).toBe(true);

    const db = await getDb();
    const post = await db.collection('huddlePosts').findOne({ _id: new ObjectId(created.result.id) });
    const [, url] = post!.content.text.match(/!\[shot\]\((\/uploads\/media\/[^)]+)\)/)!;
    const reference = await wormhole<{ id: string }>(
      'huddle.createPost',
      { teamId, content: { text: `![shared](${url})`, mentions: [] }, postDate: todayString() },
      authorJwt,
    );
    expect(reference.ok).toBe(true);

    const updated = await wormhole(
      'huddle.updatePost',
      { postId: created.result.id, content: { text: 'Screenshot moved', mentions: [] } },
      authorJwt,
    );
    expect(updated.ok).toBe(true);
    expect(await db.collection('mediaitems').findOne({ url })).toBeTruthy();

    const backup = {
      _id: new ObjectId(reference.result.id),
      text: `![shared](data:image/png;base64,${TINY_PNG_BASE64})`,
      backedUpAt: new Date(),
    };
    await db.collection('inlineImageBackups').insertOne(backup);
    await deletePostViaDdp(reference.result.id);
    expect(await db.collection('mediaitems').findOne({ url })).toBeNull();
    expect(await db.collection('inlineImageBackups').findOne({ _id: backup._id })).toBeNull();
    expect((await fetch(`${METEOR_URL}${url}`)).status).toBe(404);
  });

  it('stores each supported format, keeps the text around it, and leaves the rest inline', async () => {
    const png = TINY_PNG_BASE64;
    const jpeg =
      '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARESEhgVGC8aGi9jQjhCY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2P/wAARCAACAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABQb/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCKALXj/9k=';
    const heic = 'data:image/heic;base64,AAAAGGZ0eXBoZWlj';
    const text = [
      `![jpg](data:image/jpg;base64,${jpeg})`, // the non-standard jpg spelling
      `![wrapped](data:image/png;base64,${png.replace(/(.{20})/g, '$1\n')} "A title")`,
      'prose right after the image',
      `![phone photo](${heic})`, // not shown inline by browsers: left as is
      `![broken](data:image/png;base64,abc*def)`, // not valid base64: left as is
    ].join('\n');
    const res = await wormhole<{ id: string }>(
      'huddle.createPost',
      { teamId, content: { text, mentions: [] }, postDate: todayString() },
      authorJwt,
    );
    expect(res.ok).toBe(true);

    const db = await getDb();
    const post = await db.collection('huddlePosts').findOne({ _id: new ObjectId(res.result.id) });
    const saved: string = post!.content.text;
    const [jpgUrl, pngUrl] = [...saved.matchAll(/\/uploads\/media\/[^)\s"]+/g)].map((m) => m[0]);
    expect(saved).toBe(
      [
        `![jpg](${jpgUrl})`,
        `![wrapped](${pngUrl} "A title")`,
        'prose right after the image',
        `![phone photo](${heic})`,
        `![broken](data:image/png;base64,abc*def)`,
      ].join('\n'),
    );
    expect(jpgUrl).toMatch(/\.jpg$/);
    const media = await db
      .collection('mediaitems')
      .find({ url: { $in: [jpgUrl, pngUrl] } })
      .toArray();
    expect(media.map((m) => m.mimeType).sort()).toEqual(['image/jpeg', 'image/png']);
    expect(media.find((m) => m.url === pngUrl)?.size).toBe(70);
    await deletePostViaDdp(res.result.id);
    expect(await db.collection('mediaitems').find({ url: { $in: [jpgUrl, pngUrl] } }).toArray()).toHaveLength(0);
  });

  it('answers only hasMore when asked without posts', async () => {
    const since = new Date(Date.now() - 86_400_000).toISOString();
    const res = await wormhole<{ posts: unknown[]; hasMore: boolean }>(
      'huddle.getPosts',
      { teamId, since, withPosts: false },
      authorJwt,
    );
    expect(res.ok).toBe(true);
    expect(res.result.posts).toEqual([]);
    expect(typeof res.result.hasMore).toBe('boolean');
  });

  it('keeps draft rows saved before drafts were removed out of the feed', async () => {
    const db = await getDb();
    const legacyDraft = {
      _id: new ObjectId(),
      teamId,
      userId: authorUserId,
      content: { text: 'Legacy draft', mentions: [] },
      attachments: [],
      likes: [],
      commentCount: 0,
      status: 'draft',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await db.collection('huddlePosts').insertOne(legacyDraft);

    const feed = await wormhole<{ posts: Array<{ id: string }> }>(
      'huddle.getPosts',
      { teamId },
      authorJwt,
    );
    expect(feed.ok).toBe(true);
    expect(feed.result.posts.some((p) => p.id === legacyDraft._id.toHexString())).toBe(false);
  });

  it('rejects a create from an old client that still asks for a draft', async () => {
    const text = `Old-client draft ${Date.now()}`;
    const res = await wormhole(
      'huddle.createPost',
      { teamId, content: { text, mentions: [] }, postDate: todayString(), draft: true },
      authorJwt,
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/drafts are no longer supported/i);

    const db = await getDb();
    expect(await db.collection('huddlePosts').findOne({ 'content.text': text })).toBeNull();
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

/**
 * `clockEventId` is client-supplied, and the feed reads clock-in/out times off
 * the linked session. Without an ownership check on write, a member could
 * attach someone else's (or another team's) session and expose its times
 * through this team's feed.
 */
describe('huddle post clockEventId ownership', () => {
  let foreignUserEventId: string;
  let foreignTeamEventId: string;

  beforeAll(async () => {
    const db = await getDb();
    const outsiderUserId = String(
      (await db.collection('users').findOne({ 'emails.address': OUTSIDER.email }))!._id,
    );

    // Another user's session, in the team the author *is* a member of.
    const foreignUserEvent = {
      _id: new ObjectId(),
      userId: outsiderUserId,
      teamId,
      startTime: Date.now() - 3_600_000,
      endTime: null,
      createdAt: new Date(),
    };
    // The author's own session, but in a team this post doesn't belong to.
    const foreignTeamEvent = {
      _id: new ObjectId(),
      userId: authorUserId,
      teamId: new ObjectId().toHexString(),
      startTime: Date.now() - 3_600_000,
      endTime: null,
      createdAt: new Date(),
    };
    await db.collection('clockevents').insertMany([foreignUserEvent, foreignTeamEvent]);
    foreignUserEventId = foreignUserEvent._id.toHexString();
    foreignTeamEventId = foreignTeamEvent._id.toHexString();
  });

  afterAll(async () => {
    const db = await getDb();
    await db
      .collection('clockevents')
      .deleteMany({ _id: { $in: [new ObjectId(foreignUserEventId), new ObjectId(foreignTeamEventId)] } });
  });

  it('rejects a create linking another user’s clock event', async () => {
    const res = await wormhole(
      'huddle.createPost',
      {
        teamId,
        content: { text: 'Whose session is this?', mentions: [] },
        postDate: todayString(),
        clockEventId: foreignUserEventId,
      },
      authorJwt,
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/does not belong to you/i);
  });

  it('rejects a create linking a clock event from another team', async () => {
    const res = await wormhole(
      'huddle.createPost',
      {
        teamId,
        content: { text: 'Session from elsewhere', mentions: [] },
        postDate: todayString(),
        clockEventId: foreignTeamEventId,
      },
      authorJwt,
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/does not belong to you/i);
  });
});

/**
 * `huddle.getMyPosts` feeds the Huddle Personal view: the caller's own
 * published posts, only from teams they belong to, from the last 30 days by
 * default. Legacy rows store `teamId` as an ObjectId and must still match.
 */
describe('huddle.getMyPosts', () => {
  const otherTeamId = new ObjectId().toHexString();
  const ids = {
    recent: new ObjectId(),
    legacyObjectIdTeam: new ObjectId(),
    old: new ObjectId(),
    draft: new ObjectId(),
    someoneElse: new ObjectId(),
    leftTeam: new ObjectId(),
  };

  beforeAll(async () => {
    const db = await getDb();
    const outsiderUserId = String(
      (await db.collection('users').findOne({ 'emails.address': OUTSIDER.email }))!._id,
    );
    const base = {
      content: { text: 'getMyPosts fixture', mentions: [] },
      attachments: [],
      likes: [],
      commentCount: 0,
    };
    const now = new Date();
    const fortyDaysAgo = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    await db.collection('huddlePosts').insertMany([
      { ...base, _id: ids.recent, teamId, userId: authorUserId, createdAt: now, updatedAt: now },
      {
        ...base,
        _id: ids.legacyObjectIdTeam,
        teamId: new ObjectId(teamId),
        userId: authorUserId,
        createdAt: now,
        updatedAt: now,
      },
      {
        ...base,
        _id: ids.old,
        teamId,
        userId: authorUserId,
        createdAt: fortyDaysAgo,
        updatedAt: fortyDaysAgo,
      },
      {
        ...base,
        _id: ids.draft,
        teamId,
        userId: authorUserId,
        status: 'draft',
        createdAt: now,
        updatedAt: now,
      },
      { ...base, _id: ids.someoneElse, teamId, userId: outsiderUserId, createdAt: now, updatedAt: now },
      // A team the author isn't (or is no longer) a member of.
      {
        ...base,
        _id: ids.leftTeam,
        teamId: otherTeamId,
        userId: authorUserId,
        createdAt: now,
        updatedAt: now,
      },
    ]);
  });

  afterAll(async () => {
    const db = await getDb();
    await db.collection('huddlePosts').deleteMany({ _id: { $in: Object.values(ids) } });
  });

  async function myPostIds(args: Record<string, unknown> = {}): Promise<string[]> {
    const res = await wormhole<{ posts: Array<{ id: string; teamId: string }> }>(
      'huddle.getMyPosts',
      args,
      authorJwt,
    );
    expect(res.ok).toBe(true);
    return res.result.posts.map((p) => p.id);
  }

  it("returns the caller's own recent posts, including legacy ObjectId team ids", async () => {
    const found = await myPostIds();
    expect(found).toContain(ids.recent.toHexString());
    expect(found).toContain(ids.legacyObjectIdTeam.toHexString());
  });

  it("leaves out other people's posts, teams the caller isn't in, and drafts", async () => {
    const found = await myPostIds();
    expect(found).not.toContain(ids.someoneElse.toHexString());
    expect(found).not.toContain(ids.leftTeam.toHexString());
    expect(found).not.toContain(ids.draft.toHexString());
  });

  it('defaults to the last 30 days, and `since` reaches further back', async () => {
    expect(await myPostIds()).not.toContain(ids.old.toHexString());
    const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    expect(await myPostIds({ since })).toContain(ids.old.toHexString());
  });

  it('returns team ids as strings', async () => {
    const res = await wormhole<{ posts: Array<{ id: string; teamId: unknown }> }>(
      'huddle.getMyPosts',
      {},
      authorJwt,
    );
    const legacy = res.result.posts.find((p) => p.id === ids.legacyObjectIdTeam.toHexString());
    expect(legacy?.teamId).toBe(teamId);
  });

  it('rejects an invalid `since`', async () => {
    const res = await wormhole('huddle.getMyPosts', { since: 'not a date' }, authorJwt);
    expect(res.ok).toBe(false);
  });

  it('says whether older posts exist before the window', async () => {
    const page = async (args: Record<string, unknown>) =>
      (
        await wormhole<{ hasMore: boolean }>('huddle.getMyPosts', args, authorJwt)
      ).result.hasMore;
    expect(await page({})).toBe(true); // the 40-day-old fixture
    const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    expect(await page({ since })).toBe(false);
  });
});

/**
 * `huddle.getPosts` (and the `huddlePosts.byTeam` publication, which shares the
 * same `since`) read a date window rather than the team's whole history, and
 * `hasMore` tells the client whether widening the window finds anything.
 */
describe('huddle.getPosts window', () => {
  const ids = {
    recent: new ObjectId(),
    old: new ObjectId(),
    older: new ObjectId(),
    oldDraft: new ObjectId(),
    legacyTeamId: new ObjectId(),
  };
  const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  beforeAll(async () => {
    const db = await getDb();
    const base = {
      teamId,
      userId: authorUserId,
      content: { text: 'getPosts window fixture', mentions: [] },
      attachments: [],
      likes: [],
      commentCount: 0,
    };
    const at = (createdAt: Date) => ({ createdAt, updatedAt: createdAt });
    await db.collection('huddlePosts').insertMany([
      { ...base, _id: ids.recent, ...at(daysAgo(1)) },
      { ...base, _id: ids.old, ...at(daysAgo(40)) },
      { ...base, _id: ids.older, ...at(daysAgo(100)) },
      { ...base, _id: ids.oldDraft, status: 'draft', ...at(daysAgo(200)) },
      // Legacy rows store the team as an ObjectId.
      { ...base, _id: ids.legacyTeamId, teamId: new ObjectId(teamId), ...at(daysAgo(2)) },
    ]);
  });

  afterAll(async () => {
    const db = await getDb();
    await db.collection('huddlePosts').deleteMany({ _id: { $in: Object.values(ids) } });
  });

  async function feed(args: Record<string, unknown> = {}, jwt = authorJwt) {
    return wormhole<{ posts: Array<{ id: string }>; hasMore: boolean }>(
      'huddle.getPosts',
      { teamId, ...args },
      jwt,
    );
  }

  it('defaults to the last 30 days and reports older posts exist', async () => {
    const res = await feed();
    expect(res.ok).toBe(true);
    const found = res.result.posts.map((p) => p.id);
    expect(found).toContain(ids.recent.toHexString());
    expect(found).not.toContain(ids.old.toHexString());
    expect(res.result.hasMore).toBe(true);
  });

  it('includes legacy posts whose team id is an ObjectId, as strings', async () => {
    const res = await wormhole<{ posts: Array<{ id: string; teamId: unknown }> }>(
      'huddle.getPosts',
      { teamId },
      authorJwt,
    );
    const legacy = res.result.posts.find((p) => p.id === ids.legacyTeamId.toHexString());
    expect(legacy?.teamId).toBe(teamId);
  });

  it('widens with `since`, and stops reporting more once everything is in', async () => {
    const mid = await feed({ since: daysAgo(60).toISOString() });
    const midIds = mid.result.posts.map((p) => p.id);
    expect(midIds).toContain(ids.old.toHexString());
    expect(midIds).not.toContain(ids.older.toHexString());
    expect(mid.result.hasMore).toBe(true);

    const all = await feed({ since: daysAgo(365).toISOString() });
    expect(all.result.posts.map((p) => p.id)).toContain(ids.older.toHexString());
    // The only post left beyond that is a legacy draft, which never counts.
    expect(all.result.hasMore).toBe(false);
  });

  it('rejects an invalid `since` and a non-member', async () => {
    expect((await feed({ since: 'not a date' })).ok).toBe(false);
    const outsider = await feed({}, outsiderJwt);
    expect(outsider.ok).toBe(false);
    expect(outsider.error).toMatch(/team member/i);
  });
});
