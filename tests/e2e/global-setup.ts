/**
 * Playwright global setup — provisions the `@test.local` seed users the e2e
 * suite depends on (owner1/2, admin1/2/3, member1-5, unclaimed) and wires
 * them into the default organization with the expected roles.
 *
 * Runs once before any test worker starts. Idempotent — safe to re-run.
 *
 * Requirements:
 *   - MongoDB reachable at MONGO_URL (defaults to the local docker/dev instance)
 *   - Meteor backend has been started at least once so the default organization
 *     exists. If it doesn't, we create it.
 */
import { MongoClient, ObjectId, type Db } from 'mongodb';
import bcrypt from 'bcrypt';
import { createHash } from 'crypto';

const MONGO_URL =
  process.env.MONGO_URL ?? 'mongodb://127.0.0.1:27017/timehuddle_test?replicaSet=rs0';
const BACKEND_URL = process.env.API_TARGET ?? 'http://localhost:3101';
const PASSWORD = 'TestPass1!';

/**
 * Poll the Meteor backend's /health endpoint until it responds.
 *
 * Guards against a race where the backend was just (re)started — e.g. via
 * `pm2 restart all` — and is still finishing DDP/Mongo initialization when
 * the suite begins. Without this, the first test(s) to log in can hang on
 * the DDP handshake past the login timeout (see activity-log.spec.ts flake).
 */
