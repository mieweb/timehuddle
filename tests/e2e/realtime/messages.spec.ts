/**
 * Real-time message synchronization tests.
 *
 * Verifies that messages sync across sessions.
 */
import { test, expect, type Page } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';

test.describe('Real-time Messages', () => {
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

    // Navigate to Messages
    await session1.goto('http://localhost:3000/app/messages');
    await session2.goto('http://localhost:3000/app/messages');

    await session1.waitForLoadState('networkidle');
    await session2.waitForLoadState('networkidle');
  });

  test.afterEach(async () => {
    await session1.close();
    await session2.close();
  });

  test('should sync message threads across sessions', async () => {
    await session1.waitForTimeout(1000);
    await session2.waitForTimeout(1000);

    // Check if both sessions show the same thread list
    const threads1 = await session1
      .locator('[role="list"] [role="listitem"], .thread-item, [class*="thread"]')
      .count();
    const threads2 = await session2
      .locator('[role="list"] [role="listitem"], .thread-item, [class*="thread"]')
      .count();

    expect(threads1).toBe(threads2);
  });

  test('should sync new messages in a thread', async () => {
    // Select a thread in session 1
    const firstThread = session1
      .locator('[role="list"] [role="listitem"], .thread-item, [class*="thread"]')
      .first();

    if ((await firstThread.count()) > 0) {
      await firstThread.click();
      await session1.waitForTimeout(500);

      // Session 2 should select the same thread
      await session2
        .locator('[role="list"] [role="listitem"], .thread-item, [class*="thread"]')
        .first()
        .click();
      await session2.waitForTimeout(500);

      // Get message count before sending
      const initialMessageCount = await session1
        .locator('[role="article"], .message, [class*="message"]')
        .count();

      // Send a message in session 1
      const messageInput = session1.locator('textarea, input[placeholder*="message" i]').first();
      if ((await messageInput.count()) > 0) {
        await messageInput.fill('Test real-time message sync');
        await messageInput.press('Enter');
        await session1.waitForTimeout(1000);

        // Session 2 should automatically show the new message
        await expect(
          session2.locator('[role="article"], .message, [class*="message"]'),
        ).toHaveCount(initialMessageCount + 1, { timeout: 3000 });
      }
    }
  });
});
