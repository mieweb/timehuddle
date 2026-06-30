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
    // Create two separate browser contexts (like two browser tabs or windows)
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();

    session1 = await context1.newPage();
    session2 = await context2.newPage();

    // Log in as the same user in both sessions
    const loginPage1 = new LoginPage(session1);
    const loginPage2 = new LoginPage(session2);

    await loginPage1.goto();
    await loginPage1.loginWithEmail('admin@test.com', 'password123');
    await expect(session1).toHaveURL(/\/app\//);

    await loginPage2.goto();
    await loginPage2.loginWithEmail('admin@test.com', 'password123');
    await expect(session2).toHaveURL(/\/app\//);

    // Navigate both sessions to the Tickets page
    await session1.goto('/app/tickets');
    await session2.goto('/app/tickets');

    // Wait for page load
    await session1.waitForLoadState('networkidle');
    await session2.waitForLoadState('networkidle');
  });

  test.afterEach(async () => {
    await session1.close();
    await session2.close();
  });

  test('should sync timer start across sessions', async () => {
    // Find a ticket with a start button (no timer running)
    const startButton1 = session1.locator('button[aria-label*="Start timer"]').first();
    await expect(startButton1).toBeVisible();

    // Get the ticket title to identify it in session 2
    const ticketRow1 = startButton1.locator('..').locator('..');
    const ticketTitle = await ticketRow1.locator('button').first().textContent();

    // Start the timer in session 1
    await startButton1.click();

    // Wait for session 1 to show the stop button
    await expect(session1.locator(`button[aria-label*="Stop timer"][aria-label*="${ticketTitle}"]`)).toBeVisible({
      timeout: 5000,
    });

    // Session 2 should automatically show the stop button (real-time update)
    await expect(session2.locator(`button[aria-label*="Stop timer"][aria-label*="${ticketTitle}"]`)).toBeVisible({
      timeout: 3000,
    });
  });

  test('should sync timer stop across sessions', async () => {
    // Find a ticket with a stop button (timer already running)
    const stopButton1 = session1.locator('button[aria-label*="Stop timer"]').first();
    
    // If no timer is running, start one first
    if ((await stopButton1.count()) === 0) {
      const startButton1 = session1.locator('button[aria-label*="Start timer"]').first();
      await startButton1.click();
      await session1.waitForTimeout(1000);
    }

    await expect(stopButton1).toBeVisible();

    // Get the ticket title
    const ticketRow1 = stopButton1.locator('..').locator('..');
    const ticketTitle = await ticketRow1.locator('button').first().textContent();

    // Stop the timer in session 1
    await stopButton1.click();

    // Wait for session 1 to show the start button
    await expect(session1.locator(`button[aria-label*="Start timer"][aria-label*="${ticketTitle}"]`)).toBeVisible({
      timeout: 5000,
    });

    // Session 2 should automatically show the start button (real-time update)
    await expect(session2.locator(`button[aria-label*="Start timer"][aria-label*="${ticketTitle}"]`)).toBeVisible({
      timeout: 3000,
    });
  });

  test('should sync timer switch between tickets', async () => {
    // Start timer on first ticket
    const startButton1 = session1.locator('button[aria-label*="Start timer"]').first();
    await startButton1.click();
    await session1.waitForTimeout(1000);

    // Find second ticket and start its timer (should stop the first)
    const startButton2 = session1.locator('button[aria-label*="Start timer"]').first();
    const ticketTitle2 = await startButton2.locator('..').locator('..').locator('button').first().textContent();
    await startButton2.click();

    // Session 2 should show the second ticket with a stop button
    await expect(session2.locator(`button[aria-label*="Stop timer"][aria-label*="${ticketTitle2}"]`)).toBeVisible({
      timeout: 3000,
    });

    // Session 2 should show only ONE stop button (first timer auto-stopped)
    const stopButtons = session2.locator('button[aria-label*="Stop timer"]');
    await expect(stopButtons).toHaveCount(1, { timeout: 3000 });
  });
});