async function waitForBackend(url: string, timeoutMs = 30000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/health`);
      if (res.ok) return;
      lastError = new Error(`/health returned ${res.status}`);
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    `Meteor backend at ${url} did not become healthy within ${timeoutMs}ms: ${String(lastError)}`,
  );
}

const SEED_USERS = [
  { email: 'owner1@test.local', name: 'Test Owner One', username: 'owner1', role: 'owner' },
  { email: 'owner2@test.local', name: 'Test Owner Two', username: 'owner2', role: 'owner' },
  { email: 'admin1@test.local', name: 'Test Admin One', username: 'admin1', role: 'admin' },
  { email: 'admin2@test.local', name: 'Test Admin Two', username: 'admin2', role: 'admin' },
  { email: 'admin3@test.local', name: 'Test Admin Three', username: 'admin3', role: 'admin' },
  { email: 'member1@test.local', name: 'Test Member One', username: 'member1', role: 'member' },
  { email: 'member2@test.local', name: 'Test Member Two', username: 'member2', role: 'member' },
  { email: 'member3@test.local', name: 'Test Member Three', username: 'member3', role: 'member' },
  { email: 'member4@test.local', name: 'Test Member Four', username: 'member4', role: 'member' },
  { email: 'member5@test.local', name: 'Test Member Five', username: 'member5', role: 'member' },
  {
    email: 'unclaimed@test.local',
    name: 'Test Unclaimed',
    username: null,
    role: 'member',
  },
] as const;

/**
 * Empties the test database so every run starts from a known state.
 *
 * Teardown can only delete what it knows how to find — it matches seed users by
 * `@test.local`, teams by name, and auxiliary rows by `userId` — so anything
 * keyed differently (channels by team, tickets by creator, activities at all,
 * signups like `onboard<ts>@example.com`) survived and accumulated run over
 * run. Once the database is large enough, the app slows down and time-boxed
 * waits start failing in ways that look like product bugs.
 *
 * Guarded on the database NAME rather than the caller's intent: this suite
 * shares a mongod with the dev database and MONGO_URL is overridable, so refuse
 * outright anything that isn't obviously a test database.
 */
async function resetTestDatabase(db: Db): Promise<void> {
  const name = db.databaseName;
  if (!/_test$/.test(name)) {
    throw new Error(
      `[global-setup] Refusing to reset database "${name}" — expected a name ending in "_test". ` +
        `MONGO_URL is pointing somewhere unexpected; aborting rather than risk a non-test database.`,
    );
  }

  const collections = await db.listCollections({}, { nameOnly: true }).toArray();
  let cleared = 0;
  for (const { name: collName } of collections) {
    if (collName.startsWith('system.')) continue;
    // deleteMany rather than drop: keeps indexes and validators the backend
    // built at startup, which it won't rebuild without a restart.
    cleared += (await db.collection(collName).deleteMany({})).deletedCount;
  }
  console.log(
    `[global-setup] ✔ Reset ${name} — cleared ${cleared} documents across ${collections.length} collections`,
  );
}

export default async function globalSetup(): Promise<void> {
  await waitForBackend(BACKEND_URL);

  const client = await MongoClient.connect(MONGO_URL);
  const db = client.db();

  // Set SKIP_DB_RESET=1 to keep existing data (mirrors teardown's SKIP_CLEANUP).
  if (!process.env.SKIP_DB_RESET) {
    await resetTestDatabase(db);
  }

  // Same bcrypt(sha256hex(password)) format Meteor's Accounts.setPasswordAsync
  // writes, so the Meteor login handler's Path 1 accepts it.
  const digest = createHash('sha256').update(PASSWORD).digest('hex');
  const bcryptHash = await bcrypt.hash(digest, 10);

  for (const u of SEED_USERS) {
    const existing = await db
      .collection('users')
      .findOne({ 'emails.address': u.email }, { projection: { _id: 1 } });
    const userId = existing?._id ?? new ObjectId().toHexString();
    await db.collection('users').updateOne(
      { 'emails.address': u.email },
      {
        $set: {
          emails: [{ address: u.email, verified: true }],
          profile: { name: u.name },
          'services.password.bcrypt': bcryptHash,
          image: null,
          bio: '',
          website: '',
          reportsToUserId: null,
          blocked: [],
          ...(u.username ? { username: u.username } : {}),
        },
        $setOnInsert: { _id: userId, createdAt: new Date() },
      },
      { upsert: true },
    );
    // Clear any leftover reset token
    await db
      .collection('users')
      .updateOne({ 'emails.address': u.email }, { $unset: { 'services.password.reset': '' } });
  }

  // Ensure a default organization exists with the canonical name/settings the
  // suite depends on — reset both on every run so leftover state from manual
  // dev testing (e.g. someone renaming the org via the UI) can't desync the
  // fixture from what tests assert.
  let defaultOrg = await db.collection('organizations').findOne({ slug: 'default' });
  if (!defaultOrg) {
    const orgDoc = {
      _id: new ObjectId(),
      slug: 'default',
      name: 'Default Organization',
      allowAutoJoin: true,
      owners: [] as string[],
      admins: [] as string[],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await db.collection('organizations').insertOne(orgDoc);
    defaultOrg = orgDoc;
  } else {
    await db
      .collection('organizations')
      .updateOne(
        { _id: defaultOrg._id },
        { $set: { name: 'Default Organization', allowAutoJoin: true, updatedAt: new Date() } },
      );
    defaultOrg = { ...defaultOrg, name: 'Default Organization', allowAutoJoin: true };
  }
  const orgId = defaultOrg._id.toHexString();

  // Look up user ids by email now that all users are upserted.
  const usersByEmail = new Map<string, string>();
  for (const u of SEED_USERS) {
    const doc = await db
      .collection('users')
      .findOne({ 'emails.address': u.email }, { projection: { _id: 1 } });
    if (doc) usersByEmail.set(u.email, String(doc._id));
  }

  const owners = SEED_USERS.filter((u) => u.role === 'owner').map(
    (u) => usersByEmail.get(u.email)!,
  );
  const admins = SEED_USERS.filter((u) => u.role === 'admin').map(
    (u) => usersByEmail.get(u.email)!,
  );

  await db.collection('organizations').updateOne(
    { _id: defaultOrg._id },
    {
      $addToSet: { owners: { $each: owners }, admins: { $each: admins } },
      $set: { updatedAt: new Date() },
    },
  );

  const bulk = db.collection('org_members').initializeUnorderedBulkOp();
  for (const u of SEED_USERS) {
    const userId = usersByEmail.get(u.email);
    if (!userId) continue;
    bulk
      .find({ orgId, userId })
      .upsert()
      .updateOne({ $set: { orgId, userId, role: u.role, auto: false, createdAt: new Date() } });
  }
  if (bulk.length > 0) await bulk.execute();

  // Ensure a default non-personal team exists with all seed users as members.
  const allMemberIds = [...usersByEmail.values()];
  const adminMemberIds = SEED_USERS.filter((u) => u.role === 'owner' || u.role === 'admin')
    .map((u) => usersByEmail.get(u.email)!)
    .filter(Boolean);

  let defaultTeam = await db.collection('teams').findOne({ code: 'TEST01' });
  if (!defaultTeam) {
    const teamDoc = {
      _id: new ObjectId(),
      name: 'Test Team Alpha',
      code: 'TEST01',
      orgId,
      createdBy: usersByEmail.get('owner1@test.local')!,
      members: allMemberIds,
      admins: adminMemberIds,
      isPersonal: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await db.collection('teams').insertOne(teamDoc);

    console.log(`[global-setup] ✔ Created team "${teamDoc.name}" code=${teamDoc.code}`);
  } else {
    await db
      .collection('teams')
      .updateOne(
        { _id: defaultTeam._id },
        { $set: { members: allMemberIds, admins: adminMemberIds, isPersonal: false } },
      );
  }

  // Mark enterprise as installed to prevent the InstallerModal from showing.
  // The backend's enterprise.installStatus method checks `owners` or `admins`
  // arrays (not `ownerId`) to determine hasOwner/installCompleted.
  const owner1Id = usersByEmail.get('owner1@test.local');
  if (owner1Id) {
    await db.collection('enterprises').updateOne(
      { slug: 'default-enterprise' },
      {
        $set: {
          ownerId: owner1Id,
          owners: [owner1Id],
          installCompleted: true,
          updatedAt: new Date(),
        },
        $setOnInsert: {
          _id: new ObjectId(),
          slug: 'default-enterprise',
          name: 'Default Enterprise',
          createdAt: new Date(),
        },
      },
      { upsert: true },
    );
  }

  await client.close();

  console.log(
    `[global-setup] ✔ Provisioned ${SEED_USERS.length} @test.local users in org ${orgId}`,
  );
}
