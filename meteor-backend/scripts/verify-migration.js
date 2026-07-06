#!/usr/bin/env node
/**
 * Verify migration is complete before dropping legacy collections
 */

import { MongoClient } from 'mongodb';

const MONGO_URL = process.env.MONGO_URL || 'mongodb://127.0.0.1:27017/timecore';

async function verifyMigration() {
  const client = new MongoClient(MONGO_URL);
  
  try {
    await client.connect();
    console.log('✓ Connected to MongoDB\n');
    
    const db = client.db();
    
    console.log('=== Pre-Drop Migration Verification ===\n');
    
    // 1. Collection counts
    const fastifyCount = await db.collection('user').countDocuments();
    const meteorCount = await db.collection('users').countDocuments();
    
    console.log('1. Collection Counts:');
    console.log(`   Fastify user: ${fastifyCount}`);
    console.log(`   Meteor users: ${meteorCount}\n`);
    
    // 2. Check all Fastify users are in Meteor
    console.log('2. Cross-reference Fastify → Meteor:');
    const fastifyUsers = await db.collection('user').find({}, { projection: { email: 1 } }).toArray();
    const meteorUsers = await db.collection('users').find({}, { projection: { emails: 1 } }).toArray();
    
    const meteorEmails = new Set(
      meteorUsers.flatMap(u => (u.emails || []).map(e => e.address))
    );
    
    let allMigrated = true;
    let missingCount = 0;
    
    for (const user of fastifyUsers) {
      if (user.email && !meteorEmails.has(user.email)) {
        console.log(`   ⚠️  MISSING: ${user.email}`);
        allMigrated = false;
        missingCount++;
      }
    }
    
    if (allMigrated) {
      console.log(`   ✅ All ${fastifyUsers.length} Fastify users exist in Meteor users`);
    } else {
      console.log(`   ❌ ${missingCount} users NOT migrated!`);
    }
    console.log('');
    
    // 3. Password status
    console.log('3. Password Status:');
    const withBcrypt = await db.collection('users').countDocuments({ 
      'services.password.bcrypt': { $exists: true } 
    });
    const withScrypt = await db.collection('users').countDocuments({ 
      'services.betterAuth': { $exists: true } 
    });
    const noPassword = await db.collection('users').countDocuments({ 
      'services.password.bcrypt': { $exists: false },
      'services.betterAuth': { $exists: false }
    });
    
    console.log(`   Users with bcrypt: ${withBcrypt}`);
    console.log(`   Users with scrypt: ${withScrypt}`);
    console.log(`   Users with NO password: ${noPassword}`);
    
    const expectedNoPassword = meteorCount;
    if (noPassword === expectedNoPassword && withBcrypt === 0 && withScrypt === 0) {
      console.log('   ✅ All users have NO passwords (password reset required)');
    } else {
      console.log('   ⚠️  Password migration incomplete');
    }
    console.log('');
    
    // 4. Legacy collections to drop
    console.log('4. Legacy Collections to Drop:');
    const sessionCount = await db.collection('session').countDocuments();
    const accountCount = await db.collection('account').countDocuments();
    const verificationCount = await db.collection('verification').countDocuments();
    
    console.log(`   session: ${sessionCount} documents`);
    console.log(`   account: ${accountCount} documents`);
    console.log(`   user (Fastify): ${fastifyCount} documents`);
    console.log(`   verification: ${verificationCount} documents`);
    console.log(`   Total: ${sessionCount + accountCount + fastifyCount + verificationCount} documents to delete\n`);
    
    // Final verdict
    console.log('=== Final Verdict ===\n');
    
    if (allMigrated && noPassword === meteorCount) {
      console.log('✅ SAFE TO DROP: Migration verified complete');
      console.log('');
      console.log('All users migrated, no passwords set (password reset flow ready)');
      console.log('');
      console.log('To drop legacy collections, run:');
      console.log('  node scripts/drop-legacy-collections.js');
      return 0;
    } else {
      console.log('❌ NOT SAFE TO DROP: Issues found above');
      console.log('');
      if (!allMigrated) {
        console.log('  → Some Fastify users not in Meteor collection');
      }
      if (noPassword !== meteorCount) {
        console.log('  → Password migration incomplete');
      }
      return 1;
    }
    
  } catch (error) {
    console.error('❌ Verification failed:', error.message);
    return 1;
  } finally {
    await client.close();
  }
}

verifyMigration().then(code => process.exit(code));
