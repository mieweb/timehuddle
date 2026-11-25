/**
 * Automatic Huddle updates for ticket timers (#681) — wormhole REST
 * integration tests.
 *
 * Fixture: USER in a team with two tickets. Each test clocks in, acts, and
 * reads the team's posts straight from the database.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { createUserAndGetJwt, wormhole, getDb, closeDb, purgeUser, ObjectId } from './helpers';

const USER = { name: 'Update User', email: 'wh-timer-update@test.dev', password: 'Password1!' };
const today = new Date().toISOString().split('T')[0];

type Update = { postId: string; teamId: string } | null;
type Started = { entry: { id: string }; session: { id: string }; update: Update };

let jwt: string;
let userId: string;
let teamId: string;
let ticketA: string;
let ticketB: string;

async function insertTicket(title: string, extra: Record<string, unknown> = {}): Promise<string> {
  const db = await getDb();
  const doc = {
    _id: new ObjectId(),
    teamId,
    title,
    ...extra,
    status: 'open',
    priority: 'medium',
    createdBy: userId,
    assignedTo: userId,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  await db.collection('tickets').insertOne(doc);
  return doc._id.toHexString();
}

const start = (ticketId: string, extra: Record<string, unknown> = {}) =>
  wormhole<Started>(
    'timers.createEntry',
    { ticketId, date: today, startNow: true, notifyAdmins: false, ...extra },
    jwt,
  );

/** A Huddle ticket as an update names and links it: `[#3fa2c: Alpha](/app/tickets/<id>)`. */
const link = (title: string, id: string) => `[#${id.slice(-5)}: ${title}](/app/tickets/${id})`;

/** The team's posts, oldest first, as their text. */
async function updates(): Promise<string[]> {
  const db = await getDb();
  const posts = await db.collection('huddlePosts').find({ teamId }).sort({ createdAt: 1 }).toArray();
  return posts.map((post) => post.content.text as string);
}

beforeAll(async () => {
  await purgeUser(USER.email);
  jwt = (await createUserAndGetJwt(USER)).jwt;
  const db = await getDb();
  userId = String((await db.collection('users').findOne({ 'emails.address': USER.email }))!._id);

  const team = {
    _id: new ObjectId(),
    name: 'WH Update Team',
    members: [userId],
    admins: [userId],
    code: 'WHUPDATE',
    isPersonal: false,
    settings: { requirePlanForClock: false },
    createdAt: new Date(),
  };
  await db.collection('teams').insertOne(team);
  teamId = team._id.toHexString();
  ticketA = await insertTicket('Alpha');
  ticketB = await insertTicket('Bravo');
});

beforeEach(async () => {
  expect((await wormhole('clock.start', { teamId }, jwt)).ok).toBe(true);
});

afterEach(async () => {
  await wormhole('clock.stop', { teamId }, jwt);
  const db = await getDb();
  await db.collection('huddlePosts').deleteMany({ teamId });
  await db.collection('timers').deleteMany({ userId });
  await db.collection('workitems').deleteMany({ userId });
  await db.collection('clockevents').deleteMany({ userId });
  await db.collection('clockbreaks').deleteMany({});
});

afterAll(async () => {
  const db = await getDb();
  await db.collection('teams').deleteMany({ code: 'WHUPDATE' });
  await db.collection('tickets').deleteMany({ teamId });
  await purgeUser(USER.email);
  await closeDb();
});

