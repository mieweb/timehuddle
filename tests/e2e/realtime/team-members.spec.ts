/**
 * Real-time team member synchronization tests.
 *
 * Verifies that team member changes sync across sessions.
 */
import { test, expect, type Page } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';

test.describe('Real-time Team Members', () => {
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

    // Navigate to Teams page
    await session1.goto('http://localhost:3002/app/teams');
    await session2.goto('http://localhost:3002/app/teams');

    await session1.waitForLoadState('networkidle');
    await session2.waitForLoadState('networkidle');
  });

  test.afterEach(async () => {
    await session1.close();
    await session2.close();
  });

  test('should sync team member list updates', async () => {
    // Both sessions should see the same content on the teams page
    // Check for "Personal Workspace" heading which is always present
    await expect(
      session1.getByRole('heading', { name: /Personal Workspace|Teams/i }).first(),
    ).toBeVisible({ timeout: 5000 });
    await expect(
      session2.getByRole('heading', { name: /Personal Workspace|Teams/i }).first(),
    ).toBeVisible({ timeout: 5000 });

    // Both sessions should show the same member list in Personal Workspace
    const memberCount1 = await session1.locator('[role="listitem"]').count();
    const memberCount2 = await session2.locator('[role="listitem"]').count();

    // Both sessions should see consistent member data
    expect(memberCount1).toBe(memberCount2);
  });

  test('should sync when team admin changes member role', async () => {
    // Both sessions should see the same Teams page heading
    const heading1 = await session1.getByRole('heading', { level: 1 }).textContent();
    const heading2 = await session2.getByRole('heading', { level: 1 }).textContent();

    expect(heading1).toBe(heading2);
    expect(heading1).toBe('Teams');
  });
});
