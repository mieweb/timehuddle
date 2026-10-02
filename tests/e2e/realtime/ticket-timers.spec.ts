/**
 * Real-time ticket timer synchronization.
 *
 * Two tabs, one user, one browser context. A timer started or stopped in tab 1
 * must appear in tab 2 without a reload — `useRunningTicket` subscribes to
 * `timers.liveForUser` over DDP and refetches on every collection change, and
 * this suite is the only thing that exercises that path end to end.
 *
 * Timers live on My Board only (M3 D1) and require an open shift (M3 D3), so
 * every test here clocks in first, creates its own ticket, and moves it to the
 * board. Nothing is conditional: a ticket the test just created is a ticket the
 * test can assume exists.
 */
import { test, expect, type Page, type BrowserContext } from '@playwright/test';

import { TEST_USERS, loginAs } from '../fixtures/users';
import { ClockPage } from '../pages/ClockPage';
import { TicketsPage } from '../pages/TicketsPage';

/** Opens a second tab in the same context and lands it on My Board. */
async function openBoardTab(context: BrowserContext): Promise<{
  page: Page;
  tickets: TicketsPage;
}> {
  const page = await context.newPage();
  const tickets = new TicketsPage(page);
  await tickets.goto();
  await tickets.switchToTab('my-board');
  return { page, tickets };
}

test.describe('Real-time Ticket Timers', () => {
  let context: BrowserContext;
  let session1: Page;
  let session2: Page;
  let board1: TicketsPage;
  let board2: TicketsPage;
  let clock1: ClockPage;

  test.beforeEach(async ({ browser }) => {
    context = await browser.newContext();
    session1 = await context.newPage();
    await loginAs(session1, TEST_USERS.admin1);

    clock1 = new ClockPage(session1);
    await clock1.ensureClockedIn('Plan for a real-time ticket timer test');

    board1 = new TicketsPage(session1);
  });

  test.afterEach(async () => {
    // Leave no timer running for the next spec in this serial suite.
    await clock1?.ensureClockedOut().catch(() => {});
    await context?.close();
  });

  /** Creates a ticket in tab 1, puts it on My Board, and mirrors tab 2 onto it. */
  async function seedBoardTicket(title: string) {
    await board1.goto();
    await board1.createTicket(title);
    await board1.moveToBoard(title);

    const second = await openBoardTab(context);
    session2 = second.page;
    board2 = second.tickets;
    await expect(board2.startTimerButton(title)).toBeVisible({ timeout: 10000 });
  }

  test('a timer started in one tab appears in the other', async () => {
    const title = `Realtime Start ${Date.now()}`;
    await seedBoardTicket(title);

    await board1.startTimerButton(title).click();

    await expect(board1.stopTimerButton(title)).toBeVisible({ timeout: 10000 });
    await expect(board2.stopTimerButton(title)).toBeVisible({ timeout: 10000 });
    await expect(board2.startTimerButton(title)).toHaveCount(0);
  });

  test('a timer stopped in one tab clears in the other', async () => {
    const title = `Realtime Stop ${Date.now()}`;
    await seedBoardTicket(title);

    await board1.startTimerButton(title).click();
    await expect(board2.stopTimerButton(title)).toBeVisible({ timeout: 10000 });

    await board1.stopTimerButton(title).click();

    await expect(board1.startTimerButton(title)).toBeVisible({ timeout: 10000 });
    await expect(board2.startTimerButton(title)).toBeVisible({ timeout: 10000 });
    await expect(board2.stopTimerButton(title)).toHaveCount(0);
  });

  test('switching tickets auto-stops the first, and the other tab agrees', async () => {
    const first = `Realtime Switch A ${Date.now()}`;
    const second = `Realtime Switch B ${Date.now()}`;

    await board1.goto();
    await board1.createTicket(first);
    await board1.createTicket(second);
    await board1.moveToBoard(first);
    await board1.switchToTab('tickets');
    await board1.moveToBoard(second);

    const other = await openBoardTab(context);
    session2 = other.page;
    board2 = other.tickets;
    await expect(board2.startTimerButton(first)).toBeVisible({ timeout: 10000 });

    await board1.startTimerButton(first).click();
    await expect(board2.stopTimerButton(first)).toBeVisible({ timeout: 10000 });

    // Starting the second timer closes the first server-side (M3 D5).
    await board1.startTimerButton(second).click();

    await expect(board2.stopTimerButton(second)).toBeVisible({ timeout: 10000 });
    await expect(board2.stopTimerButton(first)).toHaveCount(0);
    await expect(session2.getByRole('button', { name: /^Stop timer for/ })).toHaveCount(1);
  });
});
