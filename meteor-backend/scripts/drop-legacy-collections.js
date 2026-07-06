#!/usr/bin/env node
/**
 * Drop legacy Better Auth collections after verifying they're no longer used
 */

import { MongoClient } from 'mongodb';

const MONGO_URL = process.env.MONGO_URL || 'mongodb://127.0.0.1:27017/timecore';

async function dropLegacyCollections() {
  const client = new MongoClient(MONGO_URL);
  
  try {
    await client.connect();
    console.log('✓ Connected to MongoDB\n');
    
    const db = client.db();
    
    console.log('=== Legacy Better Auth Collections ===\n');
    console.log('Current counts:');
    const sessionCount = await db.collection('session').countDocuments();
    const accountCount = await db.collection('account').countDocuments();
    const userCount = await db.collection('user').countDocuments();
    const verificationCount = await db.collection('verification').countDocuments();
    
    console.log(`  session: ${sessionCount}`);
    console.log(`  account: ${accountCount}`);
    console.log(`  user (Fastify): ${userCount}`);
    console.log(`  verification: ${verificationCount}\n`);
    
    const totalDocs = sessionCount + accountCount + userCount + verificationCount;
    console.log(`Total documents to be deleted: ${totalDocs}\n`);
    
    // Drop collections
    console.log('Dropping collections...');
    await db.collection('session').drop();
    console.log('  ✓ Dropped session');
    
    await db.collection('account').drop();
    console.log('  ✓ Dropped account');
    
    await db.collection('user').drop();
    console.log('  ✓ Dropped user (Fastify)');
    
    await db.collection('verification').drop();
    console.log('  ✓ Dropped verification\n');
    
    console.log('=== Collections Dropped Successfully ===');
    console.log('All legacy Better Auth collections removed!\n');
    
    // Show remaining collections
    console.log('Remaining user-related collections:');
    const collections = await db.listCollections().toArray();
    for (const coll of collections) {
      if (coll.name.match(/user|account|session|auth/i)) {
        const count = await db.collection(coll.name).countDocuments();
        console.log(`  - ${coll.name} (${count} docs)`);
      }
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await client.close();
  }
}

dropLegacyCollections();
