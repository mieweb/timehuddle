#!/usr/bin/env node
// Seeds the performance fixture that the perf suite and the before/after
// comparison environment measure against: a 46-member team with hundreds of
// tickets, three months of activity and clock sessions, plus five small teams.
//
//   PERF_PASSWORD=… node tests/performance/env/seed-perf-fixture.mjs
//
// Env:
//   MONGO_URL      default mongodb://127.0.0.1:27017/timehuddle?directConnection=true
//   PERF_EMAIL     default perf-bot@test.local — the account the suite signs in as
//   PERF_PASSWORD  required — set on that account
//
// Safe to re-run: generated documents carry `perfBench: true` and are replaced
// on every run, so the time-relative data (activity, clock sessions) always
// ends "now". The sign-in accounts — the perf user and the dev quick-login
// accounts — are created or updated in place, never deleted, so their personal
// teams and sessions survive a re-seed.
//
// Point it only at a throwaway database: it replaces any existing perf fixture
// and makes the perf user an owner of the default organization and enterprise.
//
// `mongodb` and `bcrypt` resolve like a CommonJS script, so NODE_PATH works —
// the container points it at the Meteor bundle's node_modules.
import { createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { MongoClient, ObjectId } = require('mongodb');
const bcrypt = require('bcrypt');

const MONGO_URL =
  process.env.MONGO_URL ?? 'mongodb://127.0.0.1:27017/timehuddle?directConnection=true';
const PERF_EMAIL = process.env.PERF_EMAIL ?? 'perf-bot@test.local';
const PERF_PASSWORD = process.env.PERF_PASSWORD;
if (!PERF_PASSWORD) {
  console.error('PERF_PASSWORD is required.');
  process.exit(1);
}

// Fixed ids keep deep links (e.g. /app/teams?teamId=…) stable across re-seeds.
const oid = (kind, n) =>
  new ObjectId(`7e2f${kind.toString(16).padStart(2, '0')}${n.toString(16).padStart(18, '0')}`);
const KIND = { team: 1, dashTicket: 2, teamTicket: 3, board: 4, clock: 5, activity: 6, member: 7 };

const BENCH_USERS = 40;
const DASH_TICKETS = 400;
const SMALL_TEAMS = 5;
const SMALL_TEAM_TICKETS = 100;
const BOARD_ENTRIES = 40;
const CLOCK_SESSIONS = 95;
const ACTIVITIES = 2000;
const HISTORY_DAYS = 90;

// Same accounts as meteor-backend/server/dev-quick-login.js, so quick sign-in lands in this fixture.
const DEV_ACCOUNTS = [
  { email: 'dev-member@test.local', username: 'dev_member', name: 'Dev Member' },
  { email: 'dev-admin@test.local', username: 'dev_admin', name: 'Dev Org Admin' },
  { email: 'dev-owner@test.local', username: 'dev_owner', name: 'Dev Org Owner' },
  {
    email: 'dev-enterprise-admin@test.local',
    username: 'dev_ent_admin',
    name: 'Dev Enterprise Admin',
  },
  {
    email: 'dev-enterprise-owner@test.local',
    username: 'dev_ent_owner',
    name: 'Dev Enterprise Owner',
  },
];

const VERBS = [
  'Fix login redirect',
  'Add export',
  'Update docs',
  'Speed up search',
  'Handle empty state',
  'Refine permissions',
  'Clean up styles',
  'Retry failed sync',
];
const STATUSES = [
  'open',
  'in-progress',
  'closed',
  'open',
  'in-progress',
  'closed',
  'done',
  'review',
];
const PRIORITIES = ['medium', 'low', 'medium', 'urgent', 'high', null];
const ACTIVITY_TYPES = [
  'ticket.created',
  'ticket.assigned',
  'ticket.updated',
  'clock.in',
  'clock.out',
];
const DESCRIPTION =
  'Steps to reproduce: open the page, click the control, observe the result. ' +
  'Expected: the change is saved and the list refreshes. Actual: the spinner keeps ' +
  'turning and nothing updates until the page is reloaded. Seen on desktop and mobile, ' +
  'with and without a slow connection. Notes: started after the last release; the ' +
  'console shows no error. Acceptance: the action completes in under a second, the ' +
  'list shows the new state without a reload, and a failure shows a clear message ' +
  'the user can act on.';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Meteor's accounts-password stores bcrypt(sha256hex(password)). */
const meteorPasswordHash = (password) =>
  bcrypt.hash(createHash('sha256').update(password).digest('hex'), 10);

/**
 * Create the account if missing, keeping its id when it exists; returns the user id.
 * New ids are hex so they pass the backend's isValidId (meteor-backend/server/collections.js).
 */
async function upsertAccount(users, { email, username, name }, extraSet = {}) {
  const existing = await users.findOne({ 'emails.address': email }, { projection: { _id: 1 } });
  const _id = existing?._id ?? randomBytes(9).toString('hex');
  await users.updateOne(
    { _id },
    {
      $set: {
        username,
        'profile.name': name,
        emails: [{ address: email, verified: true }],
        ...extraSet,
      },
      $setOnInsert: { createdAt: new Date(), 'services.resume.loginTokens': [] },
    },
    { upsert: true },
  );
  return _id;
}

/** Mirrors ensureDefaultOrganization() in meteor-backend/server/org-helpers.js. */
async function ensureDefaultOrg(db) {
  const now = new Date();
  const blank = {
    owners: [],
    admins: [],
    settings: {},
    settingsLocks: {},
    createdAt: now,
    updatedAt: now,
  };
  await db
    .collection('enterprises')
    .updateOne(
      { slug: 'default-enterprise' },
      { $setOnInsert: { _id: new ObjectId(), name: 'Default Enterprise', ...blank } },
      { upsert: true },
    );
  const enterprise = await db.collection('enterprises').findOne({ slug: 'default-enterprise' });
  await db.collection('organizations').updateOne(
    { slug: 'default' },
    {
      $setOnInsert: {
        _id: new ObjectId(),
        enterpriseId: enterprise._id.toHexString(),
        name: 'Default Organization',
        ...blank,
      },
    },
    { upsert: true },
  );
  const org = await db.collection('organizations').findOne({ slug: 'default' });
  return { org, enterpriseId: org.enterpriseId ?? enterprise._id.toHexString() };
}

async function seed() {
  const client = await MongoClient.connect(MONGO_URL);
  const db = client.db();
  const users = db.collection('users');
  const now = Date.now();
  const tag = { perfBench: true };

  // Generated data is replaced wholesale on every run.
  for (const name of ['teams', 'tickets', 'my_board', 'clockevents', 'activities', 'org_members']) {
    await db.collection(name).deleteMany(tag);
  }
  await users.deleteMany(tag);

  const { org, enterpriseId } = await ensureDefaultOrg(db);
  const orgId = org._id.toHexString();

  const perfBotId = await upsertAccount(
    users,
    { email: PERF_EMAIL, username: 'perf_bot', name: 'Perf Bot' },
    {
      'services.password.bcrypt': await meteorPasswordHash(PERF_PASSWORD),
      // Seen-all, so the "what's new" banner doesn't cover the pages being measured.
      releaseNotesSeenVersion: '999.0.0',
    },
  );
  const devIds = [];
  for (const account of DEV_ACCOUNTS) devIds.push(await upsertAccount(users, account));

  // Letters and digits only, like every user id (see isValidId).
  const benchIds = Array.from({ length: BENCH_USERS }, (_, i) => `perfbenchuser${i}`);
  await users.insertMany(
    benchIds.map((_id, i) => ({
      _id,
      emails: [{ address: `bench-user-${i}@bench.local`, verified: true }],
      profile: { name: `Bench User ${i}` },
      username: `bench_user_${i}`,
      createdAt: new Date(now - HISTORY_DAYS * DAY),
      ...tag,
    })),
  );

  // Owner of the default org and enterprise — Members, Usage and Enterprise need it.
  await db.collection('org_members').insertOne({
    _id: oid(KIND.member, 0),
    orgId,
    userId: perfBotId,
    role: 'owner',
    auto: false,
    createdAt: new Date(now),
    updatedAt: new Date(now),
    ...tag,
  });
  await db
    .collection('organizations')
    .updateOne(
      { _id: org._id },
      { $addToSet: { owners: perfBotId }, $pull: { admins: perfBotId } },
    );
  await db
    .collection('enterprises')
    .updateOne({ _id: new ObjectId(enterpriseId) }, { $addToSet: { owners: perfBotId } });

  // People who create, own and clock time on tickets: the perf user and the dev accounts.
  const workers = [perfBotId, ...devIds];
  const members = [perfBotId, ...devIds, ...benchIds];
  const nameOf = new Map([
    [perfBotId, 'Perf Bot'],
    ...DEV_ACCOUNTS.map((account, i) => [devIds[i], account.name]),
    ...benchIds.map((id, i) => [id, `Bench User ${i}`]),
  ]);

  const createdAt = new Date(now - HISTORY_DAYS * DAY);
  const team = (_id, name, code, teamMembers) => ({
    _id,
    name,
    orgId,
    admins: [perfBotId],
    members: teamMembers,
    code,
    isPersonal: false,
    parentTeamId: null,
    // Explicitly off: new teams default to plan-first, which would gate clock-in.
    settings: { requirePlanForClock: false },
    createdAt,
    updatedAt: createdAt,
    ...tag,
  });
  const dashTeamId = oid(KIND.team, 0);
  const smallTeamIds = Array.from({ length: SMALL_TEAMS }, (_, i) => oid(KIND.team, i + 1));
  await db
    .collection('teams')
    .insertMany([
      team(dashTeamId, 'Dash Bench', 'DASHBNCH', members),
      ...smallTeamIds.map((id, i) =>
        team(id, `Bench Team ${i + 1}`, `BNCH000${i + 1}`, [perfBotId, ...devIds.slice(0, 4)]),
      ),
    ]);
  const dashTeam = dashTeamId.toHexString();

  const dashTickets = Array.from({ length: DASH_TICKETS }, (_, i) => {
    const at = new Date(now - (DASH_TICKETS - i) * 4 * HOUR);
    return {
      _id: oid(KIND.dashTicket, i),
      teamId: dashTeam,
      title: `Bench ticket ${i}: ${VERBS[i % VERBS.length]}`,
      description: DESCRIPTION,
      github: '',
      status: STATUSES[i % STATUSES.length],
      priority: PRIORITIES[i % PRIORITIES.length],
      createdBy: workers[(i + 1) % workers.length],
      assignedTo: i % 7 === 6 ? [] : [workers[i % workers.length]],
      createdAt: at,
      updatedAt: at,
      ...tag,
    };
  });
  const smallTickets = smallTeamIds.flatMap((id, t) =>
    Array.from({ length: SMALL_TEAM_TICKETS }, (_, m) => ({
      _id: oid(KIND.teamTicket, t * 1000 + m),
      teamId: id.toHexString(),
      title: `Team ${t + 1} ticket ${m}: ${VERBS[m % VERBS.length]}`,
      description: DESCRIPTION,
      github: '',
      status: 'open',
      createdBy: perfBotId,
      assignedTo: [perfBotId],
      createdAt,
      updatedAt: createdAt,
      ...tag,
    })),
  );
  await db.collection('tickets').insertMany([...dashTickets, ...smallTickets]);

  await db.collection('my_board').insertMany(
    dashTickets.slice(0, BOARD_ENTRIES).map((ticket, k) => ({
      _id: oid(KIND.board, k),
      ticketId: ticket._id.toHexString(),
      sourceId: 'huddle',
      userId: perfBotId,
      addedAt: new Date(now),
      ...tag,
    })),
  );

  // Closed shifts spread over the last HISTORY_DAYS, plus one session still open.
  const clock = Array.from({ length: CLOCK_SESSIONS - 1 }, (_, n) => {
    const day = Math.floor((n * HISTORY_DAYS) / (CLOCK_SESSIONS - 1)) + 1;
    const start = now - day * DAY - 6 * HOUR;
    return {
      _id: oid(KIND.clock, n),
      userId: workers[n % workers.length],
      teamId: dashTeam,
      startTime: start,
      accumulatedTime: 0,
      autoClockoutAgreed: null,
      endTime: start + (4 + (n % 4)) * HOUR,
      ...tag,
    };
  });
  clock.push({
    _id: oid(KIND.clock, CLOCK_SESSIONS - 1),
    userId: devIds[0],
    teamId: dashTeam,
    startTime: now - 2 * HOUR,
    accumulatedTime: 0,
    autoClockoutAgreed: null,
    endTime: null,
    ...tag,
  });
  await db.collection('clockevents').insertMany(clock);

  // Spread evenly from HISTORY_DAYS + 2 days ago up to about an hour ago.
  const activitySpan = (HISTORY_DAYS + 2) * DAY;
  const activities = Array.from({ length: ACTIVITIES }, (_, n) => {
    const actor = members[n % members.length];
    const ticket = dashTickets[n % DASH_TICKETS];
    return {
      _id: oid(KIND.activity, n),
      userId: actor,
      teamId: dashTeam,
      type: ACTIVITY_TYPES[n % ACTIVITY_TYPES.length],
      actor: { id: actor, name: nameOf.get(actor) },
      payload: { ticketId: ticket._id.toHexString(), ticketTitle: ticket.title, teamId: dashTeam },
      occurredAt: new Date(now - ((ACTIVITIES - n) * activitySpan) / ACTIVITIES),
      source: 'timehuddle',
      ...tag,
    };
  });
  await db.collection('activities').insertMany(activities);

  await client.close();
  console.log(
    JSON.stringify(
      {
        perfUser: PERF_EMAIL,
        dashTeamId: dashTeam,
        counts: {
          dashMembers: members.length,
          tickets: dashTickets.length + smallTickets.length,
          myBoard: BOARD_ENTRIES,
          clockSessions: clock.length,
          activities: activities.length,
        },
      },
      null,
      2,
    ),
  );
}

seed().catch((error) => {
  console.error(error);
  process.exit(1);
});
