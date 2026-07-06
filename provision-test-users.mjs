import { MongoClient, ObjectId } from 'mongodb';
import bcrypt from 'bcrypt';
import { createHash } from 'crypto';

const MONGO_URL = 'mongodb://127.0.0.1:27017/timehuddle?directConnection=true';
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
  { email: 'unclaimed@test.local', name: 'Test Unclaimed', username: null, role: 'member' },
];

const client = await MongoClient.connect(MONGO_URL);
const db = client.db();

const digest = createHash('sha256').update(PASSWORD).digest('hex');
const bcryptHash = await bcrypt.hash(digest, 10);

console.log('Provisioning test users...');
for (const u of SEED_USERS) {
  const existing = await db.collection('users').findOne({ 'emails.address': u.email });
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

  await db
    .collection('users')
    .updateOne({ 'emails.address': u.email }, { $unset: { 'services.password.reset': '' } });
  console.log(`  ✔ ${u.email} → username: ${u.username || 'NULL'}`);
}

// Ensure default organization exists
let defaultOrg = await db.collection('organizations').findOne({ slug: 'default' });
if (!defaultOrg) {
  const orgDoc = {
    _id: new ObjectId(),
    slug: 'default',
    name: 'Default Organization',
    allowAutoJoin: true,
    owners: [],
    admins: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  await db.collection('organizations').insertOne(orgDoc);
  defaultOrg = orgDoc;
  console.log('  ✔ Created default organization');
}

const orgId = defaultOrg._id.toHexString();

// Get user IDs
const usersByEmail = new Map();
for (const u of SEED_USERS) {
  const doc = await db.collection('users').findOne({ 'emails.address': u.email });
  if (doc) usersByEmail.set(u.email, String(doc._id));
}

// Update org owners and admins
const owners = SEED_USERS.filter((u) => u.role === 'owner').map((u) => usersByEmail.get(u.email));
const admins = SEED_USERS.filter((u) => u.role === 'admin').map((u) => usersByEmail.get(u.email));

await db.collection('organizations').updateOne(
  { _id: defaultOrg._id },
  {
    $addToSet: { owners: { $each: owners }, admins: { $each: admins } },
    $set: { updatedAt: new Date() },
  },
);
console.log('  ✔ Updated organization owners and admins');

// Create org_members
const bulk = db.collection('org_members').initializeUnorderedBulkOp();
for (const u of SEED_USERS) {
  const userId = usersByEmail.get(u.email);
  if (!userId) continue;
  bulk
    .find({ orgId, userId })
    .upsert()
    .updateOne({
      $set: { orgId, userId, role: u.role, auto: false, createdAt: new Date() },
    });
}
if (bulk.length > 0) {
  await bulk.execute();
  console.log('  ✔ Created org_members entries');
}

// Create default team
const allMemberIds = [...usersByEmail.values()];
const adminMemberIds = SEED_USERS.filter((u) => u.role === 'owner' || u.role === 'admin')
  .map((u) => usersByEmail.get(u.email))
  .filter(Boolean);

let defaultTeam = await db.collection('teams').findOne({ code: 'TEST01' });
if (!defaultTeam) {
  const teamDoc = {
    _id: new ObjectId(),
    name: 'Test Team Alpha',
    code: 'TEST01',
    orgId,
    createdBy: usersByEmail.get('owner1@test.local'),
    members: allMemberIds,
    admins: adminMemberIds,
    isPersonal: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  await db.collection('teams').insertOne(teamDoc);
  console.log(`  ✔ Created team "${teamDoc.name}" (code: ${teamDoc.code})`);
} else {
  await db
    .collection('teams')
    .updateOne(
      { _id: defaultTeam._id },
      { $set: { members: allMemberIds, admins: adminMemberIds, isPersonal: false } },
    );
  console.log('  ✔ Updated existing test team');
}

// Mark enterprise as installed
const owner1Id = usersByEmail.get('owner1@test.local');
if (owner1Id) {
  await db.collection('enterprises').updateOne(
    { slug: 'default-enterprise' },
    {
      $set: {
        ownerId: owner1Id,
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
  console.log('  ✔ Marked enterprise as installed');
}

await client.close();
console.log(`\n✅ Provisioned ${SEED_USERS.length} @test.local users in org ${orgId}`);
