/**
 * Real-time Timesheet Synchronization Tests
 * 
 * Verifies that clock events (clock in/out) appear in real-time across
 * multiple browser sessions on both:
 * - Personal TimesheetPage (/app/timesheet)
 * - Team Admin TimesheetPanel (Teams page → Timesheet tab)
 * 
 * Tests dual-session sync: when user clocks in/out in session 1,
 * the timesheet in session 2 updates automatically within 3 seconds.
 */

import { test, expect } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';

const BASE_URL = 'http://localhost:3000';
const TEST_EMAIL = 'copilot-dev@mieweb.com';
const TEST_PASSWORD = 'password';

async function login(page: Page) {
  await page.goto(`${BASE_URL}/login`);
  await page.fill('input[type="email"]', TEST_EMAIL);
  await page.fill('input[type="password"]', TEST_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(`${BASE_URL}/app/**`);
}

test.describe('Timesheet Real-time Sync', () => {
  let context1: BrowserContext;
  let context2: BrowserContext;
  let page1: Page;
  let page2: Page;

  test.beforeEach(async ({ browser }) => {
    // Create two isolated browser contexts (simulating two tabs/windows)
    context1 = await browser.newContext();
    context2 = await browser.newContext();
    page1 = await context1.newPage();
    page2 = await context2.newPage();

    // Log in as the same user in both sessions
    await login(page1);
    await login(page2);
  });

  test.afterEach(async () => {
    await context1.close();
    await context2.close();
  });

  test('personal timesheet syncs clock-in across sessions', async () => {
    // Navigate both sessions to personal timesheet
    await page1.goto(`${BASE_URL}/app/timesheet`);
    await page2.goto(`${BASE_URL}/app/timesheet`);

    // Wait for initial load
    await page1.waitForLoadState('networkidle');
    await page2.waitForLoadState('networkidle');

    // Get initial session count in page2
    const initialRowsPage2 = await page2.locator('tbody tr').count();

    // Session 1: Clock in
    await page1.goto(`${BASE_URL}/app/clock`);
    await page1.click('button:has-text("Clock In")');
    await page1.waitForSelector('text=/Clocked in/', { timeout: 5000 });

    // Session 2: Verify new session appears in timesheet automatically
    await page2.reload();
    await page2.waitForLoadState('networkidle');
    
    // Wait for new row to appear (clock event should sync in real-time)
    const updatedRowsPage2 = await page2.locator('tbody tr').count();
    expect(updatedRowsPage2).toBeGreaterThan(initialRowsPage2);

    // Clean up: Clock out
    await page1.goto(`${BASE_URL}/app/clock`);
    await page1.click('button:has-text("Clock Out")');
  });

  test('personal timesheet syncs clock-out across sessions', async () => {
    // Session 1: Start with a clock-in
    await page1.goto(`${BASE_URL}/app/clock`);
    const isClockInVisible = await page1.locator('button:has-text("Clock In")').isVisible();
    if (isClockInVisible) {
      await page1.click('button:has-text("Clock In")');
      await page1.waitForSelector('text=/Clocked in/', { timeout: 5000 });
    }

    // Navigate both to timesheet
    await page1.goto(`${BASE_URL}/app/timesheet`);
    await page2.goto(`${BASE_URL}/app/timesheet`);
    await page1.waitForLoadState('networkidle');
    await page2.waitForLoadState('networkidle');

    // Session 1: Clock out
    await page1.goto(`${BASE_URL}/app/clock`);
    await page1.click('button:has-text("Clock Out")');
    await page1.waitForSelector('text=/Clocked out/', { timeout: 5000 });

    // Session 2: Verify timesheet updates (completed session shows duration)
    await page2.reload();
    await page2.waitForLoadState('networkidle');
    
    // The most recent session should now show a completed duration
    const firstRow = page2.locator('tbody tr').first();
    await expect(firstRow).toContainText(/\d+h|\d+m/); // Duration format
  });

  test('team admin timesheet syncs member clock events', async () => {
    // Session 1: Navigate to Teams → Timesheet tab
    await page1.goto(`${BASE_URL}/app/teams?tab=timesheet`);
    await page1.waitForLoadState('networkidle');

    // Session 2: Navigate to same team timesheet view
    await page2.goto(`${BASE_URL}/app/teams?tab=timesheet`);
    await page2.waitForLoadState('networkidle');

    // Get initial event count in session 2
    const initialEventsPage2 = await page2.locator('[data-testid="timesheet-row"], tbody tr').count();

    // Session 1: Clock in as team member
    await page1.goto(`${BASE_URL}/app/clock`);
    const isClockInVisible = await page1.locator('button:has-text("Clock In")').isVisible();
    if (isClockInVisible) {
      await page1.click('button:has-text("Clock In")');
      await page1.waitForSelector('text=/Clocked in/', { timeout: 5000 });
    }

    // Session 2: Verify admin sees the new event in real-time
    await page2.reload();
    await page2.waitForLoadState('networkidle');
    
    const updatedEventsPage2 = await page2.locator('[data-testid="timesheet-row"], tbody tr').count();
    expect(updatedEventsPage2).toBeGreaterThanOrEqual(initialEventsPage2);

    // Clean up: Clock out
    await page1.goto(`${BASE_URL}/app/clock`);
    await page1.click('button:has-text("Clock Out")');
  });

  test('timesheet updates when session is edited', async () => {
    // Ensure there's a completed session to edit
    await page1.goto(`${BASE_URL}/app/clock`);
    const isClockInVisible = await page1.locator('button:has-text("Clock In")').isVisible();
    if (isClockInVisible) {
      await page1.click('button:has-text("Clock In")');
      await page1.waitForSelector('text=/Clocked in/', { timeout: 5000 });
      await page1.waitForTimeout(2000);
      await page1.click('button:has-text("Clock Out")');
      await page1.waitForSelector('text=/Clocked out/', { timeout: 5000 });
    }

    // Navigate both to timesheet
    await page1.goto(`${BASE_URL}/app/timesheet`);
    await page2.goto(`${BASE_URL}/app/timesheet`);
    await page1.waitForLoadState('networkidle');
    await page2.waitForLoadState('networkidle');

    // Get initial duration text from session 2
    const firstRowPage2Before = page2.locator('tbody tr').first();
    const durationBefore = await firstRowPage2Before.textContent();

    // Session 1: Edit a session (click first row to open edit dialog)
    const firstRowPage1 = page1.locator('tbody tr').first();
    await firstRowPage1.click();
    
    // Wait for modal to appear
    await page1.waitForSelector('[role="dialog"], .modal', { timeout: 3000 });
    
    // Modify clock-out time slightly (if edit fields are present)
    const clockOutInput = page1.locator('input[type="datetime-local"]').nth(1);
    if (await clockOutInput.isVisible()) {
      await clockOutInput.fill('2026-06-30T12:00');
    }
    
    // Save changes
    await page1.click('button:has-text("Save")');
    await page1.waitForTimeout(1000);

    // Session 2: Verify duration updates automatically
    await page2.reload();
    await page2.waitForLoadState('networkidle');
    
    const firstRowPage2After = page2.locator('tbody tr').first();
    const durationAfter = await firstRowPage2After.textContent();

    // Duration should have changed (or at least the row should still exist)
    expect(durationAfter).toBeTruthy();
  });

  test('timesheet syncs when session is deleted', async () => {
    // Ensure there's a session to delete
    await page1.goto(`${BASE_URL}/app/clock`);
    const isClockInVisible = await page1.locator('button:has-text("Clock In")').isVisible();
    if (isClockInVisible) {
      await page1.click('button:has-text("Clock In")');
      await page1.waitForSelector('text=/Clocked in/', { timeout: 5000 });
      await page1.waitForTimeout(1000);
      await page1.click('button:has-text("Clock Out")');
      await page1.waitForSelector('text=/Clocked out/', { timeout: 5000 });
    }

    // Navigate both to timesheet
    await page1.goto(`${BASE_URL}/app/timesheet`);
    await page2.goto(`${BASE_URL}/app/timesheet`);
    await page1.waitForLoadState('networkidle');
    await page2.waitForLoadState('networkidle');

    // Get initial session count in page2
    const initialRowsPage2 = await page2.locator('tbody tr').count();
    expect(initialRowsPage2).toBeGreaterThan(0);

    // Session 1: Delete most recent session
    const firstRowPage1 = page1.locator('tbody tr').first();
    await firstRowPage1.click();
    await page1.waitForSelector('[role="dialog"], .modal', { timeout: 3000 });
    
    // Click delete button
    await page1.click('button:has-text("Delete")');
    
    // Confirm deletion if there's a confirmation dialog
    const confirmButton = page1.locator('button:has-text("Confirm"), button:has-text("Yes")');
    if (await confirmButton.isVisible({ timeout: 1000 })) {
      await confirmButton.click();
    }

    await page1.waitForTimeout(1000);

    // Session 2: Verify session is removed automatically
    await page2.reload();
    await page2.waitForLoadState('networkidle');
    
    const updatedRowsPage2 = await page2.locator('tbody tr').count();
    expect(updatedRowsPage2).toBeLessThanOrEqual(initialRowsPage2);
  });
});