describe('timer updates in Huddle', () => {
  it('posts "Working on" to the ticket’s team, as the person, untied to the clock session', async () => {
    const res = await start(ticketA);
    expect(res.ok).toBe(true);
    expect(res.result.update?.teamId).toBe(teamId);

    const db = await getDb();
    const post = await db
      .collection('huddlePosts')
      .findOne({ _id: new ObjectId(res.result.update!.postId) });
    expect(post!.userId).toBe(userId);
    expect(post!.content.text).toBe(`*Working on ${link('Alpha', ticketA)}*`);
    // A session's plan is its first post; an update must never be taken for one.
    expect(post!.clockEventId).toBeUndefined();
  });

  it('names a numbered ticket by its ID and title (#788)', async () => {
    const numbered = await insertTicket('Charlie', { number: 41 });
    await start(numbered);

    expect(await updates()).toEqual([`*Working on [TH-41: Charlie](/app/tickets/${numbered})*`]);
  });

  it('posts the title of a ticket carrying a Redmine issue (#788)', async () => {
    const carried = await insertTicket('Delta', {
      number: 42,
      linkedIssue: { source: 'redmine', id: '656', host: 'redmine.example.com' },
    });
    await start(carried);

    // The team's org names no Redmine server, so the ticket keeps its own ID.
    expect(await updates()).toEqual([`*Working on [TH-42: Delta](/app/tickets/${carried})*`]);
  });

  it('posts one "Working on" for the ticket switched to', async () => {
    await start(ticketA);
    await start(ticketB);

    expect(await updates()).toEqual([
      `*Working on ${link('Alpha', ticketA)}*`,
      `*Working on ${link('Bravo', ticketB)}*`,
    ]);
  });

  it("coming back to a ticket continues its time: the update counts on from what it had", async () => {
    const first = await start(ticketA);
    await start(ticketB);
    // Alpha's first stint ran two minutes.
    const db = await getDb();
    await db
      .collection('timers')
      .updateOne(
        { _id: new ObjectId(first.result.session.id) },
        { $inc: { startTime: -120_000, durationSeconds: 120 } },
      );
    const again = await start(ticketA);

    const res = await wormhole<{ posts: { id: string; timer: { priorSeconds: number } | null }[] }>(
      'huddle.getPosts',
      { teamId, since: new Date(Date.now() - 60_000).toISOString() },
      jwt,
    );
    const timerOf = (postId: string) => res.result.posts.find((p) => p.id === postId)?.timer;
    expect(timerOf(first.result.update!.postId)?.priorSeconds).toBe(0);
    expect(timerOf(again.result.update!.postId)?.priorSeconds).toBeGreaterThanOrEqual(120);
  });

  it("reads each update with its stint's timer: running, then stopped by the switch", async () => {
    const first = await start(ticketA);
    const second = await start(ticketB);
    const timerOf = async (postId: string) => {
      const res = await wormhole<{ posts: { id: string; timer: unknown }[] }>(
        'huddle.getPosts',
        { teamId, since: new Date(Date.now() - 60_000).toISOString() },
        jwt,
      );
      expect(res.ok).toBe(true);
      return res.result.posts.find((post) => post.id === postId)?.timer;
    };

    const switchedFrom = await timerOf(first.result.update!.postId);
    expect(switchedFrom).toMatchObject({ startTime: expect.any(Number), endTime: expect.any(Number) });
    expect(await timerOf(second.result.update!.postId)).toMatchObject({
      startTime: expect.any(Number),
      endTime: null,
    });
  });

  it('posts "Stopped" when the timer is stopped', async () => {
    const started = await start(ticketA);
    const stopped = await wormhole<{ update: Update }>(
      'timers.stopSession',
      { sessionId: started.result.session.id },
      jwt,
    );

    expect(stopped.result.update?.teamId).toBe(teamId);
    expect((await updates()).at(-1)).toBe(`*Stopped ${link('Alpha', ticketA)}*`);
  });

  it('posts nothing for restarting the ticket that is already running', async () => {
    await start(ticketA);
    const again = await start(ticketA);

    expect(again.result.update).toBeNull();
    expect(await updates()).toHaveLength(1);
  });

  it('a break posts "Stopped", and coming back posts "Working on" again', async () => {
    await start(ticketA);
    expect((await wormhole('clock.pause', { teamId }, jwt)).ok).toBe(true);
    expect((await wormhole('clock.resume', { teamId }, jwt)).ok).toBe(true);

    expect(await updates()).toEqual([
      `*Working on ${link('Alpha', ticketA)}*`,
      `*Stopped ${link('Alpha', ticketA)}*`,
      `*Working on ${link('Alpha', ticketA)}*`,
    ]);
  });

  it('clocking out posts nothing for the running ticket: its update shows the time, stopped', async () => {
    await start(ticketA);
    const out = await wormhole<{ endTime: number }>('clock.stop', { teamId }, jwt);
    expect(out.ok).toBe(true);

    expect(await updates()).toEqual([`*Working on ${link('Alpha', ticketA)}*`]);
  });

  it('a discarded switch removes the short ticket’s update and reads as a start', async () => {
    const short = await start(ticketA);
    await start(ticketB, { discardSessionId: short.result.session.id });

    expect(await updates()).toEqual([`*Working on ${link('Bravo', ticketB)}*`]);
  });

  it('a discard naming a session that is no longer the running one discards nothing', async () => {
    // Another tab moved from Alpha to Bravo while the question about Alpha was open.
    const asked = await start(ticketA);
    await start(ticketB);
    const ticketC = await insertTicket('Charlie');
    await start(ticketC, { discardSessionId: asked.result.session.id });

    expect(await updates()).toEqual([
      `*Working on ${link('Alpha', ticketA)}*`,
      `*Working on ${link('Bravo', ticketB)}*`,
      `*Working on ${link('Charlie', ticketC)}*`,
    ]);
  });

  it('a discarded stop removes the update and posts nothing', async () => {
    const started = await start(ticketA);
    const stopped = await wormhole<{ update: Update }>(
      'timers.stopSession',
      { sessionId: started.result.session.id, discardUpdate: true },
      jwt,
    );

    expect(stopped.ok).toBe(true);
    expect(stopped.result.update).toBeNull();
    expect(await updates()).toEqual([]);
  });

  it('posts nothing to a team the person has left', async () => {
    const started = await start(ticketA);
    await wormhole('timers.stopSession', { sessionId: started.result.session.id }, jwt);
    const db = await getDb();
    await db.collection('huddlePosts').deleteMany({ teamId });
    // Still clocked in, and the work item is still theirs; only membership is gone.
    await db
      .collection('teams')
      .updateOne({ _id: new ObjectId(teamId) }, { $set: { members: [], admins: [] } });

    try {
      const res = await wormhole<{ session: { id: string }; update: Update }>(
        'timers.startSession',
        { entryId: started.result.entry.id },
        jwt,
      );

      expect(res.ok).toBe(true);
      expect(res.result.update).toBeNull();
      expect(await updates()).toEqual([]);
    } finally {
      await db
        .collection('teams')
        .updateOne({ _id: new ObjectId(teamId) }, { $set: { members: [userId], admins: [userId] } });
    }
  });

  it('starts the timer even when the update cannot be posted', async () => {
    // A work item whose ticket is gone has no team to post to.
    const db = await getDb();
    const entry = {
      _id: new ObjectId(),
      userId,
      source: 'huddle',
      ticketId: new ObjectId().toHexString(),
      date: today,
      createdAt: new Date(),
    };
    await db.collection('workitems').insertOne(entry);

    const res = await wormhole<{ session: { id: string }; update: Update }>(
      'timers.startSession',
      { entryId: entry._id.toHexString() },
      jwt,
    );

    expect(res.ok).toBe(true);
    expect(res.result.session.id).toBeDefined();
    expect(res.result.update).toBeNull();
    expect(await updates()).toEqual([]);
  });
});
