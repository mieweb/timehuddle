import { test, expect } from '@playwright/test';
import { MongoClient } from 'mongodb';
import { TEST_USERS, loginAs } from '../fixtures/users';
import { memberAction, memberRow, membersTable, openMembers } from '../fixtures/people';

const MONGO_URL =
  process.env.MONGO_URL ?? 'mongodb://127.0.0.1:27017/timehuddle_test?replicaSet=rs0';

/**
 * E2E Test: Removing a Member From the Organization
 *
 * Signs up a throwaway user rather than removing a seed user — the seed users
 * are shared by the rest of the suite. A fresh sign-up is also the case that
 * used to fail: it is auto-joined to the default organization and gets a
 * Personal team inside it, which kept the row in the table after Remove.
 */
test.describe('Organization Member Removal', () => {
  const createdUserEmails: string[] = [];

  test.afterAll(async () => {
    // Global teardown only knows the @test.local seed users, and removal leaves
    // the Personal team in place, so the sign-up is cleaned up here.
    if (createdUserEmails.length === 0) return;
    const mongoClient = await MongoClient.connect(MONGO_URL);
    try {
      const db = mongoClient.db();
      const users = await db
        .collection('users')
        .find({ 'emails.address': { $in: createdUserEmails } }, { projection: { _id: 1 } })
        .toArray();
      const userIds = users.map((u) => String(u._id));
      await db.collection('users').deleteMany({ 'emails.address': { $in: createdUserEmails } });
      await db.collection('org_members').deleteMany({ userId: { $in: userIds } });
      await db.collection('teams').deleteMany({ isPersonal: true, members: { $in: userIds } });
    } finally {
      await mongoClient.close();
    }
  });

  test('removing a member takes their row out of the table', async ({ page, browser }) => {
    test.setTimeout(120000);
    const timestamp = Date.now();
    const firstName = `Rm${String(timestamp).slice(-6)}`;
    const fullName = `${firstName} User`;

    // ── The member signs up and lands in the default organization ──────────
    const memberContext = await browser.newContext();
    const memberPage = await memberContext.newPage();
    await memberPage.goto('/app?mode=signup');
    await memberPage.getByPlaceholder('Jane').fill(firstName);
    await memberPage.getByPlaceholder('Doe').fill('User');
    const email = `remove${timestamp}@example.com`;
    createdUserEmails.push(email);
    await memberPage.getByPlaceholder('you@example.com').fill(email);
    await memberPage.getByPlaceholder('••••••••').first().fill('TestPassword123!');
    await memberPage.getByPlaceholder('••••••••').last().fill('TestPassword123!');
    await memberPage.getByRole('button', { name: 'Create account' }).click();
    await expect(memberPage.getByText(/✓.*is available/)).toBeVisible({ timeout: 15000 });
    await memberPage.getByRole('button', { name: 'Claim username' }).click();
    await expect(memberPage).toHaveURL(/\/app\/(dashboard|org|enterprise)/, { timeout: 15000 });
    await memberContext.close();

    // ── The owner removes them ─────────────────────────────────────────────
    await loginAs(page, TEST_USERS.owner1);
    await openMembers(page);
    const row = memberRow(page, fullName);
    await expect(row).toBeVisible({ timeout: 10000 });
    await (await memberAction(page, fullName, 'Remove from organization')).click();

    // Remove asks first, and says what it will do.
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(
      dialog.getByText(new RegExp(`${fullName} will be removed from .* all of its teams`)),
    ).toBeVisible();
    await dialog.getByRole('button', { name: 'Remove Member' }).click();

    // The row goes without a manual refresh, and stays gone after one.
    await expect(dialog).toBeHidden({ timeout: 10000 });
    await expect(row).toBeHidden({ timeout: 10000 });
    await page.reload();
    await expect(membersTable(page)).toBeVisible({ timeout: 30000 });
    await expect(memberRow(page, fullName)).toBeHidden();
  });

  test('a manager cannot remove themselves', async ({ page }) => {
    const owner = TEST_USERS.owner1;
    await loginAs(page, owner);
    await openMembers(page);

    await expect(await memberAction(page, owner.name, 'Remove from organization')).toBeDisabled();
  });
});
