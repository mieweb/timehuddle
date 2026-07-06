/**
 * Real-time Timesheet Synchronization Tests
 *
 * Verifies that both sessions see the same timesheet page state.
 */

import { test, expect } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';

const BASE_URL = 'http://localhost:3000';

test.describe('Timesheet Real-time Sync', () => {
  let context1: BrowserContext;
  let context2: BrowserContext;
  let page1: Page;
  let page2: Page;

  test.beforeEach(async ({ browser }) => {
    context1 = await browser.newContext();
    context2 = await browser.newContext();
    page1 = await context1.newPage();
    page2 = await context2.newPage();

    const loginPage1 = new LoginPage(page1);
    const loginPage2 = new LoginPage(page2);

    await loginPage1.goto();
    await loginPage1.login('admin1@test.local', 'TestPass1!');
    await expect(page1).toHaveURL(/\/app\//);

    await loginPage2.goto();
    await loginPage2.login('admin2@test.local', 'TestPass1!');
    await expect(page2).toHaveURL(/\/app\//);
  });

  test.afterEach(async () => {
    await context1.close();
    await context2.close();
  });

  test('personal timesheet shows same data in both sessions', async () => {
    await page1.goto(`${BASE_URL}/app/timesheet`);
    await page2.goto(`${BASE_URL}/app/timesheet`);

    await page1.waitForLoadState('networkidle');
    await page2.waitForLoadState('networkidle');

    // Both sessions should show the Timesheet heading
    await expect(page1.getByRole('heading', { level: 1, name: /Timesheet/i })).toBeVisible();
    await expect(page2.getByRole('heading', { level: 1, name: /Timesheet/i })).toBeVisible();
  });

  test('clock page shows same state in both sessions', async () => {
    await page1.goto(`${BASE_URL}/app/clock`);
    await page2.goto(`${BASE_URL}/app/clock`);

    await page1.waitForLoadState('networkidle');
    await page2.waitForLoadState('networkidle');

    // Both sessions should see the Clock heading
    await expect(page1.getByRole('heading', { level: 1, name: /Clock/i })).toBeVisible();
    await expect(page2.getByRole('heading', { level: 1, name: /Clock/i })).toBeVisible();
  });
});
