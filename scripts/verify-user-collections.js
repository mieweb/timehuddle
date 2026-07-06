import { MongoClient } from 'mongodb';

const MONGO_URL = process.env.MONGO_URL || 'mongodb://127.0.0.1:27017/timehuddle';

async function verifyCollections() {
  console.log('🔍 Verifying user collections...\n');

  const client = await MongoClient.connect(MONGO_URL);
  const db = client.db();

  // Count documents
  const userCount = await db.collection('user').countDocuments();
  const usersCount = await db.collection('users').countDocuments();

  console.log(`📊 Document Counts:`);
  console.log(`   'user' collection (Better Auth): ${userCount}`);
  console.log(`   'users' collection (Meteor):     ${usersCount}\n`);

  // Get all users from both collections
  const betterAuthUsers = await db.collection('user').find({}).toArray();
  const meteorUsers = await db.collection('users').find({}).toArray();

  // Create email maps for comparison
  const betterAuthEmails = new Map();
  const meteorEmails = new Map();

  for (const user of betterAuthUsers) {
    if (user.email) {
      betterAuthEmails.set(user.email.toLowerCase(), user);
    }
  }

  for (const user of meteorUsers) {
    const email = user.emails?.[0]?.address;
    if (email) {
      meteorEmails.set(email.toLowerCase(), user);
    }
  }

  console.log(`📧 Unique Emails:`);
  console.log(`   'user' collection:  ${betterAuthEmails.size}`);
  console.log(`   'users' collection: ${meteorEmails.size}\n`);

  // Find users in 'user' but NOT in 'users'
  const missingInMeteor = [];
  for (const [email, user] of betterAuthEmails.entries()) {
    if (!meteorEmails.has(email)) {
      missingInMeteor.push({ email, _id: user._id, name: user.name });
    }
  }

  // Find users in 'users' but NOT in 'user'
  const missingInBetterAuth = [];
  for (const [email, user] of meteorEmails.entries()) {
    if (!betterAuthEmails.has(email)) {
      missingInBetterAuth.push({ email, _id: user._id, name: user.profile?.name });
    }
  }

  console.log(`⚠️  Users in 'user' but NOT in 'users': ${missingInMeteor.length}`);
  if (missingInMeteor.length > 0) {
    console.log(`   These users need to be migrated:\n`);
    missingInMeteor.forEach((u) => {
      console.log(`   - ${u.email} (${u.name || 'No name'}) [ID: ${u._id}]`);
    });
    console.log();
  }

  console.log(`ℹ️  Users in 'users' but NOT in 'user': ${missingInBetterAuth.length}`);
  if (missingInBetterAuth.length > 0) {
    console.log(`   These are Meteor-only users (OK):\n`);
    missingInBetterAuth.slice(0, 5).forEach((u) => {
      console.log(`   - ${u.email} (${u.name || 'No name'}) [ID: ${u._id}]`);
    });
    if (missingInBetterAuth.length > 5) {
      console.log(`   ... and ${missingInBetterAuth.length - 5} more`);
    }
    console.log();
  }

  // Check for duplicates (same email in both collections)
  const duplicates = [];
  for (const [email] of betterAuthEmails.entries()) {
    if (meteorEmails.has(email)) {
      duplicates.push(email);
    }
  }

  console.log(`🔄 Users in BOTH collections: ${duplicates.length}`);
  if (duplicates.length > 0) {
    console.log(`   These users exist in both (dual records):\n`);
    duplicates.slice(0, 5).forEach((email) => {
      console.log(`   - ${email}`);
    });
    if (duplicates.length > 5) {
      console.log(`   ... and ${duplicates.length - 5} more`);
    }
    console.log();
  }

  // Summary
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📋 SUMMARY:\n');

  if (missingInMeteor.length === 0) {
    console.log('✅ All users from "user" collection exist in "users" collection');
    console.log('✅ Safe to remove "user" collection queries from code\n');
  } else {
    console.log(`❌ ${missingInMeteor.length} users in "user" are MISSING from "users"`);
    console.log('⚠️  YOU MUST MIGRATE THESE USERS BEFORE REMOVING "user" QUERIES\n');
  }

  if (missingInBetterAuth.length > 0) {
    console.log(
      `ℹ️  ${missingInBetterAuth.length} users only exist in "users" collection (Meteor-only users)`,
    );
    console.log('   This is expected if you have test users or old Meteor accounts\n');
  }

  await client.close();
}

verifyCollections().catch(console.error);
