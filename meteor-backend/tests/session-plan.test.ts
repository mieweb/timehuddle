/**
 * Today's plan as session data and touch-and-go check-off (M4, #886) —
 * wormhole REST integration tests.
 *
 * Fixture: USER in a team with two tickets, Alpha (TH-1) and Bravo (TH-2).
 * Each test clocks in with a plan post, sets the session's plan, acts, and
 * reads the plan and the team's posts back.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { createUserAndGetJwt, wormhole, getDb, closeDb, purgeUser, ObjectId } from './helpers';

const USER = { name: 'Plan User', email: 'wh-session-plan@test.dev', password: 'Password1!' };
const today = new Date().toISOString().split('T')[0];

interface PlanItem {
  id: string;
  ticketId?: string;
  text?: string;
  title?: string;
  checked: boolean;
  seconds?: number;
  runningSince?: number | null;
}
interface Plan {
  clockEventId: string;
  initialized: boolean;
  items: PlanItem[];
}

let jwt: string;
let userId: string;
let teamId: string;
let alpha: string;
let bravo: string;
let planPostId: string;
/** The plan post: Alpha and Bravo as tickets, Lunch as a checklist line. */
const planText = () =>
  `Today:\n\n[TH-1: Alpha](/app/tickets/${alpha})\n\n[TH-2: Bravo](/app/tickets/${bravo})\n\n- [ ] Lunch`;

