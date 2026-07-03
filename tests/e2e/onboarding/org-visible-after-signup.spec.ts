import { test, expect } from '@playwright/test';

/**
 * Test that after signup + username claim, the organization appears in the
 * user dropdown menu WITHOUT requiring a page refresh.
 *
 * Regression test for the race condition where Accounts.onLogin auto-join
 * hadn't completed before TeamContext fetched organizations, leaving the
 * dropdown empty until manual refresh.
 */

test.describe.serial('Organization Visible After Signup', () => {
  test('organization appears in user dropdown immediately after signup and username claim', async ({
    page,
  }) => {
    const timestamp = Date.now();
    const uniqueName = `Ov${String(timestamp).slice(-6)}`;
    const email = `orgvis${timestamp}@test.local`;
    const username = `orgvis_${String(timestamp).slice(-8)}`;

    // ── Step 1: Sign up ───────────────────────────────────────────────────────

    await page.goto('http://localhost:3000/app?mode=signup');
    await expect(
      page.getByRole('heading', { name: /Create.*account/i }),
    ).toBeVisible({ timeout: 10000 });

    await page.getByRole('textbox', { name: 'First name' }).fill(uniqueName);
    await page.getByRole('textbox', { name: 'Last name' }).fill('OrgTest');
    await page.getByRole('textbox', { name: 'Email address' }).fill(email);
    await page.getByRole('textbox', { name: 'Password', exact: true }).fill('TestPass1!');
    await page.getByRole('textbox', { name: 'Confirm password' }).fill('TestPass1!');
    await page.getByRole('button', { name: 'Create account' }).click();

    // ── Step 2: Claim username ────────────────────────────────────────────────

    // Wait for either the dashboard to appear or the username claim dialog
    await page.waitForURL(/\/app\//, { timeout: 15000 });

    const dialog = page.getByRole('dialog', { name: 'Username Required' });
    const dialogVisible = await dialog.isVisible().catch(() => false);

    if (dialogVisible || await dialog.waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false)) {
      const usernameInput = dialog.getByRole('textbox', { name: 'Username' });
      await usernameInput.clear();
      await usernameInput.fill(username);

      // Wait for availability check to pass
      await expect(page.getByText(/✓.*is available/)).toBeVisible({ timeout: 8000 });
      await dialog.getByRole('button', { name: 'Claim username' }).click();

      // Wait for dialog to close
      await expect(dialog).toBeHidden({ timeout: 10000 });
    }

    await expect(page).toHaveURL(/\/app\/(dashboard|org|enterprise)/, { timeout: 15000 });

    // ── Step 3: Verify org in dropdown WITHOUT page refresh ───────────────────

    // Open the account menu dropdown
    const accountMenu = page.getByRole('button', { name: 'Account menu' });
    await expect(accountMenu).toBeVisible({ timeout: 10000 });
    await accountMenu.click();

    // The ORGANIZATION section with the default org should be visible
    // without requiring a page refresh.
    // Wait up to 15s to allow for the retry mechanism (1.5s delayed refetch).
    await expect(
      page.getByRole('menuitem').filter({ hasText: /Default Organization/i }),
    ).toBeVisible({ timeout: 15000 });
  });
});
