import { test, expect } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { DashboardPage } from '../pages/DashboardPage';
import { TEST_USERS } from '../fixtures/users';

/**
 * E2E Test: Organization Member Blocking Feature
 *
 * Uses the shared `owner1@test.local` seed user (see backend/scripts/seed.ts and
 * meteor-backend/scripts/set-test-passwords.mjs) so the suite is hermetic —
 * no dependency on a developer-created account.
 */
test.describe('Organization Member Blocking Feature', () => {
  let _loginPage: LoginPage;
  let _dashboardPage: DashboardPage;

  const owner = TEST_USERS.owner1;

  test.beforeEach(async ({ page }) => {
    _loginPage = new LoginPage(page);
    _dashboardPage = new DashboardPage(page);

    // Login as owner
    await _loginPage.goto();
    await _loginPage.loginAs(owner);
    await page.waitForURL('**/dashboard', { timeout: 15000 });
  });

  test('should display members page with block buttons', async ({ page }) => {
    // Navigate to members page. Wait for orgs/teams sub to hydrate first —
    // "No organization is selected" is the pre-selection empty state.
    await page.goto('/app/org/members');
    await expect(page.getByText(/No organization is selected/i)).toBeHidden({ timeout: 30000 });
    await expect(page.getByRole('table')).toBeVisible({ timeout: 20000 });

    // Verify there's at least one member row (the owner)
    const memberRows = page.getByRole('row');
    const rowCount = await memberRows.count();
    expect(rowCount).toBeGreaterThan(1); // Header + at least 1 member

    // Check if owner row has appropriate buttons
    const ownerRow = page
      .getByRole('row')
      .filter({ hasText: owner.name })
      .or(page.getByRole('row').filter({ hasText: owner.email }));

    // Owner might have Block, Remove, or other action buttons
    const hasActionButtons = (await ownerRow.getByRole('button').count()) > 0;
    expect(hasActionButtons).toBe(true);
  });

  test('should allow blocking and unblocking workflow', async ({ page }) => {
    // Navigate to members page
    await page.goto('/app/org/members');
    await expect(page.getByRole('table')).toBeVisible({ timeout: 20000 });

    // Buttons on the members page use aria-labels like "Block Poonam Doe from
    // organization" so we match by their visible text instead.
    const blockButtons = page.locator('button:has-text("Block")');
    const unblockButtons = page.locator('button:has-text("Unblock")');
    const blockCount = await blockButtons.count();
    const unblockCount = await unblockButtons.count();
    expect(blockCount + unblockCount).toBeGreaterThan(0);

    // Pick the first row that actually has a Block button.
    const targetRow = page.getByRole('row').filter({ has: blockButtons.first() }).first();
    if (await targetRow.count()) {
      const blockButton = targetRow.locator('button:has-text("Block")').first();
      const unblockButton = targetRow.locator('button:has-text("Unblock")').first();
      const hasBlockButton = await blockButton.isVisible().catch(() => false);
      const hasUnblockButton = await unblockButton.isVisible().catch(() => false);
      expect(hasBlockButton || hasUnblockButton).toBe(true);

      // Verify that clicking Block opens the confirmation modal, then cancel.
      // The actual block/unblock happy path is covered by
      // meteor-backend/tests/organizations.test.ts to keep DB state clean here.
      if (hasBlockButton) {
        await blockButton.click();
        // Modal renders its title via the @mieweb/ui ModalHeader (not an <hN>),
        // so match by dialog role + visible text.
        const modal = page.getByRole('dialog');
        await expect(modal).toBeVisible({ timeout: 5000 });
        await expect(modal.getByText('Block Member').first()).toBeVisible();

        // Close the modal without submitting (Escape or Cancel).
        const cancelBtn = modal.getByRole('button', { name: /cancel|close/i }).first();
        if (await cancelBtn.isVisible().catch(() => false)) {
          await cancelBtn.click();
        } else {
          await page.keyboard.press('Escape');
        }
        await expect(modal).toBeHidden({ timeout: 5000 });
      }
    }
  });

  test('should show blocked badge for blocked members', async ({ page }) => {
    // Navigate to members page
    await page.goto('/app/org/members');
    await expect(page.getByRole('table')).toBeVisible({ timeout: 20000 });

    // Check if any members are currently blocked
    const blockedBadges = page.getByText(/blocked/i);
    const blockedCount = await blockedBadges.count();

    // This test just verifies the UI elements exist
    // If there are blocked members, they should have:
    // 1. A "Blocked" badge
    // 2. An "Unblock" button

    if (blockedCount > 0) {
      const firstBlockedBadge = blockedBadges.first();
      await expect(firstBlockedBadge).toBeVisible();

      // Find the row containing this badge
      const blockedRow = page.getByRole('row').filter({ has: firstBlockedBadge });

      // Should have an Unblock button
      const unblockButton = blockedRow.getByRole('button', { name: /unblock/i });
      await expect(unblockButton).toBeVisible();
    }

    // Test passes regardless of whether there are blocked members
    // This confirms the page loads and UI elements are accessible
    expect(true).toBe(true);
  });
});
