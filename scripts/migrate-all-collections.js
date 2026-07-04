#!/usr/bin/env node

/**
 * migrate-all-collections.js
 *
 * Copies all collections from a source MongoDB database to a target database,
 * excluding 'user' and 'account' (handled separately by migrate-to-meteor-accounts.js).
 *
 * Documents are copied as-is with no transformation, using replaceOne with upsert:true
 * keyed by _id for idempotent operation.
 *
 * Usage:
 *   SOURCE_MONGO_URL=mongodb://... TARGET_MONGO_URL=mongodb://... node scripts/migrate-all-collections.js
 *   SOURCE_MONGO_URL=mongodb://... TARGET_MONGO_URL=mongodb://... node scripts/migrate-all-collections.js --dry-run
 */

import { MongoClient } from 'mongodb';

const SOURCE_MONGO_URL = process.env.SOURCE_MONGO_URL || 'mongodb://127.0.0.1:27017/staging_prod';
const TARGET_MONGO_URL = process.env.TARGET_MONGO_URL || 'mongodb://127.0.0.1:27017/timehuddle';
const DRY_RUN = process.argv.includes('--dry-run');

// Collections to exclude (handled by separate migration script)
const EXCLUDED_COLLECTIONS = ['user', 'account'];

async function main() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Collection Migration Tool');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`Source:  ${SOURCE_MONGO_URL}`);
  console.log(`Target:  ${TARGET_MONGO_URL}`);
  console.log(`Mode:    ${DRY_RUN ? '🔍 DRY RUN' : '✅ LIVE'}`);
  console.log(`Exclude: ${EXCLUDED_COLLECTIONS.join(', ')}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const sourceClient = new MongoClient(SOURCE_MONGO_URL);
  const targetClient = new MongoClient(TARGET_MONGO_URL);

  try {
    await sourceClient.connect();
    await targetClient.connect();

    const sourceDb = sourceClient.db();
    const targetDb = targetClient.db();

    // List all collections in source database
    const collections = await sourceDb.listCollections().toArray();
    const collectionNames = collections
      .map((c) => c.name)
      .filter((name) => !EXCLUDED_COLLECTIONS.includes(name))
      .sort();

    if (collectionNames.length === 0) {
      console.log('⚠️  No collections to migrate (all excluded or database empty).\n');
      return;
    }

    console.log(`Found ${collectionNames.length} collection(s) to migrate:\n`);

    const results = [];

    for (const collectionName of collectionNames) {
      try {
        const sourceColl = sourceDb.collection(collectionName);
        const targetColl = targetDb.collection(collectionName);

        // Get source document count
        const sourceCount = await sourceColl.countDocuments();

        if (sourceCount === 0) {
          console.log(`⊘  ${collectionName}: empty, skipping`);
          results.push({
            collection: collectionName,
            sourceCount: 0,
            preExistingCount: 0,
            targetCount: 0,
            status: 'skipped (empty)',
          });
          continue;
        }

        // Get pre-existing target count (for collision detection)
        const preExistingCount = await targetColl.countDocuments();

        if (DRY_RUN) {
          console.log(`🔍 ${collectionName}: ${sourceCount} document(s) would be copied`);
          results.push({
            collection: collectionName,
            sourceCount,
            preExistingCount,
            targetCount: preExistingCount,
            status: 'dry-run',
          });
          continue;
        }

        // Live migration: copy all documents
        console.log(`⏳ ${collectionName}: copying ${sourceCount} document(s)...`);

        const cursor = sourceColl.find({});
        let copied = 0;

        while (await cursor.hasNext()) {
          const doc = await cursor.next();
          await targetColl.replaceOne(
            { _id: doc._id },
            doc,
            { upsert: true }
          );
          copied++;

          // Progress indicator for large collections
          if (copied % 1000 === 0) {
            process.stdout.write(`  ${copied}/${sourceCount}...\r`);
          }
        }

        const targetCount = await targetColl.countDocuments();
        console.log(`✅ ${collectionName}: ${copied} document(s) copied`);

        results.push({
          collection: collectionName,
          sourceCount,
          preExistingCount,
          targetCount,
          status: 'success',
        });
      } catch (err) {
        console.error(`❌ ${collectionName}: migration failed`);
        console.error(`   Error: ${err.message}`);
        results.push({
          collection: collectionName,
          sourceCount: 0,
          preExistingCount: 0,
          targetCount: 0,
          status: `error: ${err.message}`,
        });
      }
    }

    // Print summary table
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  Migration Summary');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Calculate column widths
    const maxNameWidth = Math.max(
      'Collection'.length,
      ...results.map((r) => r.collection.length)
    );

    // Table header
    console.log(
      'Collection'.padEnd(maxNameWidth + 2) +
      'Source'.padEnd(10) +
      'Pre-Existing'.padEnd(15) +
      'Target'.padEnd(10) +
      'Status'
    );
    console.log('─'.repeat(maxNameWidth + 2 + 10 + 15 + 10 + 20));

    // Table rows
    for (const result of results) {
      const preExistingFlag = result.preExistingCount > 0 ? '⚠️ ' : '';
      console.log(
        result.collection.padEnd(maxNameWidth + 2) +
        result.sourceCount.toString().padEnd(10) +
        `${preExistingFlag}${result.preExistingCount}`.padEnd(15) +
        result.targetCount.toString().padEnd(10) +
        result.status
      );
    }

    // Collision warnings
    const collisions = results.filter((r) => r.preExistingCount > 0);
    if (collisions.length > 0) {
      console.log('\n⚠️  Pre-existing documents detected in:');
      for (const collision of collisions) {
        console.log(`   • ${collision.collection}: ${collision.preExistingCount} existing document(s)`);
      }
      console.log('   (These may have been overwritten or merged with source data)');
    }

    // Final stats
    const totalSource = results.reduce((sum, r) => sum + r.sourceCount, 0);
    const totalTarget = results.reduce((sum, r) => sum + r.targetCount, 0);
    const successCount = results.filter((r) => r.status === 'success').length;
    const errorCount = results.filter((r) => r.status.startsWith('error')).length;

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`Total source documents:     ${totalSource}`);
    console.log(`Total target documents:     ${totalTarget}`);
    console.log(`Collections processed:      ${successCount} success, ${errorCount} error`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    if (DRY_RUN) {
      console.log('🔍 Dry run complete. Run without --dry-run to perform migration.');
    } else {
      console.log('✅ Migration complete!');
    }
  } finally {
    await sourceClient.close();
    await targetClient.close();
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
