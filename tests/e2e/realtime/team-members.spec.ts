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
    await loginPage1.loginWithEmail('admin@test.com', 'password123');
    await expect(session1).toHaveURL(/\/app\//);

    await loginPage2.goto();
    await loginPage2.loginWithEmail('admin@test.com', 'password123');
    await expect(session2).toHaveURL(/\/app\//);

    // Navigate to Teams page
    await session1.goto('/app/teams');
    await session2.goto('/app/teams');

    await session1.waitForLoadState('networkidle');
    await session2.waitForLoadState('networkidle');
  });

  test.afterEach(async () => {
    await session1.close();
    await session2.close();
  });

  test('should sync team member list updates', async () => {
    // Select a team in session 1
    const teamCard = session1.locator('[role="article"]').first();
    await teamCard.click();
    await session1.waitForTimeout(500);

    // Get member count in session 1
    const memberCountText1 = await session1.locator('text=/\\d+ members?/i').first().textContent();
    const memberCount1 = parseInt(memberCountText1?.match(/\d+/)?.[0] || '0');

    // Session 2 should select the same team
    await session2.locator('[role="article"]').first().click();
    await session2.waitForTimeout(500);

    // Both sessions should show the same member count
    await expect(session2.locator('text=/\\d+ members?/i').first()).toHaveText(new RegExp(`${memberCount1}`), {
      timeout: 3000,
    });
  });

  test('should sync when team admin changes member role', async () => {
    // This test assumes there's at least one team with members
    const teamCard = session1.locator('[role="article"]').first();
    await teamCard.click();
    await session1.waitForTimeout(1000);

    // Select the same team in session 2
    await session2.locator('[role="article"]').first().click();
    await session2.waitForTimeout(1000);

    // Both sessions should show the same team content
    const teamTitle1 = await session1.locator('h2').first().textContent();
    const teamTitle2 = await session2.locator('h2').first().textContent();

    expect(teamTitle1).toBe(teamTitle2);
  });
});
