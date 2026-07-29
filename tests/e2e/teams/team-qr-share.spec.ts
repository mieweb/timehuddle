/**
 * Team QR Share E2E Tests
 *
 * Covers the "Share team via QR code" flow on the Teams page:
 *
 *   1. A team member opens the Share modal → QR code + join link are shown,
 *      and the link encodes the team's join code
 *      (`/app?mode=signup&join=<CODE>`).
 *   2. A brand-new visitor "scans" the QR (opens the join link) → sees the
 *      "You're joining the team …" banner → creates an account → is added to
 *      the team's `members` (and the org via auto-join) with no admin
 *      approval step.
 *   3. An existing user opening the join link signs in and is added to the
 *      team immediately.
 *   4. An invalid join code surfaces a clear error on the login page.
 *
 * Uses the isolated `timehuddle_test` DB (see global-setup.ts).
 */
import { test, expect, type Page } from '@playwright/test';
import { MongoClient, ObjectId, type Db } from 'mongodb';
import { TEST_USERS, loginAs } from '../fixtures/users';

const MONGO_URL =
  process.env.MONGO_URL ?? 'mongodb://127.0.0.1:27017/timehuddle_test?replicaSet=rs0';
const PASSWORD = 'QrJoinPass123!';

const STAMP = Date.now();
const TEAM_NAME = `QR Share Team ${STAMP}`;
// Team codes are uppercase alphanumerics; keep the same shape.
const TEAM_CODE = `QR${STAMP.toString(36).toUpperCase().slice(-6)}`;

/** Select the shared test team via the org/team switcher (deep links are racy). */
async function selectTeam(page: Page, teamName: string) {
  await page.getByRole('button', { name: /Switch organization and team/i }).click();
  await page.getByRole('menuitem', { name: teamName }).click();
}

/** Open the Teams page with the test team selected and return the Share button. */
async function openTeamsPage(page: Page) {
  await page.goto('/app/teams');
  await expect(page.getByRole('button', { name: 'Create Team' })).toBeVisible({ timeout: 30000 });
  await selectTeam(page, TEAM_NAME);
  await expect(page.getByText(TEAM_CODE)).toBeVisible({ timeout: 15000 });
}

/** Complete signup on the current page; handles the optional username dialog. */
async function completeSignup(page: Page, opts: { first: string; last: string; email: string }) {
  await page.getByRole('textbox', { name: 'First name' }).fill(opts.first);
  await page.getByRole('textbox', { name: 'Last name' }).fill(opts.last);
  await page.getByRole('textbox', { name: 'Email address' }).fill(opts.email);
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill(PASSWORD);
  await page.getByRole('textbox', { name: 'Confirm password' }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();

  const usernameDialog = page.getByRole('dialog', { name: 'Username Required' });
  await Promise.race([
    page.waitForURL(/\/app\/(dashboard)?$/, { timeout: 20000 }).catch(() => {}),
    usernameDialog.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {}),
  ]);
  if (await usernameDialog.isVisible().catch(() => false)) {
    // Explicit unique username — the auto-suggested one may collide with
    // leftovers from previous runs.
    await usernameDialog
      .getByRole('textbox', { name: 'Username' })
      .fill(`qr_${Date.now().toString(36)}`);
    await usernameDialog.getByRole('button', { name: 'Claim username' }).click();
    await usernameDialog.waitFor({ state: 'hidden', timeout: 10000 });
  }
  await page.waitForURL(/\/app\/(dashboard)?$/, { timeout: 20000 });
}

