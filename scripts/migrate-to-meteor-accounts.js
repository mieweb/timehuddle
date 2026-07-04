import { MongoClient } from 'mongodb';
import crypto from 'crypto';

const SOURCE_MONGO_URL = process.env.SOURCE_MONGO_URL || 'mongodb://127.0.0.1:27017/staging_prod';
const TARGET_MONGO_URL = process.env.TARGET_MONGO_URL || process.env.MONGO_URL || 'mongodb://127.0.0.1:27017/timehuddle';
const DRY_RUN = process.argv.includes('--dry-run');

/**
 * Migration Script: Better Auth ('user' + 'account') → Meteor Accounts ('users')
 * 
 * This script:
 * 1. Reads users from SOURCE database 'user' collection
 * 2. Reads account credentials from SOURCE database 'account' collection
 * 3. Converts Better Auth schema to Meteor Accounts schema
 * 4. Preserves user data (email, name, username, image, bio, etc.)
 * 5. Preserves password hashes via services.betterAuth for transparent login
 * 6. Writes to TARGET database 'users' collection
 * 
 * Usage:
 *   node migrate-to-meteor-accounts.js           # Run migration
 *   node migrate-to-meteor-accounts.js --dry-run # Preview changes without modifying database
 * 
 * Environment Variables:
 *   SOURCE_MONGO_URL - Source database with Better Auth data (default: mongodb://127.0.0.1:27017/staging_prod)
 *   TARGET_MONGO_URL - Target database for Meteor users (default: mongodb://127.0.0.1:27017/timehuddle)
 *   MONGO_URL        - Legacy alias for TARGET_MONGO_URL
 */
async function migrateUsers() {
  if (DRY_RUN) {
    console.log('🔍 DRY RUN MODE - No changes will be made to the database\n');
  }
  console.log('🚀 Starting migration: Better Auth → Meteor Accounts\n');
  console.log(`📍 Source: ${SOURCE_MONGO_URL}`);
  console.log(`📍 Target: ${TARGET_MONGO_URL}\n`);
  
  // Connect to both source and target databases
  const sourceClient = await MongoClient.connect(SOURCE_MONGO_URL);
  const sourceDb = sourceClient.db();
  
  const targetClient = await MongoClient.connect(TARGET_MONGO_URL);
  const targetDb = targetClient.db();
  
  // Get all users from Better Auth collection
  const betterAuthUsers = await sourceDb.collection('user').find({}).toArray();
  console.log(`📥 Found ${betterAuthUsers.length} users in source 'user' collection`);
  
  // Get all account credentials from Better Auth collection
  const betterAuthAccounts = await sourceDb.collection('account').find({}).toArray();
  console.log(`📥 Found ${betterAuthAccounts.length} accounts in source 'account' collection\n`);
  
  // Build a map of userId -> account (prefer providerId === "credential")
  const accountMap = new Map();
  for (const account of betterAuthAccounts) {
    const userId = String(account.userId);
    const existing = accountMap.get(userId);
    
    // Prefer "credential" provider (email/password) over others
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
        console.log(`⏭️  Skipping user ${user._id} (no email)`);
        skipped++;
        continue;
      }
      
      // Check if user already exists in Meteor collection
      const existing = await targetDb.collection('users').findOne({ 
        'emails.address': email 
      });
      
      if (existing) {
        console.log(`⏭️  Skipping ${email} (already exists)`);
        skipped++;
        continue;
      }
      
      // Look up account credentials for this user
      const userId = String(user._id);
      const account = accountMap.get(userId);
      
      // Build services object
      const services = {};
      
      // If we have a credential-based account with password hash, preserve it
      if (account && account.providerId === 'credential' && account.password) {
        services.betterAuth = {
          providerId: account.providerId,
          scryptHash: account.password, // Better Auth scrypt hash in "salt:keyHex" format
          // Note: migration-login-handler.js will verify this hash and upgrade to bcrypt on first login
        };
      }
      
      // Convert to Meteor Accounts schema
      const meteorUser = {
        _id: userId, // Meteor uses string IDs
        createdAt: user.createdAt || new Date(),
        services, // Contains betterAuth credentials if available
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
      
      const hasPassword = !!services.betterAuth;
      if (DRY_RUN) {
        console.log(`✓ Would migrate: ${email} [${user.name || 'No name'}]${hasPassword ? ' 🔑' : ' ⚠️ no password'}`);
      } else {
        await targetDb.collection('users').insertOne(meteorUser);
        console.log(`✅ Migrated: ${email} [${user.name || 'No name'}]${hasPassword ? ' 🔑' : ' ⚠️ no password'}`);
      }
      migrated++;
      
    } catch (error) {
      console.error(`❌ Error migrating ${user.email}: ${error.message}`);
      errors++;
    }
  }
  
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  if (DRY_RUN) {
    console.log('📋 DRY RUN SUMMARY:\n');
    console.log(`   ✓ Would migrate: ${migrated} users`);
    console.log(`   ⏭️  Would skip:   ${skipped} users (already exist)`);
    console.log(`   ❌ Errors:        ${errors} users\n`);
  } else {
    console.log('📋 MIGRATION SUMMARY:\n');
    console.log(`   ✅ Migrated: ${migrated} users`);
    console.log(`   ⏭️  Skipped:  ${skipped} users (already exist)`);
    console.log(`   ❌ Errors:   ${errors} users\n`);
  }
  
  // Verify final counts
  const finalSourceUserCount = await sourceDb.collection('user').countDocuments();
  const finalSourceAccountCount = await sourceDb.collection('account').countDocuments();
  const finalTargetUsersCount = await targetDb.collection('users').countDocuments();
  
  console.log('📊 Final Counts:');
  console.log(`   Source 'user' collection:    ${finalSourceUserCount}`);
  console.log(`   Source 'account' collection: ${finalSourceAccountCount}`);
  console.log(`   Target 'users' collection:   ${finalTargetUsersCount}\n`);
  
  if (DRY_RUN) {
    if (migrated > 0) {
      console.log('ℹ️  This was a dry run. No changes were made.');
      console.log('   Run without --dry-run to perform the actual migration.\n');
    } else {
      console.log('ℹ️  No users would be migrated (all already exist)\n');
    }
  } else {
    if (migrated > 0) {
      console.log('✅ Migration complete!');
      console.log('\n📝 Users with preserved passwords can sign in immediately.');
      console.log('   Users without passwords (⚠️) will need to use password reset.\n');
    } else {
      console.log('ℹ️  No users were migrated (all already exist)\n');
    }
  }
  
  await sourceClient.close();
  await targetClient.close();
}

migrateUsers().catch(console.error);
