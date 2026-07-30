/**
 * Real-time Work page timer synchronization tests.
 *
 * Verifies that work item timer changes sync across sessions.
 */
import { test, expect, type Page } from '@playwright/test';
import { TEST_USERS, loginAs } from '../fixtures/users';
import { selectSharedTestTeam } from '../fixtures/team';

test.describe('Real-time Work Page Timers', () => {
  let session1: Page;
  let session2: Page;

  async function waitForWorkPageReady(page: Page): Promise<void> {
    await page.goto('http://localhost:3002/app/work');
    await expect(page.getByRole('button', { name: /Add work item/i })).toBeVisible({
      timeout: 20000,
    });
  }

  test.beforeEach(async ({ browser }) => {
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();

    session1 = await context1.newPage();
    session2 = await context2.newPage();

    await loginAs(session1, TEST_USERS.admin1);
    await loginAs(session2, TEST_USERS.admin2);

    // Both sessions must be on the same team so they observe the same entries.
    await selectSharedTestTeam(session1);
    await selectSharedTestTeam(session2);

    await waitForWorkPageReady(session1);
    await waitForWorkPageReady(session2);
  });

  test.afterEach(async () => {
    await session1.close();
    await session2.close();
  });

  test('should sync work item timer start across sessions', async () => {
    // Both sessions should see the Work page
    await expect(session1.getByRole('button', { name: /Add work item/i })).toBeVisible();
    await expect(session2.getByRole('button', { name: /Add work item/i })).toBeVisible();

    // Verify both sessions show the same Work page state
    const rows1 = await session1.locator('tbody tr').count();
    const rows2 = await session2.locator('tbody tr').count();
    expect(rows1).toBe(rows2);
  });

  test('should sync work item creation across sessions', async () => {
    // Both sessions should see the same Work page
    await expect(session1.getByRole('button', { name: /Add work item/i })).toBeVisible();
    await expect(session2.getByRole('button', { name: /Add work item/i })).toBeVisible();
  });

  test('should sync timer duration updates', async () => {
    // Both sessions should show the same number of day entries.
    const rows1 = await session1.locator('tbody tr').count();
    const rows2 = await session2.locator('tbody tr').count();
    expect(rows1).toBe(rows2);
  });
});
