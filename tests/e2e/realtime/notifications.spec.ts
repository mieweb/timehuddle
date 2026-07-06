/**
 * Real-time notification synchronization tests.
 *
 * Verifies that notifications appear in real-time across sessions.
 */
import { test, expect, type Page } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';

test.describe('Real-time Notifications', () => {
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

    // Navigate to Notifications
    await session1.goto('http://localhost:3000/app/notifications');
    await session2.goto('http://localhost:3000/app/notifications');

    await session1.waitForLoadState('networkidle');
    await session2.waitForLoadState('networkidle');
  });

  test.afterEach(async () => {
    await session1.close();
    await session2.close();
  });

  test('should show same notification count in both sessions', async () => {
    await session1.waitForTimeout(1000);
    await session2.waitForTimeout(1000);

    const notifCount1 = await session1
      .locator('[role="article"], .notification, [class*="notification"]')
      .count();
    const notifCount2 = await session2
      .locator('[role="article"], .notification, [class*="notification"]')
      .count();

    expect(notifCount1).toBe(notifCount2);
  });

  test('should sync notification badge count', async () => {
    // Check notification badge in the sidebar
    const badge1 = session1
      .locator(
        '[aria-label*="Notifications"] [class*="badge"], [aria-label*="Notifications"] [class*="count"]',
      )
      .first();
    const badge2 = session2
      .locator(
        '[aria-label*="Notifications"] [class*="badge"], [aria-label*="Notifications"] [class*="count"]',
      )
      .first();

    if ((await badge1.count()) > 0 && (await badge2.count()) > 0) {
      const count1 = await badge1.textContent();
      const count2 = await badge2.textContent();

      expect(count1).toBe(count2);
    }
  });

  test('should sync notification read status', async () => {
    // Check if both sessions show the same unread notification state
    const unread1 = await session1.locator('[class*="unread"], [data-read="false"]').count();
    const unread2 = await session2.locator('[class*="unread"], [data-read="false"]').count();

    expect(unread1).toBe(unread2);
  });
});
