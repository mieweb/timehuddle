/**
 * Real-time Work page timer synchronization.
 *
 * The Work page subscribes to `timers.liveForUser` (WorkPage.tsx:410-418), so a
 * timer toggled in one tab must reach the other without a reload. Work items
 * are per-user, so both tabs are the *same* user in one browser context —
 * comparing two different users' Work pages proves nothing.
 *
 * Seeding goes through My Board, the only place that creates a ticket-backed
 * work item (M3 D1). Once the item exists, the Work page's own row button is
 * what these tests drive.
 */
import { test, expect, type Page, type BrowserContext } from '@playwright/test';

import { TEST_USERS, loginAs } from '../fixtures/users';
import { ClockPage } from '../pages/ClockPage';
import { TicketsPage } from '../pages/TicketsPage';

/** A single row of the Work page's day table, by work-item title. */
const workRow = (page: Page, title: string) =>
  page
    .getByRole('table', { name: /Work items for/ })
    .locator('tbody tr')
    .filter({ hasText: title });

async function openWorkPage(page: Page): Promise<void> {
  await page.goto('/app/work');
  await expect(page.getByRole('button', { name: /Add work item/i }).first()).toBeVisible({
    timeout: 20000,
  });
}

test.describe('Real-time Work Page Timers', () => {
  let context: BrowserContext;
  let session1: Page;
  let session2: Page;
  let clock1: ClockPage;
  let title: string;

  test.beforeEach(async ({ browser }) => {
    context = await browser.newContext();
    session1 = await context.newPage();
    await loginAs(session1, TEST_USERS.admin1);

    clock1 = new ClockPage(session1);
    await clock1.ensureClockedIn('Plan for a Work page timer test');

    // Seed one work item by running a ticket timer once from My Board.
    title = `Work Sync ${Date.now()}`;
    const tickets = new TicketsPage(session1);
    await tickets.goto();
    await tickets.createTicket(title);
    await tickets.moveToBoard(title);
    await tickets.startTimerButton(title).click();
    await expect(tickets.stopTimerButton(title)).toBeVisible({ timeout: 10000 });
    await tickets.stopTimerButton(title).click();
    await expect(tickets.startTimerButton(title)).toBeVisible({ timeout: 10000 });

    session2 = await context.newPage();
    await openWorkPage(session1);
    await openWorkPage(session2);
    await expect(workRow(session1, title)).toHaveCount(1);
    await expect(workRow(session2, title)).toHaveCount(1);
  });

  test.afterEach(async () => {
    await clock1?.ensureClockedOut().catch(() => {});
    await context?.close();
  });

  test('starting a work item timer marks it Running in the other tab', async () => {
    await workRow(session1, title).getByRole('button', { name: 'Start timer' }).click();

    await expect(workRow(session1, title).getByText('Running')).toBeVisible({ timeout: 10000 });
    await expect(workRow(session2, title).getByText('Running')).toBeVisible({ timeout: 10000 });
  });

  test('stopping it clears the Running badge in the other tab', async () => {
    await workRow(session1, title).getByRole('button', { name: 'Start timer' }).click();
    await expect(workRow(session2, title).getByText('Running')).toBeVisible({ timeout: 10000 });

    await workRow(session1, title).getByRole('button', { name: 'Stop timer' }).click();

    await expect(workRow(session1, title).getByText('Running')).toHaveCount(0, { timeout: 10000 });
    await expect(workRow(session2, title).getByText('Running')).toHaveCount(0, { timeout: 10000 });
  });

  test('a timer started from My Board shows up on an already-open Work page', async () => {
    const boardTab = await context.newPage();
    const tickets = new TicketsPage(boardTab);
    await tickets.goto();
    await tickets.switchToTab('my-board');
    await tickets.startTimerButton(title).click();

    // session2 has been sitting on /app/work the whole time — no reload here.
    await expect(workRow(session2, title).getByText('Running')).toBeVisible({ timeout: 10000 });

    await tickets.stopTimerButton(title).click();
    await expect(workRow(session2, title).getByText('Running')).toHaveCount(0, { timeout: 10000 });
    await boardTab.close();
  });
});
