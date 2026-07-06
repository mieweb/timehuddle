// One-shot: reset passwords for all @test.local seed users to TestPass1!
// Uses DDP against a running Meteor to invoke Accounts.setPasswordAsync via a
// temporary server method (we call a small custom bootstrap method).
// Simpler: talk to Mongo directly and write the same bcrypt(sha256hex) that
// Accounts.setPasswordAsync writes.
import { MongoClient } from 'mongodb';
import bcrypt from 'bcrypt';
import crypto from 'crypto';

const uri = process.env.MONGO_URL || 'mongodb://127.0.0.1:27017/timehuddle?directConnection=true';
const PASSWORD = process.env.TEST_PASSWORD || 'TestPass1!';

const client = new MongoClient(uri);
await client.connect();
const db = client.db();
const users = db.collection('users');

const digest = crypto.createHash('sha256').update(PASSWORD).digest('hex');
const hash = await bcrypt.hash(digest, 10);

const filter = { 'emails.address': /@test\.local$/ };
const result = await users.updateMany(filter, {
  $set: { 'services.password.bcrypt': hash },
  $unset: { 'services.password.reset': '' },
});
const list = await users.find(filter, { projection: { emails: 1 } }).toArray();
console.log(`Updated ${result.modifiedCount} users to password '${PASSWORD}':`);
for (const u of list) console.log('  -', u.emails?.[0]?.address);

// Ensure @test.local users are wired into the Default Organization with proper
// roles. This is required for /app/org/members tests to pass because those
// pages hide the members table when the caller cannot manage the org.
const defaultOrg = await db.collection('organizations').findOne({ slug: 'default' });
if (!defaultOrg) {
  console.warn("⚠️  No 'default' organization found — org membership fixup skipped.");
} else {
  const orgId = defaultOrg._id.toHexString();
  const ownerIds = list
    .filter((u) => u.emails?.[0]?.address?.startsWith('owner'))
    .map((u) => String(u._id));
  const adminIds = list
    .filter((u) => u.emails?.[0]?.address?.startsWith('admin'))
    .map((u) => String(u._id));
  const memberIds = list
    .filter((u) => u.emails?.[0]?.address?.match(/^(member|unclaimed)/))
    .map((u) => String(u._id));

  await db.collection('organizations').updateOne(
    { _id: defaultOrg._id },
    {
      $addToSet: { owners: { $each: ownerIds }, admins: { $each: adminIds } },
      $set: { updatedAt: new Date() },
    },
  );

  const bulk = db.collection('org_members').initializeUnorderedBulkOp();
  for (const userId of ownerIds) {
    bulk
      .find({ orgId, userId })
      .upsert()
      .updateOne({ $set: { orgId, userId, role: 'owner', auto: false } });
  }
  for (const userId of adminIds) {
    bulk
      .find({ orgId, userId })
      .upsert()
      .updateOne({ $set: { orgId, userId, role: 'admin', auto: false } });
  }
  for (const userId of memberIds) {
    bulk
      .find({ orgId, userId })
      .upsert()
      .updateOne({ $set: { orgId, userId, role: 'member', auto: false } });
  }
  if (bulk.length > 0) await bulk.execute();

  console.log(
    `Fixed default org (${orgId}) membership: ${ownerIds.length} owners, ${adminIds.length} admins, ${memberIds.length} members`,
  );
}

await client.close();
