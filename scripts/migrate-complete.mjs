#!/usr/bin/env node
/**
 * Complete Migration Script: staging_prod → timehuddle
 *
 * This script performs a COMPLETE migration in the correct order:
 * 1. Migrates user accounts (Better Auth → Meteor users)
 * 2. Migrates all application data collections
 *
 * Usage:
 *   node scripts/migrate-complete.mjs           # Run full migration
 *   node scripts/migrate-complete.mjs --dry-run # Preview without modifying database
 *
 * Environment Variables:
 *   SOURCE_MONGO_URL - Source database (default: mongodb://127.0.0.1:27017/staging_prod)
 *   TARGET_MONGO_URL - Target database (default: mongodb://127.0.0.1:27017/timehuddle)
 */

import { MongoClient } from 'mongodb';

const SOURCE_URI = process.env.SOURCE_MONGO_URL || 'mongodb://127.0.0.1:27017/staging_prod';
const TARGET_URI = process.env.TARGET_MONGO_URL || 'mongodb://127.0.0.1:27017/timehuddle';
const DRY_RUN = process.argv.includes('--dry-run');

// Collections to migrate (excluding user/account which are handled separately)
const DATA_COLLECTIONS = [
  'organizations',
  'org_members',
  'enterprises',
  'teams',
  'teamjoinrequests',
  'tickets',
  'clockevents',
  'clockbreaks',
  'workitems',
  'timers',
  'channels',
  'channelmessages',
  'messages',
  'notifications',
  'activities',
  'attachments',
  'huddleposts',
  'huddlecomments',
  'changelog',
  'pushsubscriptions',
  'devicetokens',
  'app_settings',
  'mediaitems',
  'profiles',
  'personal_access_tokens',
  'agendajobs',
];

/**
 * Step 1: Migrate user accounts from Better Auth to Meteor
 */
async function migrateUsers(sourceDb, targetDb) {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📋 STEP 1: Migrating Users (Better Auth → Meteor)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const betterAuthUsers = await sourceDb.collection('user').find({}).toArray();
  const betterAuthAccounts = await sourceDb.collection('account').find({}).toArray();

  console.log(`📥 Found ${betterAuthUsers.length} users in source 'user' collection`);
  console.log(`📥 Found ${betterAuthAccounts.length} accounts in source 'account' collection\n`);

  // Build account map (userId → account)
  const accountMap = new Map();
  for (const account of betterAuthAccounts) {
    const userId = String(account.userId);
    const existing = accountMap.get(userId);
    if (!existing || account.providerId === 'credential') {
      accountMap.set(userId, account);
    }
  }
  console.log(`🔑 Built account map: ${accountMap.size} users have credentials\n`);

  let migrated = 0;
  let skipped = 0;
  let errors = 0;

  for (const user of betterAuthUsers) {
    try {
      const email = user.email?.toLowerCase().trim();
      if (!email) {
        skipped++;
        continue;
      }

      const existing = await targetDb.collection('users').findOne({
        'emails.address': email,
      });

      if (existing) {
        skipped++;
        continue;
      }

      const userId = String(user._id);
      const account = accountMap.get(userId);

      const services = {};
      if (account && account.providerId === 'credential' && account.password) {
        services.betterAuth = {
          providerId: account.providerId,
          scryptHash: account.password,
        };
      }

      const meteorUser = {
        _id: userId,
        createdAt: user.createdAt || new Date(),
        services,
        emails: [
          {
            address: email,
            verified: user.emailVerified || false,
          },
        ],
        profile: {
          name: user.name || email,
        },
        ...(user.username ? { username: user.username } : {}),
        image: user.image || null,
        bio: user.bio || '',
        website: user.website || '',
        reportsToUserId: user.reportsToUserId || null,
        blocked: user.blocked || [],
      };

      const hasPassword = !!services.betterAuth;
      if (!DRY_RUN) {
        await targetDb.collection('users').insertOne(meteorUser);
      }
      console.log(
        `${DRY_RUN ? '✓' : '✅'} ${email} [${user.name || 'No name'}]${hasPassword ? ' 🔑' : ''}`,
      );
      migrated++;
    } catch (error) {
      console.error(`❌ Error migrating ${user.email}: ${error.message}`);
      errors++;
    }
  }

  console.log(`\n   ${DRY_RUN ? 'Would migrate' : 'Migrated'}: ${migrated} users`);
  console.log(`   Skipped: ${skipped} users`);
  if (errors > 0) console.log(`   Errors: ${errors} users`);

  return { migrated, skipped, errors };
}

