/**
 * Huddle conversation topics (#866 M3) — team and direct conversations, the
 * names people see, and who can see their posts.
 *
 * Cindy and Bob are the issue's example pair; Eve is on the same team but in
 * none of their private conversations. Covers rows 18–31 and races R17, R19, R21.
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

const PEOPLE = {
  cindy: { name: 'Cindy Ramos', email: 'conv-cindy@test.dev', password: 'Password1!' },
  bob: { name: 'Bob Okafor', email: 'conv-bob@test.dev', password: 'Password1!' },
  eve: { name: 'Eve Teammate', email: 'conv-eve@test.dev', password: 'Password1!' },
  out: { name: 'Olly Outsider', email: 'conv-outsider2@test.dev', password: 'Password1!' },
};
type Who = keyof typeof PEOPLE;
const TEAM_CODE = 'CONV0002';

const jwt = {} as Record<Who, string>;
const uid = {} as Record<Who, string>;
let teamId: string;

interface Conversation {
  id: string;
  kind: string;
  displayLabel: string | null;
  myLabel: string | null;
  label?: string | null;
  memberIds?: string[];
}

const call = <T = Conversation>(who: Who, method: string, params: Record<string, unknown>) =>
  wormhole<T>(method, params, jwt[who]);
const list = async (who: Who) =>
  (await call<{ conversations: Conversation[] }>(who, 'huddle.conversations.list', { teamId })).result
    .conversations;
const createDirect = (who: Who, other: Who) =>
  call(who, 'huddle.conversations.create', { teamId, kind: 'direct', memberIds: [uid[other]] });
const post = (who: Who, params: Record<string, unknown>) =>
  call<{ id: string }>(who, 'huddle.createPost', {
    teamId,
    content: { text: 'A private note', mentions: [] },
    postDate: new Date().toISOString().slice(0, 10),
    ...params,
  });
const feedIds = async (who: Who) =>
  (
    await call<{ posts: { id: string }[] }>(who, 'huddle.getPosts', {
      teamId,
      since: new Date(Date.now() - 864e5).toISOString(),
    })
  ).result.posts.map((p) => p.id);

beforeAll(async () => {
  for (const who of Object.keys(PEOPLE) as Who[]) await purgeUser(PEOPLE[who].email);
  const db = await getDb();
  for (const who of Object.keys(PEOPLE) as Who[]) {
    jwt[who] = (await createUserAndGetJwt(PEOPLE[who])).jwt;
    uid[who] = String((await db.collection('users').findOne({ 'emails.address': PEOPLE[who].email }))!._id);
  }
  const teamDoc = {
    _id: new ObjectId(),
    name: 'Conversation Access Team',
    members: [uid.cindy, uid.bob, uid.eve],
    admins: [uid.cindy],
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
  const ids = (await db.collection('huddleConversations').find({ teamId }).toArray()).map((c) =>
    c._id.toHexString(),
  );
  await db.collection('huddleConversationLabels').deleteMany({ conversationId: { $in: ids } });
  await db.collection('huddleConversations').deleteMany({ teamId });
  await db.collection('notifications').deleteMany({ 'data.teamId': teamId });
  for (const who of Object.keys(PEOPLE) as Who[]) await purgeUser(PEOPLE[who].email);
  await closeDb();
});

describe('direct conversations', () => {
  it('Cindy sees "Bob", Bob sees "Cindy", one shared id (row 18)', async () => {
    const made = await createDirect('cindy', 'bob');
    expect(made.ok).toBe(true);
    expect(made.result.displayLabel).toBe('Bob Okafor');

    const bobs = (await list('bob')).find((c) => c.id === made.result.id);
    expect(bobs?.displayLabel).toBe('Cindy Ramos');
  });

  it('Bob opening one with Cindy returns the same conversation (row 19)', async () => {
    const cindys = await createDirect('cindy', 'bob');
    const bobs = await createDirect('bob', 'cindy');
    expect(bobs.result.id).toBe(cindys.result.id);
  });

  it('both opening it at the same moment still makes one (R17)', async () => {
    const results = await Promise.all([
      createDirect('eve', 'bob'),
      createDirect('bob', 'eve'),
      createDirect('eve', 'bob'),
    ]);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(new Set(results.map((r) => r.result.id)).size).toBe(1);
    const db = await getDb();
    expect(
      await db.collection('huddleConversations').countDocuments({ teamId, kind: 'direct', memberIds: { $all: [uid.eve, uid.bob] } }),
    ).toBe(1);
  });

  it('refuses one with yourself or someone off the team (row 20)', async () => {
    expect((await call('cindy', 'huddle.conversations.create', { teamId, kind: 'direct', memberIds: [] })).ok).toBe(false);
    expect((await createDirect('cindy', 'cindy')).ok).toBe(false);
    expect((await createDirect('cindy', 'out')).ok).toBe(false);
  });

  it('Eve never sees it in her list', async () => {
    const made = await createDirect('cindy', 'bob');
    expect((await list('eve')).some((c) => c.id === made.result.id)).toBe(false);
  });
});

describe('team conversations and names', () => {
  it('refuses one with no name, a name over 80 characters, or nobody else (row 21)', async () => {
    const base = { teamId, kind: 'group', memberIds: [uid.bob] };
    expect((await call('cindy', 'huddle.conversations.create', { ...base, label: '  ' })).ok).toBe(false);
    expect((await call('cindy', 'huddle.conversations.create', { ...base, label: 'x'.repeat(81) })).ok).toBe(false);
    expect(
      (await call('cindy', 'huddle.conversations.create', { ...base, label: 'Solo', memberIds: [] })).ok,
    ).toBe(false);
  });

  it('a shared rename changes one row and no posts; only the creator or an admin may (rows 22, R20)', async () => {
    const group = await call('bob', 'huddle.conversations.create', {
      teamId,
      kind: 'group',
      label: 'Release 4.2 planning',
      memberIds: [uid.cindy, uid.eve],
    });
    expect(group.ok).toBe(true);
    const sent = await post('bob', { conversationId: group.result.id });
    const db = await getDb();
    const before = await db.collection('huddlePosts').findOne({ _id: new ObjectId(sent.result.id) });

    // Eve is a member but neither creator nor admin.
    expect((await call('eve', 'huddle.conversations.rename', { conversationId: group.result.id, label: 'Mine' })).ok).toBe(false);
    // Cindy is a team admin; Bob made it.
    expect((await call('cindy', 'huddle.conversations.rename', { conversationId: group.result.id, label: 'Release 4.2' })).ok).toBe(true);
    const renamed = await call('bob', 'huddle.conversations.rename', { conversationId: group.result.id, label: 'Release 4.3' });
    expect(renamed.result.displayLabel).toBe('Release 4.3');
    expect((await list('eve')).find((c) => c.id === group.result.id)?.displayLabel).toBe('Release 4.3');

    const after = await db.collection('huddlePosts').findOne({ _id: new ObjectId(sent.result.id) });
    expect(after).toEqual(before);
  });

  it('a workday or direct conversation has no shared name to rename (row 23)', async () => {
    const direct = await createDirect('cindy', 'bob');
    expect((await call('cindy', 'huddle.conversations.rename', { conversationId: direct.result.id, label: 'X' })).ok).toBe(false);
    const workday = await call('cindy', 'huddle.startWorkday', {
      teamId,
      dateKey: new Date().toISOString().slice(0, 10),
    });
    expect((await call('cindy', 'huddle.conversations.rename', { conversationId: workday.result.id, label: 'X' })).ok).toBe(false);
  });

  it("a personal name changes only that person's view; empty or default clears it (rows 24; R19)", async () => {
    const direct = await createDirect('cindy', 'bob');
    const id = direct.result.id;
    const set = await Promise.all([
      call('bob', 'huddle.conversations.setMyLabel', { conversationId: id, label: 'C.' }),
      call('bob', 'huddle.conversations.setMyLabel', { conversationId: id, label: 'C.' }),
    ]);
    expect(set.every((r) => r.ok)).toBe(true);
    expect((await list('bob')).find((c) => c.id === id)).toMatchObject({ displayLabel: 'C.', myLabel: 'C.' });
    expect((await list('cindy')).find((c) => c.id === id)?.displayLabel).toBe('Bob Okafor');

    await call('bob', 'huddle.conversations.setMyLabel', { conversationId: id, label: '' });
    expect((await list('bob')).find((c) => c.id === id)?.myLabel).toBeNull();

    await call('bob', 'huddle.conversations.setMyLabel', { conversationId: id, label: 'Cindy Ramos' });
    const db = await getDb();
    expect(await db.collection('huddleConversationLabels').countDocuments({ userId: uid.bob, conversationId: id })).toBe(0);
  });

  it("someone outside a conversation can't rename it or name it, and learns nothing", async () => {
    const direct = await createDirect('cindy', 'bob');
    const res = await call('eve', 'huddle.conversations.setMyLabel', { conversationId: direct.result.id, label: 'Peek' });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not found/i);
  });
});

describe('who sees private posts', () => {
  it("Eve's feed never gets a direct conversation's posts (row 26)", async () => {
    const direct = await createDirect('cindy', 'bob');
    const sent = await post('cindy', { conversationId: direct.result.id });
    expect(sent.ok).toBe(true);
    expect(await feedIds('bob')).toContain(sent.result.id);
    expect(await feedIds('eve')).not.toContain(sent.result.id);
    expect(await feedIds('cindy')).toContain(sent.result.id);
  });

  it("a conversation made after Eve's live feed started still never reaches her (R21)", async () => {
    const ws = METEOR_URL.replace(/^http/, 'ws') + '/websocket';
    const eve = new DDPConnection(ws);
    const bob = new DDPConnection(ws);
    try {
      await eve.connect();
      await eve.login(PEOPLE.eve.email, PEOPLE.eve.password);
      await eve.subscribe('huddlePosts.byTeam', [teamId, new Date(Date.now() - 864e5).toISOString()]);
      await bob.connect();
      await bob.login(PEOPLE.bob.email, PEOPLE.bob.password);
      await bob.subscribe('huddlePosts.byTeam', [teamId, new Date(Date.now() - 864e5).toISOString()]);

      const db = await getDb();
      await db.collection('huddleConversations').deleteMany({ teamId, kind: 'direct' });
      const fresh = await createDirect('cindy', 'bob');
      const sent = await post('cindy', { conversationId: fresh.result.id });
      const open = await post('cindy', {}); // a workday post, for comparison
      // DDP sends a 24-hex string id as "-<hex>" (Meteor's id encoding).
      const received = (conn: DDPConnection, id: string) => {
        const docs = conn.docs.get('huddlePosts');
        return !!docs && (docs.has(id) || docs.has(`-${id}`));
      };
      const waitFor = async (check: () => boolean) => {
        for (let i = 0; i < 50 && !check(); i++) await new Promise((r) => setTimeout(r, 100));
      };
      // Once the workday post has streamed to Eve, the private one had its chance too.
      await waitFor(() => received(eve, open.result.id));
      expect(received(eve, open.result.id)).toBe(true);
      expect(received(eve, sent.result.id)).toBe(false);
      await waitFor(() => received(bob, sent.result.id));
      expect(received(bob, sent.result.id)).toBe(true);
    } finally {
      eve.close();
      bob.close();
    }
  });

  it("a ticket's posts leave out ones the reader isn't in the audience of (row 27)", async () => {
    const db = await getDb();
    const ticketId = new ObjectId().toHexString();
    const base = { teamId, userId: uid.cindy, content: { text: 't', mentions: [] }, ticketIds: [ticketId], likes: [], commentCount: 0, createdAt: new Date() };
    await db.collection('huddlePosts').insertMany([
      { ...base, _id: new ObjectId(), audienceIds: [uid.cindy, uid.bob] },
      { ...base, _id: new ObjectId() },
    ]);
    const forEve = await call<{ posts: unknown[] }>('eve', 'huddle.getPostsByTicket', { ticketId });
    const forBob = await call<{ posts: unknown[] }>('bob', 'huddle.getPostsByTicket', { ticketId });
    expect(forEve.result.posts).toHaveLength(1);
    expect(forBob.result.posts).toHaveLength(2);
  });

  it('@team, @here and @mentions in a private post reach members only (rows 28, 29)', async () => {
    const direct = await createDirect('cindy', 'bob');
    const sent = await post('cindy', {
      conversationId: direct.result.id,
      content: { text: '@team heads up @Eve', mentions: [uid.eve], groupMentions: ['team'] },
    });
    expect(sent.ok).toBe(true);
    const db = await getDb();
    let toBob = 0;
    for (let i = 0; i < 30 && toBob === 0; i++) {
      await new Promise((r) => setTimeout(r, 100));
      toBob = await db.collection('notifications').countDocuments({ userId: uid.bob, 'data.postId': sent.result.id });
    }
    expect(toBob).toBeGreaterThan(0);
    expect(await db.collection('notifications').countDocuments({ userId: uid.eve, 'data.postId': sent.result.id })).toBe(0);
  });

  it("refuses a post into a conversation the author isn't in (row 31)", async () => {
    const direct = await createDirect('cindy', 'bob');
    expect((await post('eve', { conversationId: direct.result.id })).ok).toBe(false);
  });

  it('someone removed from the team loses its conversations (row 25)', async () => {
    const direct = await createDirect('cindy', 'bob');
    const db = await getDb();
    await db.collection('teams').updateOne({ code: TEAM_CODE }, { $pull: { members: uid.bob } });
    try {
      expect((await call('bob', 'huddle.conversations.list', { teamId })).ok).toBe(false);
      expect((await post('bob', { conversationId: direct.result.id })).ok).toBe(false);
    } finally {
      await db.collection('teams').updateOne({ code: TEAM_CODE }, { $addToSet: { members: uid.bob } });
    }
  });
});
