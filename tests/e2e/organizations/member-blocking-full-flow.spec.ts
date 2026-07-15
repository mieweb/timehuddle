import { test, expect } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { DashboardPage } from '../pages/DashboardPage';
import { TEST_USERS } from '../fixtures/users';

/**
 * E2E Test: Complete Member Blocking Flow
 *
 * Uses provisioned test users (owner1, member5) to test:
 * 1. Owner sees member in organization members list
 * 2. Owner blocks the member
 * 3. Blocked member cannot login
 * 4. Owner unblocks the member
 * 5. Member can login again
 */
test.describe('Member Blocking - Full Flow', () => {
  const owner = TEST_USERS.owner1;
  const member = TEST_USERS.member5;

  test('complete blocking flow: block → verify denied → unblock → verify restored', async ({
    page,
  }) => {
    const loginPage = new LoginPage(page);
    const dashboardPage = new DashboardPage(page);

    // ── Step 1: Owner logs in ──────────────────────────────────────────────
    await loginPage.goto();
    await loginPage.loginAs(owner);
    await page.waitForURL('**/dashboard', { timeout: 15000 });

    // ── Step 2: Navigate to org members ────────────────────────────────────
    await page.goto('http://localhost:3000/app/org/members');
    // Wait for org to be selected and table to render
    await expect(page.getByText(/No organization is selected/i)).toBeHidden({ timeout: 30000 });
    await expect(page.getByRole('table')).toBeVisible({ timeout: 20000 });

    // Find member row
    const memberRow = page.getByRole('row').filter({ hasText: member.name });
    await expect(memberRow).toBeVisible({ timeout: 5000 });

    // Ensure member is NOT already blocked (clean state from previous run)
    const existingUnblock = memberRow.locator('button:has-text("Unblock")');
    if (await existingUnblock.isVisible({ timeout: 1000 }).catch(() => false)) {
      await existingUnblock.click();
      await page.waitForTimeout(2000);
      await page.reload();
      await expect(page.getByRole('table')).toBeVisible({ timeout: 20000 });
    }

    // ── Step 3: Block the member ───────────────────────────────────────────
    const freshRow = page.getByRole('row').filter({ hasText: member.name });
    const blockBtn = freshRow.locator('button:has-text("Block")').first();
    await expect(blockBtn).toBeVisible({ timeout: 5000 });
    await blockBtn.click();

    // Fill block modal
    const modal = page.getByRole('dialog');
    await expect(modal).toBeVisible({ timeout: 5000 });
    await expect(modal.getByText('Block Member').first()).toBeVisible();

    const reasonInput = modal.locator('textarea, input[type="text"]').last();
    if (await reasonInput.isVisible({ timeout: 1000 }).catch(() => false)) {
      await reasonInput.fill('E2E test - blocking user for testing');
    }

    // Confirm block — look for a submit/block button inside the modal
    const confirmBlock = modal.locator('button:has-text("Block")').last();
    await confirmBlock.click();
    await page.waitForTimeout(2000);

    // Reload and verify blocked badge
    await page.reload();
    await expect(page.getByRole('table')).toBeVisible({ timeout: 20000 });

    const blockedRow = page.getByRole('row').filter({ hasText: member.name });
    const blockedBadge = blockedRow.getByText(/blocked/i);
    await expect(blockedBadge).toBeVisible({ timeout: 5000 });

    const unblockButton = blockedRow.locator('button:has-text("Unblock")');
    await expect(unblockButton).toBeVisible();

    // ── Step 4: Owner logs out ─────────────────────────────────────────────
    await dashboardPage.logout();
    // Wait for login page heading to confirm logout
    await page.getByRole('heading', { name: 'Sign in to your account' }).waitFor({
      state: 'visible',
      timeout: 15000,
    });

    // ── Step 5: Blocked member cannot login ────────────────────────────────
    await loginPage.login(member.email, member.password);
    await page.waitForTimeout(3000);

    // Should still be on login page (not redirected to dashboard)
    const url = page.url();
    expect(url).not.toContain('/dashboard');

    // Should show suspension error
    const errorAlert = page.getByRole('alert');
    await expect(errorAlert).toBeVisible({ timeout: 5000 });
    const errorText = await errorAlert.textContent();
    expect(errorText?.toLowerCase()).toMatch(/suspended|blocked|contact.*administrator/i);

    // ── Step 6: Owner logs back in to unblock ──────────────────────────────
    await loginPage.goto();
    await loginPage.loginAs(owner);
    await page.waitForURL('**/dashboard', { timeout: 15000 });

    // ── Step 7: Unblock the member ─────────────────────────────────────────
    await page.goto('http://localhost:3000/app/org/members');
    await expect(page.getByRole('table')).toBeVisible({ timeout: 20000 });

    const unblockedRow = page.getByRole('row').filter({ hasText: member.name });
    const unblockBtn = unblockedRow.locator('button:has-text("Unblock")');
    await expect(unblockBtn).toBeVisible({ timeout: 5000 });
    await unblockBtn.click();
    await page.waitForTimeout(2000);

    // Reload and verify unblocked
    await page.reload();
    await expect(page.getByRole('table')).toBeVisible({ timeout: 20000 });

    const restoredRow = page.getByRole('row').filter({ hasText: member.name });
    const restoredBlockedBadge = restoredRow.getByText(/blocked/i);
    await expect(restoredBlockedBadge).not.toBeVisible();

    const reblockButton = restoredRow.locator('button:has-text("Block")').first();
    await expect(reblockButton).toBeVisible();

    // ── Step 8: Owner logs out ─────────────────────────────────────────────
    await dashboardPage.logout();
    await page.getByRole('heading', { name: 'Sign in to your account' }).waitFor({
      state: 'visible',
      timeout: 15000,
    });

    // ── Step 9: Unblocked member can login successfully ────────────────────
    // Login form is already showing after owner logout — no goto() needed.
    await loginPage.login(member.email, member.password);
    await page.waitForURL('**/dashboard', { timeout: 15000 });

    // Verify dashboard loaded
    const sidebar = page.getByRole('navigation', { name: 'Main navigation' });
    await expect(sidebar).toBeVisible({ timeout: 10000 });
  });
});
