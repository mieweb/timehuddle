#!/usr/bin/env node
/**
 * Re-migrate users from Better Auth (user) to Meteor Accounts (users)
 * All users will have NO passwords and must reset on first login
 */

import { MongoClient } from 'mongodb';

const MONGO_URL = process.env.MONGO_URL || 'mongodb://127.0.0.1:27017/timecore';

async function remigrate() {
  const client = new MongoClient(MONGO_URL);
  
  try {
    await client.connect();
    console.log('✓ Connected to MongoDB\n');
    
    const db = client.db();
    
    // Step 1: Clear existing Meteor users
    console.log('=== Step 1: Clearing Meteor users collection ===');
    const deleteResult = await db.collection('users').deleteMany({});
    console.log(`Deleted ${deleteResult.deletedCount} users\n`);
    
    // Step 2: Get all Fastify users
    console.log('=== Step 2: Migrating from Fastify user collection ===');
    const fastifyUsers = await db.collection('user').find({}).toArray();
    console.log(`Found ${fastifyUsers.length} users in Fastify collection\n`);
    
    let migratedCount = 0;
    let skippedCount = 0;
    
    for (const betterAuthUser of fastifyUsers) {
      const email = betterAuthUser.email;
      if (!email) {
        console.log(`⚠️  Skipping user with no email: ${betterAuthUser._id}`);
        skippedCount++;
        continue;
      }
      
      // Convert Better Auth user to Meteor format
      const meteorUser = {
        _id: betterAuthUser._id.toString(),
        emails: [{ 
          address: email.toLowerCase().trim(), 
          verified: betterAuthUser.emailVerified || false 
        }],
        profile: { 
          name: betterAuthUser.name || email.split('@')[0] 
        },
        services: {
          // NO password - users must reset via email
        },
        createdAt: betterAuthUser.createdAt || new Date()
      };
      
      // Preserve custom fields
      if (betterAuthUser.username) meteorUser.username = betterAuthUser.username;
      if (betterAuthUser.image) meteorUser.image = betterAuthUser.image;
      if (betterAuthUser.bio) meteorUser.bio = betterAuthUser.bio;
      if (betterAuthUser.website) meteorUser.website = betterAuthUser.website;
      if (betterAuthUser.reportsToUserId) {
        meteorUser.reportsToUserId = betterAuthUser.reportsToUserId;
      }
      if (betterAuthUser.blocked) meteorUser.blocked = betterAuthUser.blocked;
      
      // Insert into Meteor users collection
      try {
        await db.collection('users').insertOne(meteorUser);
        migratedCount++;
        console.log(`✓ Migrated: ${email}`);
      } catch (err) {
        console.error(`❌ Error migrating user ${email}: ${err.message}`);
        skippedCount++;
      }
    }
    
    console.log('\n=== Migration Complete ===');
    console.log(`✅ Migrated: ${migratedCount} users`);
    if (skippedCount > 0) {
      console.log(`⚠️  Skipped: ${skippedCount} users`);
    }
    console.log('\n✅ All users will need to reset their passwords on next login\n');
    
    // Verify
    const finalCount = await db.collection('users').countDocuments();
    console.log(`Final Meteor users count: ${finalCount}`);
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await client.close();
  }
}

remigrate();
