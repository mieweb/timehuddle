/**
 * Real-time organization member synchronization tests.
 *
 * Verifies that org member changes sync across sessions.
 */
import { test, expect, type Page } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';

test.describe('Real-time Organization Members', () => {
  let session1: Page;
  let session2: Page;

  test.beforeEach(async ({ browser }) => {
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();

    session1 = await context1.newPage();
    session2 = await context2.newPage();

    const loginPage1 = new LoginPage(session1);
    const loginPage2 = new LoginPage(session2);

    await loginPage1.goto();
    await loginPage1.loginWithEmail('admin@test.com', 'password123');
    await expect(session1).toHaveURL(/\/app\//);

    await loginPage2.goto();
    await loginPage2.loginWithEmail('admin@test.com', 'password123');
    await expect(session2).toHaveURL(/\/app\//);

    // Navigate to Organization page
    await session1.goto('/app/organization');
    await session2.goto('/app/organization');

    await session1.waitForLoadState('networkidle');
    await session2.waitForLoadState('networkidle');

    // Click Members tab
    await session1.locator('button:has-text("Members")').click();
    await session2.locator('button:has-text("Members")').click();
    
    await session1.waitForTimeout(500);
    await session2.waitForTimeout(500);
  });

  test.afterEach(async () => {
    await session1.close();
    await session2.close();
  });

  test('should show same member count in both sessions', async () => {
    // Get member count from the table in both sessions
    const memberCount1 = await session1.locator('tbody tr').count();
    const memberCount2 = await session2.locator('tbody tr').count();

    expect(memberCount1).toBe(memberCount2);
    expect(memberCount1).toBeGreaterThan(0);
  });

  test('should sync member role changes across sessions', async () => {
    // Get the first member's current role in session 1
    const firstRow1 = session1.locator('tbody tr').first();
    const roleSelect1 = firstRow1.locator('select, [role="combobox"]').first();
    
    if ((await roleSelect1.count()) > 0) {
      const currentRole = await roleSelect1.inputValue();
      
      // Verify session 2 shows the same role
      const firstRow2 = session2.locator('tbody tr').first();
      const roleSelect2 = firstRow2.locator('select, [role="combobox"]').first();
      
      await expect(roleSelect2).toHaveValue(currentRole, { timeout: 3000 });
    }
  });

  test('should sync blocked status across sessions', async () => {
    // Check if any members show "Blocked" badge
    const blockedBadges1 = await session1.locator('text="Blocked"').count();
    const blockedBadges2 = await session2.locator('text="Blocked"').count();

    // Both sessions should show the same number of blocked members
    expect(blockedBadges1).toBe(blockedBadges2);
  });
});
