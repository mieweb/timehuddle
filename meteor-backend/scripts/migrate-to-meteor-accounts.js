import { MongoClient } from 'mongodb';
import crypto from 'crypto';

const MONGO_URL = process.env.MONGO_URL || 'mongodb://127.0.0.1:27017/timehuddle';

/**
 * Migration Script: Better Auth ('user') → Meteor Accounts ('users')
 * 
 * This script:
 * 1. Copies all users from 'user' collection to 'users' collection
 * 2. Converts Better Auth schema to Meteor Accounts schema
 * 3. Preserves user data (email, name, username, image, bio, etc.)
 * 4. Users will need to reset passwords (can't decrypt Better Auth passwords)
 */
async function migrateUsers() {
  console.log('🚀 Starting migration: Better Auth → Meteor Accounts\n');
  
  const client = await MongoClient.connect(MONGO_URL);
  const db = client.db();
  
  // Get all users from Better Auth collection
  const betterAuthUsers = await db.collection('user').find({}).toArray();
  console.log(`📥 Found ${betterAuthUsers.length} users in 'user' collection\n`);
  
  let migrated = 0;
  let skipped = 0;
  let errors = 0;
  
  for (const user of betterAuthUsers) {
    try {
      const email = user.email?.toLowerCase().trim();
      if (!email) {
        console.log(`⏭️  Skipping user ${user._id} (no email)`);
        skipped++;
        continue;
      }
      
      // Check if user already exists in Meteor collection
      const existing = await db.collection('users').findOne({ 
        'emails.address': email 
      });
      
      if (existing) {
        console.log(`⏭️  Skipping ${email} (already exists)`);
        skipped++;
        continue;
      }
      
      // Convert to Meteor Accounts schema
      const meteorUser = {
        _id: String(user._id), // Meteor uses string IDs
        createdAt: user.createdAt || new Date(),
        services: {}, // Empty - users must reset password
        emails: [{
          address: email,
          verified: user.emailVerified || false
        }],
        profile: {
          name: user.name || email
        },
        // Custom fields preserved from Better Auth
        // Only set username if not null (Meteor has unique constraint)
        ...(user.username ? { username: user.username } : {}),
        image: user.image || null,
        bio: user.bio || '',
        website: user.website || '',
        reportsToUserId: user.reportsToUserId || null,
        // Preserve blocked array if exists
        blocked: user.blocked || []
      };
      
      await db.collection('users').insertOne(meteorUser);
      console.log(`✅ Migrated: ${email} [${user.name || 'No name'}]`);
      migrated++;
      
    } catch (error) {
      console.error(`❌ Error migrating ${user.email}: ${error.message}`);
      errors++;
    }
  }
  
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📋 MIGRATION SUMMARY:\n');
  console.log(`   ✅ Migrated: ${migrated} users`);
  console.log(`   ⏭️  Skipped:  ${skipped} users (already exist)`);
  console.log(`   ❌ Errors:   ${errors} users\n`);
  
  // Verify final counts
  const finalUserCount = await db.collection('user').countDocuments();
  const finalUsersCount = await db.collection('users').countDocuments();
  
  console.log('📊 Final Counts:');
  console.log(`   'user' collection:  ${finalUserCount}`);
  console.log(`   'users' collection: ${finalUsersCount}\n`);
  
  if (migrated > 0) {
    console.log('✅ Migration complete!');
    console.log('\n⚠️  IMPORTANT: All users must reset their passwords');
    console.log('   You can send password reset emails using Meteor\'s Accounts.sendResetPasswordEmail()\n');
  } else {
    console.log('ℹ️  No users were migrated (all already exist)\n');
  }
  
  await client.close();
}

migrateUsers().catch(console.error);
