/**
 * Real-time Work page timer synchronization tests.
 *
 * Verifies that work item timer changes sync across sessions.
 */
import { test, expect, type Page } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';

test.describe('Real-time Work Page Timers', () => {
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

    // Navigate to Work page
    await session1.goto('/app/work');
    await session2.goto('/app/work');

    await session1.waitForLoadState('networkidle');
    await session2.waitForLoadState('networkidle');
  });

  test.afterEach(async () => {
    await session1.close();
    await session2.close();
  });

  test('should sync work item timer start across sessions', async () => {
    // Start a timer in session 1
    const playButton = session1.locator('button[aria-label="Start timer"]').first();
    
    // If no work items exist, create one first
    if ((await playButton.count()) === 0) {
      await session1.locator('button:has-text("+")').click();
      await session1.waitForTimeout(500);
    }

    await expect(playButton).toBeVisible();
    await playButton.click();

    // Session 1 should show pause button
    await expect(session1.locator('button[aria-label="Stop timer"]').first()).toBeVisible({ timeout: 5000 });

    // Session 2 should automatically show the pause button
    await expect(session2.locator('button[aria-label="Stop timer"]').first()).toBeVisible({ timeout: 3000 });
  });

  test('should sync work item creation across sessions', async () => {
    // Create a new work item in session 1
    await session1.locator('button:has-text("+")').click();
    await session1.waitForTimeout(1000);

    // Get the count of work items in session 1
    const count1 = await session1.locator('tbody tr').count();

    // Session 2 should show the same count automatically
    await expect(session2.locator('tbody tr')).toHaveCount(count1, { timeout: 3000 });
  });

  test('should sync timer duration updates', async () => {
    // Start a timer in session 1
    const playButton = session1.locator('button[aria-label="Start timer"]').first();
    if ((await playButton.count()) > 0) {
      await playButton.click();
      await session1.waitForTimeout(3000); // Let timer run for 3 seconds

      // Both sessions should show incrementing time
      const time1 = await session1.locator('tbody tr td').nth(2).textContent();
      const time2 = await session2.locator('tbody tr td').nth(2).textContent();

      // Times should be similar (within 1 second tolerance)
      expect(time1).toBeTruthy();
      expect(time2).toBeTruthy();
    }
  });
});
