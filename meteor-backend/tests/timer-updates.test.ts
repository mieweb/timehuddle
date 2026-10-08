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

async function insertTicket(title: string): Promise<string> {
  const db = await getDb();
  const doc = {
    _id: new ObjectId(),
    teamId,
    title,
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
  it('posts "Started" to the ticket’s team, as the person, untied to the clock session', async () => {
    const res = await start(ticketA);
    expect(res.ok).toBe(true);
    expect(res.result.update?.teamId).toBe(teamId);

    const db = await getDb();
    const post = await db
      .collection('huddlePosts')
      .findOne({ _id: new ObjectId(res.result.update!.postId) });
    expect(post!.userId).toBe(userId);
    expect(post!.content.text).toBe(`*Started ${link('Alpha', ticketA)}*`);
    // A session's plan is its first post; an update must never be taken for one.
    expect(post!.clockEventId).toBeUndefined();
  });

  it('posts one "Switched to" for the ticket switched to', async () => {
    await start(ticketA);
    await start(ticketB);

    expect(await updates()).toEqual([
      `*Started ${link('Alpha', ticketA)}*`,
      `*Switched to ${link('Bravo', ticketB)}*`,
    ]);
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

  it('a break posts "Stopped", and coming back posts "Resumed"', async () => {
    await start(ticketA);
    expect((await wormhole('clock.pause', { teamId }, jwt)).ok).toBe(true);
    expect((await wormhole('clock.resume', { teamId }, jwt)).ok).toBe(true);

    expect(await updates()).toEqual([
      `*Started ${link('Alpha', ticketA)}*`,
      `*Stopped ${link('Alpha', ticketA)}*`,
      `*Resumed ${link('Alpha', ticketA)}*`,
    ]);
  });

  it('clocking out posts "Stopped" for the running ticket, timed before the clock-out', async () => {
    await start(ticketA);
    const out = await wormhole<{ endTime: number }>('clock.stop', { teamId }, jwt);
    expect(out.ok).toBe(true);

    const db = await getDb();
    const stopped = await db
      .collection('huddlePosts')
      .findOne({ teamId, 'content.text': `*Stopped ${link('Alpha', ticketA)}*` });
    expect(stopped).not.toBeNull();
    // The feed orders by time: the timer stops, then "Clocked out at…".
    expect(new Date(stopped!.createdAt).getTime()).toBeLessThan(out.result.endTime);
  });

  it('a discarded switch removes the short ticket’s update and reads as a start', async () => {
    await start(ticketA);
    await start(ticketB, { discardUpdate: true });

    expect(await updates()).toEqual([`*Started ${link('Bravo', ticketB)}*`]);
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
