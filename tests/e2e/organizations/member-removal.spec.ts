import { test, expect } from '@playwright/test';
import { TEST_USERS, loginAs } from '../fixtures/users';

/**
 * E2E Test: Removing a Member From the Organization
 *
 * Signs up a throwaway user rather than removing a seed user — the seed users
 * are shared by the rest of the suite. A fresh sign-up is also the case that
 * used to fail: it is auto-joined to the default organization and gets a
 * Personal team inside it, which kept the row in the table after Remove.
 */
test.describe('Organization Member Removal', () => {
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
    await memberPage.getByPlaceholder('you@example.com').fill(`remove${timestamp}@example.com`);
    await memberPage.getByPlaceholder('••••••••').first().fill('TestPassword123!');
    await memberPage.getByPlaceholder('••••••••').last().fill('TestPassword123!');
    await memberPage.getByRole('button', { name: 'Create account' }).click();
    await expect(memberPage.getByText(/✓.*is available/)).toBeVisible({ timeout: 15000 });
    await memberPage.getByRole('button', { name: 'Claim username' }).click();
    await expect(memberPage).toHaveURL(/\/app\/(dashboard|org|enterprise)/, { timeout: 15000 });
    await memberContext.close();

    // ── The owner removes them ─────────────────────────────────────────────
    await loginAs(page, TEST_USERS.owner1);
    await page.goto('/app/org/members');
    await expect(page.getByText(/No organization is selected/i)).toBeHidden({ timeout: 30000 });
    await expect(page.getByRole('table')).toBeVisible({ timeout: 30000 });

    const memberRow = page.getByRole('row').filter({ hasText: fullName });
    await expect(memberRow).toBeVisible({ timeout: 10000 });
    await memberRow.getByRole('button', { name: `Remove ${fullName} from organization` }).click();

    // Remove asks first, and says what it will do.
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(
      dialog.getByText(new RegExp(`${fullName} will be removed from .* all of its teams`)),
    ).toBeVisible();
    await dialog.getByRole('button', { name: 'Remove Member' }).click();

    // The row goes without a manual refresh, and stays gone after one.
    await expect(dialog).toBeHidden({ timeout: 10000 });
    await expect(memberRow).toBeHidden({ timeout: 10000 });
    await page.reload();
    await expect(page.getByRole('table')).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole('row').filter({ hasText: fullName })).toBeHidden();
  });

  test('a manager cannot remove themselves', async ({ page }) => {
    const owner = TEST_USERS.owner1;
    await loginAs(page, owner);
    await page.goto('/app/org/members');
    await expect(page.getByText(/No organization is selected/i)).toBeHidden({ timeout: 30000 });
    await expect(page.getByRole('table')).toBeVisible({ timeout: 30000 });

    await expect(
      page.getByRole('button', { name: `Remove ${owner.name} from organization` }),
    ).toBeDisabled();
  });
});
