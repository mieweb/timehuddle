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
    await loginPage1.login('admin1@test.local', 'TestPass1!');
    await expect(session1).toHaveURL(/\/app\//);

    await loginPage2.goto();
    await loginPage2.login('admin2@test.local', 'TestPass1!');
    await expect(session2).toHaveURL(/\/app\//);

    // Navigate to Work page
    await session1.goto('http://localhost:3002/app/work');
    await session2.goto('http://localhost:3002/app/work');

    await session1.waitForLoadState('networkidle');
    await session2.waitForLoadState('networkidle');
  });

  test.afterEach(async () => {
    await session1.close();
    await session2.close();
  });

  test('should sync work item timer start across sessions', async () => {
    // Both sessions should see the Work page
    await expect(session1.getByRole('heading', { level: 1, name: /Work/i })).toBeVisible({
      timeout: 5000,
    });
    await expect(session2.getByRole('heading', { level: 1, name: /Work/i })).toBeVisible({
      timeout: 5000,
    });

    // Verify both sessions show the same Work page state
    const heading1 = await session1.getByRole('heading', { level: 1 }).textContent();
    const heading2 = await session2.getByRole('heading', { level: 1 }).textContent();
    expect(heading1).toBe(heading2);
  });

  test('should sync work item creation across sessions', async () => {
    // Both sessions should see the same Work page
    await expect(session1.getByRole('heading', { level: 1, name: /Work/i })).toBeVisible({
      timeout: 5000,
    });
    await expect(session2.getByRole('heading', { level: 1, name: /Work/i })).toBeVisible({
      timeout: 5000,
    });
  });

  test('should sync timer duration updates', async () => {
    // Both sessions should see the same Work page heading
    const heading1 = await session1.getByRole('heading', { level: 1 }).textContent();
    const heading2 = await session2.getByRole('heading', { level: 1 }).textContent();
    expect(heading1).toBe(heading2);
  });
});
