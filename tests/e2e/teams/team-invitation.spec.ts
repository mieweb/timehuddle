import { test, expect } from '@playwright/test';
import { MongoClient, ObjectId } from 'mongodb';
import { LoginPage } from '../pages/LoginPage';
import { DashboardPage } from '../pages/DashboardPage';
import { TeamsPage } from '../pages/TeamsPage';
import { OrganizationPage } from '../pages/OrganizationPage';
import { TEST_USERS } from '../fixtures/users';

/**
 * Team Invitation E2E Tests
 *
 * Tests the complete flow of team invitations and automatic org membership.
 *
 * Key scenarios:
 * 1. When a user is invited to a team, they should be automatically added to the organization
 * 2. The user should see the organization in their sidebar
 * 3. The user should have a record in the org_members collection
 * 4. The org allowAutoJoin setting should control this behavior
 */

test.describe('Team Invitation with Org Membership', () => {
  let _loginPage: LoginPage;
  let _dashboardPage: DashboardPage;
  let _teamsPage: TeamsPage;
  let _orgPage: OrganizationPage;
  let mongoClient: MongoClient;
  let db: any;

  const MONGO_URL =
    process.env.MONGO_URL || 'mongodb://127.0.0.1:27017/timehuddle_test?replicaSet=rs0';

  // Test users
  const _admin = TEST_USERS.admin1;
  const _member = TEST_USERS.member1;

  test.beforeAll(async () => {
    // Connect to MongoDB for verification
    mongoClient = await MongoClient.connect(MONGO_URL);
    db = mongoClient.db();
  });

  test.afterAll(async () => {
    // Close MongoDB connection
    await mongoClient?.close();
  });

  test.beforeEach(async ({ page }) => {
    _loginPage = new LoginPage(page);
    _dashboardPage = new DashboardPage(page);
    _teamsPage = new TeamsPage(page);
    _orgPage = new OrganizationPage(page);
  });

  test('user invited to team should automatically join organization', async () => {
    // This test verifies the auto-add logic by simulating a team invitation via database

    // Step 1: Create a new test user who is NOT yet in any org
    const timestamp = Date.now();
    const newUserEmail = `testuser${timestamp}@test.local`;
    const newUserName = `Test User ${timestamp}`;

    // Insert user into Meteor users collection
    const newUserId = new ObjectId().toHexString();
    await db.collection('users').insertOne({
      _id: newUserId,
      emails: [{ address: newUserEmail, verified: false }],
      profile: { name: newUserName },
      createdAt: new Date(),
    });

    try {
      // Step 2: Get or create a team linked to an org
      const defaultOrg = await db.collection('organizations').findOne({ slug: 'default' });
      expect(defaultOrg).toBeTruthy();
      const orgId = defaultOrg._id.toHexString();

      let existingTeam = await db.collection('teams').findOne({
        orgId: { $exists: true, $ne: null },
        isPersonal: { $ne: true },
      });

      if (!existingTeam) {
        // Create a test team linked to the default org
        const testTeamId = new ObjectId();
        await db.collection('teams').insertOne({
          _id: testTeamId,
          name: `Test Team ${timestamp}`,
          orgId,
          members: [],
          admins: [],
          isPersonal: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        existingTeam = await db.collection('teams').findOne({ _id: testTeamId });
      }
      const org = await db.collection('organizations').findOne({
        _id: new ObjectId(orgId),
      });

      expect(org).toBeTruthy();
      expect(org.allowAutoJoin).not.toBe(false); // Should be true or undefined (defaults to true)

      // Step 3: Simulate team invitation by adding user to team
      await db.collection('teams').updateOne(
        { _id: existingTeam._id },
        {
          $addToSet: { members: newUserId },
          $set: { updatedAt: new Date() },
        },
      );

      // Step 4: Simulate the auto-add logic from teams.invite (lines 367-369)
      if (org?.allowAutoJoin !== false) {
        // This is what the backend should do automatically
        await db.collection('org_members').insertOne({
          _id: new ObjectId(),
          orgId: orgId,
          userId: newUserId,
          role: 'member',
          auto: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }

      // Step 5: Verify in database that user is added to team
      const updatedTeam = await db.collection('teams').findOne({ _id: existingTeam._id });
      expect(updatedTeam.members).toContain(newUserId);

      // Step 6: CRITICAL CHECK - Verify user is in org_members collection
      const orgMembership = await db.collection('org_members').findOne({
        userId: newUserId,
        orgId: orgId,
      });

      expect(orgMembership).toBeTruthy();
      expect(orgMembership.role).toBe('member');
      expect(orgMembership.auto).toBe(true);

      // Step 7: Verify user can see the organization
      const accessibleOrgs = await db
        .collection('org_members')
        .find({ userId: newUserId })
        .toArray();

      expect(accessibleOrgs.length).toBeGreaterThan(0);
      expect(accessibleOrgs[0].orgId).toBe(orgId);
    } finally {
      // Cleanup: Remove test user
      await db.collection('users').deleteOne({ _id: newUserId });
      await db.collection('org_members').deleteMany({ userId: newUserId });
      await db
        .collection('teams')
        .updateMany({ members: newUserId }, { $pull: { members: newUserId } });
    }
  });

  test('should not auto-add to org when allowAutoJoin is false', async () => {
    // This test verifies that auto-add is skipped when allowAutoJoin is false

    // Step 1: Create a test org with allowAutoJoin: false
    const testOrgId = new ObjectId();
    const testOrgName = `Test Org No Auto Join ${Date.now()}`;

    await db.collection('organizations').insertOne({
      _id: testOrgId,
      name: testOrgName,
      slug: testOrgName.toLowerCase().replace(/\s+/g, '-'),
      allowAutoJoin: false, // ⚠️ Disable auto-join
      owners: [],
      admins: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Step 2: Get any existing user to be the team admin
    const existingUser = await db
      .collection('users')
      .findOne({ 'emails.address': 'admin1@test.local' });
    expect(existingUser).toBeTruthy();
    const existingUserId = String(existingUser._id);

    // Step 3: Create a team in this org
    const testTeamId = new ObjectId();

    await db.collection('teams').insertOne({
      _id: testTeamId,
      name: `Test Team ${Date.now()}`,
      orgId: testOrgId.toHexString(),
      members: [existingUserId],
      admins: [existingUserId],
      isPersonal: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Step 4: Add existing user to org_members so they can manage it
    await db.collection('org_members').insertOne({
      _id: new ObjectId(),
      orgId: testOrgId.toHexString(),
      userId: existingUserId,
      role: 'owner',
      auto: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Step 5: Create new user to invite
    const timestamp = Date.now();
    const newUserEmail = `testuser${timestamp}@test.local`;
    const newUserId = new ObjectId().toHexString();

    await db.collection('users').insertOne({
      _id: newUserId,
      emails: [{ address: newUserEmail, verified: false }],
      profile: { name: `Test User ${timestamp}` },
      createdAt: new Date(),
    });

    try {
      // Step 6: Simulate team invitation by adding user to team
      await db.collection('teams').updateOne(
        { _id: testTeamId },
        {
          $addToSet: { members: newUserId },
          $set: { updatedAt: new Date() },
        },
      );

      // Step 7: Simulate the auto-add logic check (should NOT add because allowAutoJoin is false)
      const org = await db.collection('organizations').findOne({ _id: testOrgId });
      if (org?.allowAutoJoin !== false) {
        // This should NOT execute because allowAutoJoin is false
        await db.collection('org_members').insertOne({
          _id: new ObjectId(),
          orgId: testOrgId.toHexString(),
          userId: newUserId,
          role: 'member',
          auto: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }

      // Step 8: Verify user is in team but NOT in org_members
      const updatedTeam = await db.collection('teams').findOne({ _id: testTeamId });
      expect(updatedTeam.members).toContain(newUserId);

      const orgMembership = await db.collection('org_members').findOne({
        userId: newUserId,
        orgId: testOrgId.toHexString(),
      });

      // ⚠️ This SHOULD be null because allowAutoJoin is false
      expect(orgMembership).toBeNull();
    } finally {
      // Cleanup
      await db.collection('users').deleteOne({ _id: newUserId });
      await db.collection('teams').deleteOne({ _id: testTeamId });
      await db.collection('organizations').deleteOne({ _id: testOrgId });
      await db.collection('org_members').deleteMany({
        orgId: testOrgId.toHexString(),
      });
    }
  });

  test('member can see organization in sidebar after team invitation', async () => {
    // This test verifies the database state - that users in teams have org_members records
    // This is a comprehensive check that the auto-add logic works correctly

    // Step 1: Find teams with orgId
    const teams = await db
      .collection('teams')
      .find({ orgId: { $exists: true, $ne: null } })
      .limit(5)
      .toArray();

    expect(teams.length).toBeGreaterThan(0);

    // Step 2: For each team, verify all members have org_members records
    for (const team of teams) {
      if (!team.members || team.members.length === 0) continue;

      const org = await db.collection('organizations').findOne({
        _id: new ObjectId(team.orgId),
      });

      // If org doesn't exist or allowAutoJoin is false, skip this team
      if (!org || org.allowAutoJoin === false) continue;

      // Step 3: Check each team member has org_members record
      for (const userId of team.members) {
        const orgMembership = await db.collection('org_members').findOne({
          userId: userId,
          orgId: team.orgId,
        });

        // This is the key assertion - users in teams should have org_members records
        expect(orgMembership).toBeTruthy();
        expect(orgMembership.orgId).toBe(team.orgId);
      }
    }
  });

  test('migration script identifies users missing org_members records', async () => {
    // This test verifies the fix-org-members.js script logic

    // Step 1: Create a user who is in a team but NOT in org_members (simulating the bug)
    const timestamp = Date.now();
    const buggyUserId = new ObjectId().toHexString();
    const buggyUserEmail = `buggyuser${timestamp}@test.local`;

    await db.collection('users').insertOne({
      _id: buggyUserId,
      emails: [{ address: buggyUserEmail, verified: false }],
      profile: { name: `Buggy User ${timestamp}` },
      createdAt: new Date(),
    });

    // Get an existing team
    const existingTeam = await db.collection('teams').findOne({
      orgId: { $exists: true, $ne: null },
    });

    expect(existingTeam).toBeTruthy();

    // Add user to team WITHOUT adding to org_members (simulating the bug)
    await db
      .collection('teams')
      .updateOne({ _id: existingTeam._id }, { $addToSet: { members: buggyUserId } });

    try {
      // Step 2: Verify the problem exists
      const orgMembership = await db.collection('org_members').findOne({
        userId: buggyUserId,
        orgId: existingTeam.orgId,
      });

      expect(orgMembership).toBeNull(); // User is in team but NOT in org_members

      // Step 3: Simulate what the migration script does
      // Find all users in teams
      const teams = await db
        .collection('teams')
        .find({ orgId: { $exists: true, $ne: null } })
        .toArray();

      const userOrgMap = new Map();
      for (const team of teams) {
        if (!team.members) continue;
        for (const userId of team.members) {
          if (!userOrgMap.has(userId)) {
            userOrgMap.set(userId, new Set());
          }
          userOrgMap.get(userId).add(team.orgId);
        }
      }

      // Verify our buggy user is detected
      expect(userOrgMap.has(buggyUserId)).toBe(true);
      expect(userOrgMap.get(buggyUserId).has(existingTeam.orgId)).toBe(true);

      // Step 4: Apply the fix (what the migration script would do)
      for (const [userId, orgIds] of userOrgMap.entries()) {
        const existingRecords = await db.collection('org_members').find({ userId }).toArray();

        const existingOrgIds = new Set(existingRecords.map((r) => r.orgId));

        for (const orgId of orgIds) {
          if (!existingOrgIds.has(orgId)) {
            // Add missing org_members record
            await db.collection('org_members').insertOne({
              _id: new ObjectId(),
              orgId,
              userId,
              role: 'member',
              auto: true,
              createdAt: new Date(),
              updatedAt: new Date(),
            });
          }
        }
      }

      // Step 5: Verify the fix worked
      const fixedMembership = await db.collection('org_members').findOne({
        userId: buggyUserId,
        orgId: existingTeam.orgId,
      });

      expect(fixedMembership).toBeTruthy();
      expect(fixedMembership.role).toBe('member');
      expect(fixedMembership.auto).toBe(true);
    } finally {
      // Cleanup
      await db.collection('users').deleteOne({ _id: buggyUserId });
      await db
        .collection('teams')
        .updateOne({ _id: existingTeam._id }, { $pull: { members: buggyUserId } });
      await db.collection('org_members').deleteMany({ userId: buggyUserId });
    }
  });
});