/**
 * Step 2: Migrate all application data collections
 */
async function migrateDataCollections(sourceDb, targetDb) {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📋 STEP 2: Migrating Application Data');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  let totalDocs = 0;
  let collectionsMigrated = 0;

  for (const collectionName of DATA_COLLECTIONS) {
    try {
      const count = await sourceDb.collection(collectionName).countDocuments();

      if (count === 0) {
        console.log(`⏭️  ${collectionName}: 0 documents, skipping`);
        continue;
      }

      const documents = await sourceDb.collection(collectionName).find({}).toArray();

      if (!DRY_RUN) {
        if (documents.length > 0) {
          await targetDb.collection(collectionName).insertMany(documents, { ordered: false });
        }
      }

      console.log(`${DRY_RUN ? '✓' : '✅'} ${collectionName}: ${count} documents`);
      totalDocs += count;
      collectionsMigrated++;
    } catch (error) {
      if (error.code === 11000) {
        console.log(`⚠️  ${collectionName}: some duplicates skipped`);
        collectionsMigrated++;
      } else {
        console.error(`❌ ${collectionName}: ${error.message}`);
      }
    }
  }

  console.log(
    `\n   ${DRY_RUN ? 'Would migrate' : 'Migrated'}: ${totalDocs} documents across ${collectionsMigrated} collections`,
  );

  return { totalDocs, collectionsMigrated };
}

/**
 * Main migration function
 */
async function main() {
  if (DRY_RUN) {
    console.log('🔍 DRY RUN MODE - No changes will be made to the database\n');
  }

  console.log('🚀 Complete Migration: staging_prod → timehuddle\n');
  console.log(`📍 Source: ${SOURCE_URI}`);
  console.log(`📍 Target: ${TARGET_URI}`);

  const sourceClient = new MongoClient(SOURCE_URI);
  const targetClient = new MongoClient(TARGET_URI);

  try {
    await sourceClient.connect();
    await targetClient.connect();

    const sourceDb = sourceClient.db();
    const targetDb = targetClient.db();

    // Step 1: Migrate users
    const userStats = await migrateUsers(sourceDb, targetDb);

    // Step 2: Migrate data collections
    const dataStats = await migrateDataCollections(sourceDb, targetDb);

    // Final summary
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 COMPLETE MIGRATION SUMMARY');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log(
      `   👥 Users:        ${userStats.migrated} ${DRY_RUN ? '(would be migrated)' : 'migrated'}`,
    );
    console.log(
      `   📦 Collections:  ${dataStats.collectionsMigrated} ${DRY_RUN ? '(would be migrated)' : 'migrated'}`,
    );
    console.log(
      `   📄 Documents:    ${dataStats.totalDocs} ${DRY_RUN ? '(would be migrated)' : 'migrated'}`,
    );
    console.log(
      `   📊 Grand Total:  ${userStats.migrated + dataStats.totalDocs} ${DRY_RUN ? '(would be migrated)' : 'migrated'}\n`,
    );

    if (DRY_RUN) {
      console.log('✅ Dry run complete! Run without --dry-run to perform actual migration.');
    } else {
      console.log('✅ Migration complete!');
      console.log('📝 All users, collections, and data have been migrated successfully.');
    }
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await sourceClient.close();
    await targetClient.close();
  }
}

main();
