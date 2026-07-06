/**
 * Playwright global teardown — removes all test users and data created during
 * the e2e suite run.
 *
 * Cleans up:
 *   - Seed users (`*@test.local`) provisioned by global-setup
 *   - Dynamic users created by signup / team-invitation tests
 *   - org_members, teams membership, and related records for those users
 *   - Test organizations created by the suite
 *   - Meteor login tokens / sessions for test users
 *
 * Environment variables:
 *   SKIP_CLEANUP=1   — skip teardown entirely (useful in production or when
 *                       you want to inspect test data after a run)
 *   MONGO_URL        — override the default MongoDB connection string
 */
import { MongoClient } from 'mongodb';

const MONGO_URL =
  process.env.MONGO_URL ?? 'mongodb://127.0.0.1:27017/timehuddle?directConnection=true';

export default async function globalTeardown(): Promise<void> {
  if (process.env.SKIP_CLEANUP === '1' || process.env.SKIP_CLEANUP === 'true') {
    console.log('[global-teardown] ⏭  SKIP_CLEANUP is set — skipping test data cleanup');
    return;
  }

  const client = await MongoClient.connect(MONGO_URL);
  const db = client.db();

  try {
    // ── 1. Identify all test users ──────────────────────────────────────────
    // Matches seed users (*@test.local) AND any dynamically created users
    // whose email ends with @test.local (signup tests, team-invitation tests).
    const testUsers = await db
      .collection('users')
      .find(
        { 'emails.address': { $regex: /@test\.local$/i } },
        { projection: { _id: 1, 'emails.address': 1 } },
      )
      .toArray();

    const testUserIds = testUsers.map((u) => String(u._id));

    if (testUserIds.length === 0) {
      console.log('[global-teardown] ✔ No test users found — nothing to clean up');
      await client.close();
      return;
    }

    // ── 2. Remove org_members for test users ────────────────────────────────
    const orgMemberResult = await db
      .collection('org_members')
      .deleteMany({ userId: { $in: testUserIds } });

    // ── 3. Remove test users from teams ─────────────────────────────────────
    const teamsResult = await db
      .collection('teams')
      .updateMany(
        { $or: [{ members: { $in: testUserIds } }, { admins: { $in: testUserIds } }] },
        { $pullAll: { members: testUserIds, admins: testUserIds } },
      );

    // ── 4. Remove test users from organization owners/admins arrays ─────────
    await db
      .collection('organizations')
      .updateMany(
        { $or: [{ owners: { $in: testUserIds } }, { admins: { $in: testUserIds } }] },
        { $pullAll: { owners: testUserIds, admins: testUserIds } },
      );

    // ── 5. Remove test user records ─────────────────────────────────────────
    const usersResult = await db
      .collection('users')
      .deleteMany({ 'emails.address': { $regex: /@test\.local$/i } });

    // ── 6. Remove Meteor sessions for test users ────────────────────────────
    // Meteor stores login tokens in the user doc (services.resume.loginTokens)
    // which are already deleted above. Also clean up any separate sessions
    // collection if it exists.
    const sessionsCollection = await db.listCollections({ name: 'sessions' }).toArray();
    if (sessionsCollection.length > 0) {
      await db.collection('sessions').deleteMany({ userId: { $in: testUserIds } });
    }

    // ── 7. Clean up test organizations ──────────────────────────────────────
    // Remove organizations created by tests (slug starting with 'test-' or
    // the 'default' org created by global-setup, and 'no-auto-join-*' orgs
    // from team-invitation tests).
    const orgsResult = await db.collection('organizations').deleteMany({
      $or: [
        { slug: 'default' },
        { slug: { $regex: /^test-/i } },
        { slug: { $regex: /^no-auto-join/i } },
        { name: { $regex: /^No Auto Join/i } },
      ],
    });

    // ── 8. Remove orphaned teams (no members, no admins after cleanup) ──────
    // Only remove teams that were explicitly created for tests.
    await db.collection('teams').deleteMany({
      members: { $size: 0 },
      admins: { $size: 0 },
      name: { $regex: /^Test Team/i },
    });

    // ── 9. Clean up personal_access_tokens for test users ───────────────────
    const patCollection = await db.listCollections({ name: 'personal_access_tokens' }).toArray();
    if (patCollection.length > 0) {
      await db.collection('personal_access_tokens').deleteMany({ userId: { $in: testUserIds } });
    }

    // ── 10. Clean up test-related data in auxiliary collections ──────────────
    // Remove timers, clock events, notifications, messages, team join requests,
    // and any other data linked to test users.
    const auxiliaryCollections = [
      'timers',
      'clock_events',
      'notifications',
      'messages',
      'team_join_requests',
      'tickets',
      'work_entries',
      'channels',
    ];
    let auxiliaryDeleted = 0;
    for (const collName of auxiliaryCollections) {
      const exists = await db.listCollections({ name: collName }).toArray();
      if (exists.length > 0) {
        const result = await db.collection(collName).deleteMany({ userId: { $in: testUserIds } });
        auxiliaryDeleted += result.deletedCount;
      }
    }

    // ── 11. Clean up Better Auth sessions/accounts for test users ───────────
    const betterAuthCollections = ['session', 'account', 'verification'];
    for (const collName of betterAuthCollections) {
      const exists = await db.listCollections({ name: collName }).toArray();
      if (exists.length > 0) {
        await db.collection(collName).deleteMany({ userId: { $in: testUserIds } });
      }
    }

    console.log(
      `[global-teardown] ✔ Cleaned up: ` +
        `${usersResult.deletedCount} users, ` +
        `${orgMemberResult.deletedCount} org_members, ` +
        `${teamsResult.modifiedCount} teams modified, ` +
        `${orgsResult.deletedCount} organizations, ` +
        `${auxiliaryDeleted} auxiliary records`,
    );
  } finally {
    await client.close();
  }
}