async function insertTicket(title: string, number: number): Promise<string> {
  const db = await getDb();
  const doc = {
    _id: new ObjectId(),
    teamId,
    title,
    number,
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

const start = (ticketId: string) =>
  wormhole('timers.createEntry', { ticketId, date: today, startNow: true, notifyAdmins: false }, jwt);

const plan = async () => (await wormhole<Plan>('clock.plan', { teamId }, jwt)).result;

const checks = async () =>
  Object.fromEntries((await plan()).items.map((item) => [item.ticketId ?? item.text, item.checked]));

/** The team's posts other than the plan, oldest first, as their text. */
async function updates(): Promise<string[]> {
  const db = await getDb();
  const posts = await db
    .collection('huddlePosts')
    .find({ teamId, _id: { $ne: new ObjectId(planPostId) } })
    .sort({ createdAt: 1 })
    .toArray();
  return posts.map((post) => post.content.text as string);
}

beforeAll(async () => {
  await purgeUser(USER.email);
  jwt = (await createUserAndGetJwt(USER)).jwt;
  const db = await getDb();
  userId = String((await db.collection('users').findOne({ 'emails.address': USER.email }))!._id);
  const team = {
    _id: new ObjectId(),
    name: 'WH Plan Team',
    members: [userId],
    admins: [userId],
    code: 'WHPLAN',
    isPersonal: false,
    settings: { requirePlanForClock: false },
    createdAt: new Date(),
  };
  await db.collection('teams').insertOne(team);
  teamId = team._id.toHexString();
  alpha = await insertTicket('Alpha', 1);
  bravo = await insertTicket('Bravo', 2);
});

beforeEach(async () => {
  const db = await getDb();
  const created = new Date();
  const post = {
    _id: new ObjectId(),
    teamId,
    userId,
    content: { text: planText(), mentions: [] },
    attachments: [],
    likes: [],
    commentCount: 0,
    createdAt: created,
    updatedAt: created,
  };
  await db.collection('huddlePosts').insertOne(post);
  planPostId = post._id.toHexString();
  expect((await wormhole('clock.start', { teamId, planPostId }, jwt)).ok).toBe(true);
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
  await db.collection('teams').deleteMany({ code: 'WHPLAN' });
  await db.collection('tickets').deleteMany({ teamId });
  await purgeUser(USER.email);
  await closeDb();
});

describe("today's plan on the session", () => {
  it('starts from the plan post, unannounced, and names its tickets', async () => {
    const current = await plan();
    expect(current.initialized).toBe(true);
    expect(current.items.map((item) => item.title ?? item.text)).toEqual([
      'TH-1: Alpha',
      'TH-2: Bravo',
      'Lunch',
    ]);
    expect(await updates()).toEqual([]);
  });

  it('starts from the plan post, not an update posted to the session before it was read', async () => {
    const db = await getDb();
    const planPost = await db.collection('huddlePosts').findOne({ _id: new ObjectId(planPostId) });
    // The update comes first in the session's posts.
    await db.collection('huddlePosts').deleteOne({ _id: planPost!._id });
    await db.collection('huddlePosts').insertOne({
      ...planPost!,
      _id: new ObjectId(),
      content: { text: '- [ ] Just an update', mentions: [] },
      sessionUpdate: true,
    });
    await db.collection('huddlePosts').insertOne(planPost!);

    expect((await plan()).items.map((item) => item.title ?? item.text)).toEqual([
      'TH-1: Alpha',
      'TH-2: Bravo',
      'Lunch',
    ]);
  });

  it('starts from the plan post when a timer gets there before any page does', async () => {
    await start(alpha);
    await start(bravo);
    expect(await checks()).toMatchObject({ [alpha]: true, [bravo]: false });
  });

  it('TH-1 → TH-2 → TH-1 leaves TH-1 unchecked and TH-2 checked off, each a new post', async () => {
    await start(alpha);
    await start(bravo);
    expect(await checks()).toMatchObject({ [alpha]: true, [bravo]: false });
    await start(alpha);
    expect(await checks()).toMatchObject({ [alpha]: false, [bravo]: true, Lunch: false });
    const running = (await plan()).items.filter((item) => item.runningSince);
    expect(running.map((item) => item.ticketId)).toEqual([alpha]);

    // Each switch is its own "Working on", after the check-off it made.
    expect(await updates()).toEqual([
      `*Working on [TH-1: Alpha](/app/tickets/${alpha})*`,
      `*Checked off [TH-1: Alpha](/app/tickets/${alpha}) at 0m*`,
      `*Working on [TH-2: Bravo](/app/tickets/${bravo})*`,
      `*Checked off [TH-2: Bravo](/app/tickets/${bravo}) at 0m*`,
      `*Working on [TH-1: Alpha](/app/tickets/${alpha})*`,
    ]);

    // The plan post is the agreed record: never edited to show progress.
    const db = await getDb();
    const planPost = await db.collection('huddlePosts').findOne({ _id: new ObjectId(planPostId) });
    expect(planPost!.content.text).toBe(planText());
    expect(planPost!.updatedAt.getTime()).toBe(planPost!.createdAt.getTime());
  });

  it('announces a ticket added to the plan, and keeps what was checked', async () => {
    const db = await getDb();
    const third = await insertTicket('Charlie', 3);
    await start(alpha);
    await start(bravo);
    const res = await wormhole<Plan>(
      'clock.setPlan',
      { teamId, items: [{ ticketId: alpha }, { ticketId: bravo }, { ticketId: third }] },
      jwt,
    );
    expect(res.result.items.map((item) => item.checked)).toEqual([true, false, false]);
    expect((await updates()).at(-1)).toBe(
      `*Added [TH-3: Charlie](/app/tickets/${third}) to today's plan*`,
    );
    await db.collection('tickets').deleteOne({ _id: new ObjectId(third) });
  });

  it('checks an item off by hand and back, each announced', async () => {
    const lunch = (await plan()).items.find((item) => item.text === 'Lunch')!;
    await wormhole('clock.checkPlanItem', { teamId, itemId: lunch.id, checked: true }, jwt);
    await wormhole('clock.checkPlanItem', { teamId, itemId: lunch.id, checked: true }, jwt);
    await wormhole('clock.checkPlanItem', { teamId, itemId: lunch.id, checked: false }, jwt);
    expect(await updates()).toEqual(['*Checked off “Lunch”*', '*Unchecked “Lunch”*']);
  });

  it('keeps both of two checks made at once, and announces both', async () => {
    const { items } = await plan();
    await Promise.all(
      items.map((item) =>
        wormhole('clock.checkPlanItem', { teamId, itemId: item.id, checked: true }, jwt),
      ),
    );
    expect(Object.values(await checks())).toEqual([true, true, true]);
    expect(await updates()).toHaveLength(3);
  });

  it('announces a check an edit changes', async () => {
    await wormhole(
      'clock.setPlan',
      {
        teamId,
        items: [{ ticketId: alpha }, { ticketId: bravo }, { text: 'Lunch', checked: true }],
      },
      jwt,
    );
    expect(await updates()).toEqual(['*Checked off “Lunch”*']);
  });

  it('refuses someone no longer on the team, though their session is open', async () => {
    const db = await getDb();
    await db
      .collection('teams')
      .updateOne({ _id: new ObjectId(teamId) }, { $pull: { members: userId, admins: userId } });
    try {
      const read = await wormhole('clock.plan', { teamId }, jwt);
      const check = await wormhole(
        'clock.checkPlanItem',
        { teamId, itemId: 'x', checked: true },
        jwt,
      );
      expect(read.ok).toBe(false);
      expect(check.ok).toBe(false);
      expect(await updates()).toEqual([]);
    } finally {
      await db
        .collection('teams')
        .updateOne({ _id: new ObjectId(teamId) }, { $set: { members: [userId], admins: [userId] } });
    }
  });

  it('announces the first plan of a session that had no plan post', async () => {
    const db = await getDb();
    await db.collection('huddlePosts').deleteOne({ _id: new ObjectId(planPostId) });
    await db.collection('clockevents').updateMany({ userId }, { $unset: { planItems: '', planRev: '' } });
    await wormhole('clock.setPlan', { teamId, items: [{ ticketId: bravo }] }, jwt);
    expect(await updates()).toEqual([
      `*Added [TH-2: Bravo](/app/tickets/${bravo}) to today's plan*`,
    ]);
  });

  it('saves no plan from a plan post it cannot use, and says why', async () => {
    const db = await getDb();
    await db
      .collection('huddlePosts')
      .updateOne({ _id: new ObjectId(planPostId) }, { $set: { 'content.text': `- [ ] ${'x'.repeat(501)}` } });
    await db.collection('clockevents').updateMany({ userId }, { $unset: { planItems: '', planRev: '' } });
    const read = await wormhole('clock.plan', { teamId }, jwt);
    expect(read.ok).toBe(false);
    expect(JSON.stringify(read)).toContain('Shorten your plan post');
    const event = await db.collection('clockevents').findOne({ userId, endTime: null });
    expect(event!.planItems).toBeUndefined();
  });

  it('tells the plan’s team of a check-off when the switch goes to another team’s ticket', async () => {
    const db = await getDb();
    const other = {
      _id: new ObjectId(),
      name: 'WH Plan Other Team',
      members: [userId],
      admins: [userId],
      code: 'WHPLAN2',
      isPersonal: false,
      createdAt: new Date(),
    };
    await db.collection('teams').insertOne(other);
    const charlie = new ObjectId();
    await db.collection('tickets').insertOne({
      _id: charlie,
      teamId: other._id.toHexString(),
      title: 'Charlie',
      number: 3,
      status: 'open',
      priority: 'medium',
      createdBy: userId,
      assignedTo: userId,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    try {
      await start(alpha);
      await start(charlie.toHexString());
      expect(await checks()).toMatchObject({ [alpha]: true });
      expect(await updates()).toEqual([
        `*Working on [TH-1: Alpha](/app/tickets/${alpha})*`,
        `*Checked off [TH-1: Alpha](/app/tickets/${alpha}) at 0m*`,
      ]);
    } finally {
      await db.collection('tickets').deleteOne({ _id: charlie });
      await db.collection('huddlePosts').deleteMany({ teamId: other._id.toHexString() });
      await db.collection('teams').deleteOne({ _id: other._id });
    }
  });

  it('keeps a check-off in Huddle when the switch after it is discarded', async () => {
    await start(alpha);
    await start(bravo);
    const running = await wormhole<{ session: { id: string } }>('timers.getRunning', {}, jwt);
    await wormhole(
      'timers.stopSession',
      { sessionId: running.result.session.id, discardUpdate: true },
      jwt,
    );
    expect(await checks()).toMatchObject({ [alpha]: true });
    expect(await updates()).toEqual([
      `*Working on [TH-1: Alpha](/app/tickets/${alpha})*`,
      `*Checked off [TH-1: Alpha](/app/tickets/${alpha}) at 0m*`,
    ]);
  });

  it('leaves another team’s ticket out of the plan', async () => {
    const res = await wormhole<Plan>(
      'clock.setPlan',
      { teamId, items: [{ ticketId: new ObjectId().toHexString() }, { ticketId: alpha }] },
      jwt,
    );
    expect(res.result.items.map((item) => item.ticketId)).toEqual([alpha]);
  });
});
