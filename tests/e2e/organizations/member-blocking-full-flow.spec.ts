import { test, expect } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { DashboardPage } from '../pages/DashboardPage';
import { TEST_USERS } from '../fixtures/users';
import { memberAction, memberRow, openMembers } from '../fixtures/people';

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
    // Generous timeout: this flow does multiple hard navigations, each of which
    // remounts SessionProvider and forces a DDP reconnect that can be slow on a
    // cold backend.
    test.setTimeout(120000);

    const loginPage = new LoginPage(page);
    const dashboardPage = new DashboardPage(page);

    // ── Step 1: Owner logs in ──────────────────────────────────────────────
    await loginPage.goto();
    await loginPage.loginAs(owner);
    await page.waitForURL(/\/dashboard(\?|$)/, { timeout: 45000 });

    // ── Step 2: Navigate to org members ────────────────────────────────────
    await openMembers(page);
    await expect(memberRow(page, member.name).first()).toBeVisible({ timeout: 5000 });

    // Ensure member is NOT already blocked (clean state from previous run)
    if (
      await memberRow(page, member.name).first().getByText('Blocked', { exact: true }).isVisible()
    ) {
      await (await memberAction(page, member.name, 'Unblock')).click();
      await expect(
        memberRow(page, member.name).first().getByText('Blocked', { exact: true }),
      ).toBeHidden({ timeout: 10000 });
    }

    // ── Step 3: Block the member ───────────────────────────────────────────
    await (await memberAction(page, member.name, 'Block access')).click();

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
    await openMembers(page);
    const blockedRow = memberRow(page, member.name).first();
    await expect(blockedRow.getByText('Blocked', { exact: true })).toBeVisible({ timeout: 5000 });
    await expect(await memberAction(page, member.name, 'Unblock')).toBeVisible();
    await page.keyboard.press('Escape');

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
    await page.waitForURL(/\/dashboard(\?|$)/, { timeout: 45000 });

    // ── Step 7: Unblock the member ─────────────────────────────────────────
    await openMembers(page);
    await (await memberAction(page, member.name, 'Unblock')).click();
    await page.waitForTimeout(2000);

    // Reload and verify unblocked
    await openMembers(page);
    const restoredRow = memberRow(page, member.name).first();
    await expect(restoredRow.getByText('Blocked', { exact: true })).not.toBeVisible();
    await expect(await memberAction(page, member.name, 'Block access')).toBeVisible();
    await page.keyboard.press('Escape');

    // ── Step 8: Owner logs out ─────────────────────────────────────────────
    await dashboardPage.logout();
    await page.getByRole('heading', { name: 'Sign in to your account' }).waitFor({
      state: 'visible',
      timeout: 15000,
    });

    // ── Step 9: Unblocked member can login successfully ────────────────────
    // Login form is already showing after owner logout — no goto() needed.
    await loginPage.login(member.email, member.password);
    await page.waitForURL(/\/dashboard(\?|$)/, { timeout: 45000 });

    // Verify dashboard loaded
    const sidebar = page.getByRole('navigation', { name: 'Main navigation' });
    await expect(sidebar).toBeVisible({ timeout: 10000 });
  });
});
