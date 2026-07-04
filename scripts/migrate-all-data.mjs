#!/usr/bin/env node
/**
 * Migrate ALL collections from staging_prod → timehuddle
 * This copies organizations, teams, tickets, and all other application data
 */

import { MongoClient } from 'mongodb';

const SOURCE_URI = 'mongodb://127.0.0.1:27017/staging_prod';
const TARGET_URI = 'mongodb://127.0.0.1:27017/timehuddle';

// Collections to migrate (excluding user/account which are handled by migrate-to-meteor-accounts.js)
const COLLECTIONS_TO_MIGRATE = [
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

async function main() {
  console.log('🚀 Starting full data migration: staging_prod → timehuddle\n');
  
  const sourceClient = new MongoClient(SOURCE_URI);
  const targetClient = new MongoClient(TARGET_URI);
  
  try {
    await sourceClient.connect();
    await targetClient.connect();
    
    const sourceDb = sourceClient.db();
    const targetDb = targetClient.db();
    
    let totalMigrated = 0;
    
    for (const collectionName of COLLECTIONS_TO_MIGRATE) {
      const sourceCollection = sourceDb.collection(collectionName);
      const targetCollection = targetDb.collection(collectionName);
      
      const count = await sourceCollection.countDocuments();
      
      if (count === 0) {
        console.log(`⏭️  ${collectionName}: 0 documents, skipping`);
        continue;
      }
      
      // Drop target collection if it exists (clean migration)
      await targetCollection.drop().catch(() => {});
      
      // Copy all documents
      const docs = await sourceCollection.find({}).toArray();
      if (docs.length > 0) {
        await targetCollection.insertMany(docs);
        totalMigrated += docs.length;
        console.log(`✅ ${collectionName}: ${docs.length} documents migrated`);
      }
    }
    
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`📋 MIGRATION SUMMARY:`);
    console.log(`   ✅ Total documents migrated: ${totalMigrated}`);
    console.log(`   📦 Collections migrated: ${COLLECTIONS_TO_MIGRATE.length}`);
    console.log(`\n✅ Migration complete!`);
    
  } finally {
    await sourceClient.close();
    await targetClient.close();
  }
}

main().catch(console.error);
