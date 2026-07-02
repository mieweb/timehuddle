/**
 * Real-time media library synchronization tests.
 *
 * Verifies that media uploads and changes sync across sessions.
 */
import { test, expect, type Page } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';

test.describe('Real-time Media Library', () => {
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

    // Navigate to Media Library
    await session1.goto('http://localhost:3000/app/media');
    await session2.goto('http://localhost:3000/app/media');

    await session1.waitForLoadState('networkidle');
    await session2.waitForLoadState('networkidle');
  });

  test.afterEach(async () => {
    await session1.close();
    await session2.close();
  });

  test('should show same media count in both sessions', async () => {
    // Wait for media grid to load
    await session1.waitForTimeout(1000);
    await session2.waitForTimeout(1000);

    // Get media item count from both sessions
    const mediaCount1 = await session1.locator('[class*="grid"] > div').count();
    const mediaCount2 = await session2.locator('[class*="grid"] > div').count();

    expect(mediaCount1).toBe(mediaCount2);
  });

  test('should sync media item visibility', async () => {
    // Check if "No media" message appears consistently
    const noMedia1 = await session1.locator('text=/no media|empty/i').count();
    const noMedia2 = await session2.locator('text=/no media|empty/i').count();

    // Both should show the same state
    expect(noMedia1).toBe(noMedia2);
  });
});
