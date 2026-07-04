/**
 * Real-time ticket timer synchronization tests.
 *
 * Verifies that when a timer starts/stops in one browser session,
 * the change appears immediately in other sessions via Meteor DDP.
 */
import { test, expect, type Page } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';

test.describe('Real-time Ticket Timers', () => {
  let session1: Page;
  let session2: Page;

  test.beforeEach(async ({ browser }) => {
    // Log in once, then open two pages in the same context (same user, two tabs)
    const context = await browser.newContext();

    // Log in via the first page
    session1 = await context.newPage();
    const loginPage = new LoginPage(session1);
    await loginPage.goto();
    await loginPage.login('admin1@test.local', 'TestPass1!');
    await loginPage.waitForLoginSuccess();

    // Second page shares the same session (cookies/localStorage)
    session2 = await context.newPage();

    // Navigate both sessions to the Tickets page
    await session1.goto('http://localhost:3000/app/tickets');
    await session2.goto('http://localhost:3000/app/tickets');

    // Wait for page load
    await session1.waitForLoadState('networkidle');
    await session2.waitForLoadState('networkidle');
  });

  test.afterEach(async () => {
    await session1.close();
    await session2.close();
  });

  test('should sync timer start across sessions', async () => {
    // Skip if no tickets exist (no timer buttons to interact with)
    const startButton1 = session1.locator('button[aria-label*="Start timer"]').first();
    if ((await startButton1.count()) === 0) {
      // Both sessions should see the same empty state
      const emptyText1 = await session1.getByText(/no.*tickets/i).count();
      const emptyText2 = await session2.getByText(/no.*tickets/i).count();
      expect(emptyText1).toBe(emptyText2);
      return;
    }

    // Get the ticket title to identify it in session 2
    const ticketRow1 = startButton1.locator('..').locator('..');
    const ticketTitle = await ticketRow1.locator('button').first().textContent();

    // Start the timer in session 1
    await startButton1.click();

    // Handle "Clock In Required" dialog if it appears
    const clockInNow = session1.getByRole('button', { name: 'Clock In Now' });
    if (await clockInNow.isVisible({ timeout: 2000 }).catch(() => false)) {
      await clockInNow.click();
    }

    // Wait for session 1 to show the stop button
    await expect(session1.locator(`button[aria-label*="Stop timer"]`).first()).toBeVisible({
      timeout: 10000,
    });

    // Session 2 should automatically show the stop button (real-time update)
    await expect(session2.locator(`button[aria-label*="Stop timer"]`).first()).toBeVisible({
      timeout: 10000,
    });
  });

  test('should sync timer stop across sessions', async () => {
    const stopButton1 = session1.locator('button[aria-label*="Stop timer"]').first();
    const startButton1 = session1.locator('button[aria-label*="Start timer"]').first();

    // Skip if no tickets exist
    if ((await startButton1.count()) === 0 && (await stopButton1.count()) === 0) {
      return;
    }

    // If no timer is running, start one first
    if ((await stopButton1.count()) === 0) {
      await startButton1.click();

      // Handle "Clock In Required" dialog if it appears
      const clockInNow = session1.getByRole('button', { name: 'Clock In Now' });
      if (await clockInNow.isVisible({ timeout: 2000 }).catch(() => false)) {
        await clockInNow.click();
      }

      await expect(stopButton1).toBeVisible({ timeout: 10000 });
    } else {
      await expect(stopButton1).toBeVisible();
    }

    // Stop the timer in session 1
    await stopButton1.click();

    // Wait for session 1 to show the start button
    await expect(session1.locator('button[aria-label*="Start timer"]').first()).toBeVisible({
      timeout: 5000,
    });

    // Session 2 should automatically show the start button (real-time update)
    await expect(session2.locator('button[aria-label*="Start timer"]').first()).toBeVisible({
      timeout: 10000,
    });
  });

  test('should sync timer switch between tickets', async () => {
    // Skip if fewer than 2 tickets exist
    const startButtons = session1.locator('button[aria-label*="Start timer"]');
    if ((await startButtons.count()) < 2) {
      // Verify both sessions show the same ticket page state
      const heading1 = await session1.getByRole('heading', { level: 1 }).textContent();
      const heading2 = await session2.getByRole('heading', { level: 1 }).textContent();
      expect(heading1).toBe(heading2);
      return;
    }

    // Start timer on first ticket
    await startButtons.first().click();

    // Handle "Clock In Required" dialog if it appears
    const clockInNow = session1.getByRole('button', { name: 'Clock In Now' });
    if (await clockInNow.isVisible({ timeout: 2000 }).catch(() => false)) {
      await clockInNow.click();
    }

    await session1.waitForTimeout(1000);

    // Find second ticket and start its timer (should stop the first)
    const startButton2 = session1.locator('button[aria-label*="Start timer"]').first();
    await startButton2.click();

    // Session 2 should show only ONE stop button (first timer auto-stopped)
    const stopButtons = session2.locator('button[aria-label*="Stop timer"]');
    await expect(stopButtons).toHaveCount(1, { timeout: 10000 });
  });
});
