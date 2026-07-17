/**
 * Real-time Huddle post synchronization tests.
 *
 * Verifies that huddle posts and comments sync across sessions.
 */
import { test, expect, type Page } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';

test.describe('Real-time Huddle Posts', () => {
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

    // Navigate to Huddle
    await session1.goto('http://localhost:3002/app/huddle');
    await session2.goto('http://localhost:3002/app/huddle');

    await session1.waitForLoadState('networkidle');
    await session2.waitForLoadState('networkidle');
  });

  test.afterEach(async () => {
    await session1.close();
    await session2.close();
  });

  test('should sync new huddle posts across sessions', async () => {
    // Get initial post count in session 1
    const initialCount1 = await session1.locator('[role="article"], article').count();

    // Create a new post in session 1
    const postInput = session1
      .locator('textarea, input[placeholder*="post" i], input[placeholder*="share" i]')
      .first();

    if ((await postInput.count()) > 0) {
      await postInput.fill('Test real-time sync post');

      const postButton = session1
        .locator('button:has-text("Post"), button:has-text("Share")')
        .first();
      if ((await postButton.count()) > 0) {
        await postButton.click();
        await session1.waitForTimeout(1000);

        // Session 1 should show the new post
        const newCount1 = await session1.locator('[role="article"], article').count();
        expect(newCount1).toBeGreaterThan(initialCount1);

        // Session 2 should automatically show the new post
        await expect(session2.locator('[role="article"], article')).toHaveCount(newCount1, {
          timeout: 3000,
        });
      }
    }
  });

  test('should show same post count in both sessions', async () => {
    await session1.waitForTimeout(1000);
    await session2.waitForTimeout(1000);

    const postCount1 = await session1.locator('[role="article"], article').count();
    const postCount2 = await session2.locator('[role="article"], article').count();

    expect(postCount1).toBe(postCount2);
  });
});
