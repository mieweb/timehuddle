#!/usr/bin/env node

/**
 * Migration Script: Fix Missing Org Members
 *
 * Problem: Some users are members of teams but missing from the org_members collection.
 * This happens when team invitations fail to auto-add users to the organization.
 *
 * Solution: Find all users in teams and ensure they have corresponding org_members records.
 *
 * Usage:
 *   node scripts/fix-org-members.js [--dry-run] [--verbose]
 *
 * Options:
 *   --dry-run   Show what would be fixed without making changes
 *   --verbose   Show detailed progress information
 */

import { MongoClient, ObjectId } from 'mongodb';

const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017/timeharbor';
const DRY_RUN = process.argv.includes('--dry-run');
const VERBOSE = process.argv.includes('--verbose');

async function main() {
  console.log('🔍 Checking for users in teams without org_members records...\n');

  if (DRY_RUN) {
    console.log('🧪 DRY RUN MODE - No changes will be made\n');
  }

  const client = await MongoClient.connect(MONGO_URL);
  const db = client.db();

  try {
    // Get all teams with their orgId and members
    const teams = await db
      .collection('teams')
      .find({ orgId: { $exists: true, $ne: null } })
      .project({ _id: 1, name: 1, orgId: 1, members: 1 })
      .toArray();

    if (VERBOSE) {
      console.log(`📊 Found ${teams.length} teams with organization links\n`);
    }

    // Build a map of userId -> Set of orgIds they should be in
    const userOrgMap = new Map();

    for (const team of teams) {
      if (!team.members || !Array.isArray(team.members)) continue;

      for (const userId of team.members) {
        if (!userOrgMap.has(userId)) {
          userOrgMap.set(userId, new Set());
        }
        userOrgMap.get(userId).add(team.orgId);
      }
    }

    if (VERBOSE) {
      console.log(`👥 Found ${userOrgMap.size} unique users across all teams\n`);
    }

    // Check each user's org_members records
    let fixedCount = 0;
    let alreadyGoodCount = 0;
    const fixes = [];

    for (const [userId, expectedOrgIds] of userOrgMap.entries()) {
      // Get existing org_members records for this user
      const existingRecords = await db
        .collection('org_members')
        .find({ userId })
        .project({ orgId: 1 })
        .toArray();

      const existingOrgIds = new Set(existingRecords.map((r) => r.orgId));

      // Find missing org memberships
      for (const orgId of expectedOrgIds) {
        if (!existingOrgIds.has(orgId)) {
          // User is in a team but not in org_members
          const org = await db
            .collection('organizations')
            .findOne({ _id: new ObjectId(orgId) }, { projection: { name: 1, allowAutoJoin: 1 } });

          // Get user info for better logging
          const user = await db
            .collection('user')
            .findOne(
              { _id: typeof userId === 'string' ? userId : new ObjectId(userId) },
              { projection: { name: 1, email: 1 } },
            );

          const userDisplay = user ? `${user.name} (${user.email})` : userId;
          const orgDisplay = org ? `${org.name}` : orgId;

          console.log(`❌ Missing: ${userDisplay} → ${orgDisplay}`);

          fixes.push({
            userId,
            orgId,
            userName: user?.name,
            userEmail: user?.email,
            orgName: org?.name,
            allowAutoJoin: org?.allowAutoJoin,
          });

          if (!DRY_RUN) {
            // Add the missing org_members record
            await db.collection('org_members').insertOne({
              _id: new ObjectId(),
              orgId,
              userId,
              role: 'member',
              auto: true,
              createdAt: new Date(),
              updatedAt: new Date(),
            });
            console.log(`  ✅ Fixed: Added as member (auto: true)`);
          } else {
            console.log(`  🧪 Would add as member (auto: true)`);
          }

          fixedCount++;
        } else {
          alreadyGoodCount++;
        }
      }
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 SUMMARY');
    console.log('='.repeat(60));
    console.log(`✅ Already correct: ${alreadyGoodCount} user-org relationships`);
    console.log(
      `${DRY_RUN ? '🧪' : '✅'} ${DRY_RUN ? 'Would fix' : 'Fixed'}: ${fixedCount} missing org_members records`,
    );

    if (fixes.length > 0) {
      console.log('\n📋 Details of fixes:');
      fixes.forEach((fix, i) => {
        console.log(`\n${i + 1}. ${fix.userName} (${fix.userEmail})`);
        console.log(`   Organization: ${fix.orgName}`);
        console.log(`   Role: member (auto: true)`);
        console.log(`   Org allowAutoJoin: ${fix.allowAutoJoin ?? 'undefined (defaults to true)'}`);
      });
    }

    if (DRY_RUN && fixedCount > 0) {
      console.log('\n💡 Run without --dry-run to apply these fixes');
    }

    console.log('');
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error('❌ Error:', err);
  process.exit(1);
});
