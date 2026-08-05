/**
 * Team Auto-Accept Join Requests E2E Tests
 *
 * Covers the "Auto-accept join requests" toggle in Team Settings:
 *
 *   1. A team admin flips the toggle in the Team Settings modal and the
 *      setting persists (`settings.autoAcceptJoins`).
 *   2. Auto-accept OFF (default): joining with the team code creates a
 *      pending request awaiting admin approval — the user is NOT added.
 *   3. Auto-accept ON: joining with the team code adds the user to
 *      `members` immediately — no pending request is created.
 *
 * Uses the isolated `timehuddle_test` DB (see global-setup.ts).
 */
import { test, expect, type Page } from '@playwright/test';
import { MongoClient, ObjectId, type Db } from 'mongodb';
import { TEST_USERS, loginAs, type TestUser } from '../fixtures/users';

const MONGO_URL =
  process.env.MONGO_URL ?? 'mongodb://127.0.0.1:27017/timehuddle_test?replicaSet=rs0';

const STAMP = Date.now();
const TEAM_NAME = `AutoAccept Team ${STAMP}`;
const TEAM_CODE = `AA${STAMP.toString(36).toUpperCase().slice(-6)}`;

/** Select the shared test team via the org/team switcher (deep links are racy). */
async function selectTeam(page: Page, teamName: string) {
  await page.getByRole('button', { name: /Switch organization and team/i }).click();
  // The switcher renders team items as plain <button>s inside its dialog
  // (not menuitems). Their accessible name is "<Team Name> <N> members",
  // so match by substring (not exact) and scope by dialog.
  await page.getByRole('dialog').getByRole('button', { name: teamName }).click();
}

async function openTeamsPage(page: Page) {
  await page.goto('/app/teams');
  await expect(page.getByRole('button', { name: 'Create Team' })).toBeVisible({ timeout: 30000 });
}

/** Open the Join Team modal, submit the code, and return without asserting. */
async function joinWithCode(page: Page, code: string) {
  await openTeamsPage(page);
  await page.getByRole('button', { name: 'Join Team' }).click();
  await page.getByPlaceholder('Enter team code').fill(code);
  await page.getByRole('button', { name: 'Join', exact: true }).click();
}

test.describe('Team Auto-Accept Join Requests', () => {
  const admin = TEST_USERS.admin1;
  let mongoClient: MongoClient;
  let db: Db;
  let teamId: ObjectId;

  async function getUserId(user: TestUser): Promise<string> {
    const doc = await db.collection('users').findOne({ 'emails.address': user.email });
    expect(doc).toBeTruthy();
    return String(doc!._id);
  }

  async function teamState() {
    const team = await db.collection('teams').findOne({ _id: teamId as never });
    return team!;
  }

  test.beforeAll(async () => {
    mongoClient = await MongoClient.connect(MONGO_URL);
    db = mongoClient.db();

    const defaultOrg = await db.collection('organizations').findOne({ slug: 'default' });
    expect(defaultOrg).toBeTruthy();
    const adminId = await getUserId(admin);

    teamId = new ObjectId();
    await db.collection('teams').insertOne({
      _id: teamId as never,
      orgId: defaultOrg!._id.toHexString(),
      parentTeamId: null,
      name: TEAM_NAME,
      members: [adminId],
      admins: [adminId],
      code: TEAM_CODE,
      isPersonal: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  test.afterAll(async () => {
    await db.collection('teams').deleteOne({ _id: teamId as never });
    await db.collection('teamjoinrequests').deleteMany({ teamId: teamId.toHexString() });
    await mongoClient?.close();
  });

  test('admin can toggle auto-accept in Team Settings and it persists', async ({ page }) => {
    await loginAs(page, admin);
    await openTeamsPage(page);
    await selectTeam(page, TEAM_NAME);
    await expect(page.getByText(TEAM_CODE)).toBeVisible({ timeout: 15000 });

    await page.getByRole('button', { name: 'Team Settings' }).click();
    const dialog = page.getByRole('dialog').filter({ hasText: 'Team Settings' });
    await expect(dialog).toBeVisible();

    const toggle = dialog.getByRole('switch', { name: 'Toggle auto-accepting join requests' });
    await expect(toggle).toBeVisible();
    await expect(toggle).not.toBeChecked();

    await toggle.click();
    await expect(toggle).toBeChecked();
    await expect
      .poll(async () => (await teamState()).settings?.autoAcceptJoins, { timeout: 10000 })
      .toBe(true);

    // Toggle back off — persists too (leaves the team in a known default state).
    await toggle.click();
    await expect(toggle).not.toBeChecked();
    await expect
      .poll(async () => (await teamState()).settings?.autoAcceptJoins, { timeout: 10000 })
      .toBe(false);
  });

  test('auto-accept OFF: joining with the code creates a pending request', async ({ page }) => {
    await db
      .collection('teams')
      .updateOne({ _id: teamId as never }, { $set: { 'settings.autoAcceptJoins': false } });
    const member = TEST_USERS.member1;
    const memberId = await getUserId(member);

    await loginAs(page, member);
    await joinWithCode(page, TEAM_CODE);

    // Pending-request modal confirms the request went to the approval queue.
    await expect(page.getByText(/Your request to join team/i)).toBeVisible({ timeout: 15000 });

    const team = await teamState();
    expect(team.members).not.toContain(memberId);
    const request = await db.collection('teamjoinrequests').findOne({
      teamId: teamId.toHexString(),
      userId: memberId,
      status: 'pending',
    });
    expect(request).toBeTruthy();
  });

  test('auto-accept ON: joining with the code adds the member immediately', async ({ page }) => {
    await db
      .collection('teams')
      .updateOne({ _id: teamId as never }, { $set: { 'settings.autoAcceptJoins': true } });
    const member = TEST_USERS.member3;
    const memberId = await getUserId(member);

    await loginAs(page, member);
    await joinWithCode(page, TEAM_CODE);

    // No pending modal — the team is selected right away.
    await expect(page.getByRole('heading', { name: TEAM_NAME })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/Your request to join team/i)).toBeHidden();

    await expect
      .poll(async () => (await teamState()).members.includes(memberId), { timeout: 10000 })
      .toBe(true);
    const request = await db.collection('teamjoinrequests').findOne({
      teamId: teamId.toHexString(),
      userId: memberId,
      status: 'pending',
    });
    expect(request).toBeNull();

    // Auto-joined the team's organization as well.
    const team = await teamState();
    const orgMember = await db
      .collection('org_members')
      .findOne({ orgId: team.orgId, userId: memberId });
    expect(orgMember).toBeTruthy();
  });
});
