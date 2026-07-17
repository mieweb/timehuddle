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
import { MongoClient, ObjectId } from 'mongodb';
import bcrypt from 'bcrypt';
import { createHash } from 'crypto';

const MONGO_URL =
  process.env.MONGO_URL ?? 'mongodb://127.0.0.1:27017/timehuddle_test?replicaSet=rs0';
const PASSWORD = 'TestPass1!';

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

export default async function globalSetup(): Promise<void> {
  const client = await MongoClient.connect(MONGO_URL);
  const db = client.db();

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

  // Ensure a default organization exists.
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