test.describe('Team QR Share & Join', () => {
  const admin = TEST_USERS.admin1;
  let mongoClient: MongoClient;
  let db: Db;
  let teamId: ObjectId;
  let orgId: string;
  const createdUserEmails: string[] = [];

  test.beforeAll(async () => {
    mongoClient = await MongoClient.connect(MONGO_URL);
    db = mongoClient.db();

    const defaultOrg = await db.collection('organizations').findOne({ slug: 'default' });
    expect(defaultOrg).toBeTruthy();
    orgId = defaultOrg!._id.toHexString();

    const adminUser = await db.collection('users').findOne({ 'emails.address': admin.email });
    expect(adminUser).toBeTruthy();
    const adminId = String(adminUser!._id);

    teamId = new ObjectId();
    await db.collection('teams').insertOne({
      _id: teamId as never,
      orgId,
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
    // Remove the test team and any accounts created through the QR flow.
    await db.collection('teams').deleteOne({ _id: teamId as never });
    if (createdUserEmails.length > 0) {
      const users = await db
        .collection('users')
        .find({ 'emails.address': { $in: createdUserEmails } })
        .toArray();
      const userIds = users.map((u) => String(u._id));
      await db.collection('users').deleteMany({ 'emails.address': { $in: createdUserEmails } });
      await db.collection('org_members').deleteMany({ userId: { $in: userIds } });
      await db.collection('teams').deleteMany({ isPersonal: true, members: { $in: userIds } });
    }
    // Detach member2 in case the existing-user test ran.
    const member2 = await db
      .collection('users')
      .findOne({ 'emails.address': TEST_USERS.member2.email });
    if (member2) {
      await db
        .collection('teams')
        .updateMany({ code: TEAM_CODE }, { $pull: { members: String(member2._id) } as never });
    }
    await mongoClient?.close();
  });

  test('share modal shows a QR code and a join link encoding the team code', async ({ page }) => {
    await loginAs(page, admin);
    await openTeamsPage(page);

    await page.getByRole('button', { name: 'Share team QR code' }).click();

    const dialog = page.getByRole('dialog').filter({ hasText: 'Share Team' });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByText(/Scan this QR code to create an account and join/i),
    ).toBeVisible();
    await expect(dialog.getByTestId('team-share-qr')).toBeVisible();

    const link = await dialog.getByTestId('team-share-link').textContent();
    expect(link).toContain('/app?mode=signup');
    expect(link).toContain(`join=${TEAM_CODE}`);

    await dialog.getByRole('button', { name: 'Copy Link' }).click();
    await expect(dialog.getByRole('button', { name: 'Copied!' })).toBeVisible();
  });

  test('new visitor signs up via the QR link and auto-joins the team', async ({ browser }) => {
    test.setTimeout(90000);
    const email = `qr-joiner-${Date.now()}@test.dev`;
    createdUserEmails.push(email);

    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await page.goto(`/app?mode=signup&join=${TEAM_CODE}`);

      // The banner names the team the visitor is about to join.
      await expect(page.getByText(`You're joining the team ${TEAM_NAME}`)).toBeVisible({
        timeout: 20000,
      });

      await completeSignup(page, { first: 'Qr', last: `Joiner${STAMP}`, email });

      // DB: the new user is a member of the shared team — no pending request.
      const user = await db.collection('users').findOne({ 'emails.address': email });
      expect(user).toBeTruthy();
      const userId = String(user!._id);

      await expect
        .poll(
          async () => {
            const team = await db.collection('teams').findOne({ _id: teamId as never });
            return team?.members?.includes(userId) ?? false;
          },
          { timeout: 15000 },
        )
        .toBe(true);

      const pending = await db
        .collection('teamjoinrequests')
        .findOne({ userId, status: 'pending' });
      expect(pending).toBeNull();

      // Auto-joined the team's organization as a member.
      const orgMember = await db.collection('org_members').findOne({ orgId, userId });
      expect(orgMember?.role).toBe('member');
    } finally {
      await context.close();
    }
  });

  test('existing user opening the join link is added to the team after signing in', async ({
    browser,
  }) => {
    test.setTimeout(90000);
    const member = TEST_USERS.member2;

    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await page.goto(`/app?join=${TEAM_CODE}`);
      await expect(page.getByText(`You're joining the team ${TEAM_NAME}`)).toBeVisible({
        timeout: 20000,
      });

      await page.fill('input[type="email"]', member.email);
      await page.fill('input[type="password"]', member.password);
      await page.click('button:has-text("Sign in")');
      await page.waitForURL('**/dashboard', { timeout: 45000 });

      const memberUser = await db.collection('users').findOne({ 'emails.address': member.email });
      const memberId = String(memberUser!._id);
      await expect
        .poll(
          async () => {
            const team = await db.collection('teams').findOne({ _id: teamId as never });
            return team?.members?.includes(memberId) ?? false;
          },
          { timeout: 15000 },
        )
        .toBe(true);
    } finally {
      await context.close();
    }
  });

  test('invalid join code shows an error on the login page', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await page.goto('/app?mode=signup&join=NOPE0000');
      await expect(page.getByText(/invalid or no longer available/i)).toBeVisible({
        timeout: 20000,
      });
    } finally {
      await context.close();
    }
  });
});
