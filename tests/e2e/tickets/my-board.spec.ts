/**
 * "My Board" personal priority view (Milestone 2.2) and the ticket timers it
 * starts (Milestone 3).
 *
 * My Board's ▶/⏸ is the *only* place in the app a ticket timer starts (M3 D1).
 * The main Tickets table has no timer control at all — `unified-table.spec.ts`
 * asserts its absence from the row menu.
 */
import { test, expect } from '@playwright/test';

import { TEST_USERS, loginAs } from '../fixtures/users';
import { ClockPage } from '../pages/ClockPage';
import { TicketsPage } from '../pages/TicketsPage';

test.describe('My Board', () => {
  let tickets: TicketsPage;

  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USERS.owner1);
    tickets = new TicketsPage(page);
    await tickets.goto();
  });

  test('moves a selected ticket to My Board and back', async () => {
    const title = `E2E My Board ${Date.now()}`;
    await tickets.createTicket(title);

    await tickets.selectTicket(title);
    await expect(tickets.moveToBoardButton).toBeVisible();
    await tickets.moveToBoardButton.click();

    await tickets.switchToTab('my-board');
    const boardRow = tickets.rowByTitle(title);
    await expect(boardRow).toBeVisible();

    // The board row has the extra ▶/⏸ column; the main table never does.
    await expect(tickets.timerButtonForRow(title)).toBeVisible();

    await tickets.selectTicket(title);
    await expect(tickets.removeFromBoardButton).toBeVisible();
    await tickets.removeFromBoardButton.click();
    await expect(boardRow).toHaveCount(0);

    // Still present, unselected, back on the Tickets tab.
    await tickets.switchToTab('tickets');
    await expect(tickets.rowByTitle(title)).toBeVisible();
    await expect(tickets.moveToBoardButton).toHaveCount(0);
  });

  test('bulk action bar shows Delete, static Archive/Close Issues, and the contextual board button', async () => {
    const title = `E2E Bulk Bar ${Date.now()}`;
    await tickets.createTicket(title);
    await tickets.selectTicket(title);

    await expect(tickets.bulkDeleteButton).toBeVisible();
    await expect(tickets.bulkDeleteButton).toBeEnabled();
    await expect(tickets.archiveButton).toBeVisible();
    await expect(tickets.archiveButton).toBeDisabled();
    await expect(tickets.closeIssuesButton).toBeVisible();
    await expect(tickets.closeIssuesButton).toBeDisabled();
    await expect(tickets.moveToBoardButton).toBeVisible();

    await tickets.deselectAllButton.click();
    await expect(tickets.bulkDeleteButton).toHaveCount(0);
  });

  test('bulk deletes selected tickets via the confirmation modal', async ({ page }) => {
    const title = `E2E Bulk Delete ${Date.now()}`;
    await tickets.createTicket(title);
    await tickets.selectTicket(title);

    await tickets.bulkDeleteButton.click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(tickets.rowByTitle(title)).toHaveCount(0);
  });
});

test.describe('My Board ticket timers', () => {
  let tickets: TicketsPage;
  let clock: ClockPage;

  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USERS.owner1);
    clock = new ClockPage(page);
    tickets = new TicketsPage(page);
  });

  test('starts and stops a timer from the board row', async () => {
    await clock.ensureClockedIn();

    const title = `E2E Board Timer ${Date.now()}`;
    await tickets.goto();
    await tickets.createTicket(title);
    await tickets.moveToBoard(title);

    await tickets.startTimerButton(title).click();
    await expect(tickets.stopTimerButton(title)).toBeVisible();

    await tickets.stopTimerButton(title).click();
    await expect(tickets.startTimerButton(title)).toBeVisible();
  });

  test('switching to another ticket stops the first one, with no warning (D5)', async ({
    page,
  }) => {
    await clock.ensureClockedIn();

    const stamp = Date.now();
    const first = `E2E Switch A ${stamp}`;
    const second = `E2E Switch B ${stamp}`;
    await tickets.goto();
    await tickets.createTicket(first);
    await tickets.createTicket(second);

    await tickets.selectTicket(first);
    await tickets.selectTicket(second);
    await tickets.moveToBoardButton.click();
    await tickets.switchToTab('my-board');

    await tickets.startTimerButton(first).click();
    await expect(tickets.stopTimerButton(first)).toBeVisible();

    await tickets.startTimerButton(second).click();
    await expect(tickets.stopTimerButton(second)).toBeVisible();

    // The first stopped silently — no confirmation dialog, no second running row.
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(tickets.startTimerButton(first)).toBeVisible();

    await tickets.stopTimerButton(second).click();
  });

  test('will not start a timer while clocked out (D3)', async ({ page }) => {
    await clock.ensureClockedOut();

    const title = `E2E Gate ${Date.now()}`;
    await tickets.goto();
    await tickets.createTicket(title);
    await tickets.moveToBoard(title);

    await tickets.startTimerButton(title).click();

    // The board offers the fix rather than starting an unattached timer.
    await expect(page.getByRole('heading', { name: 'Clock In Required' })).toBeVisible();
    await expect(tickets.stopTimerButton(title)).toHaveCount(0);

    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(tickets.startTimerButton(title)).toBeVisible();
  });
});
