/**
 * "My Board" personal priority view (Milestone 2.2).
 *
 * The play/timer button on a My Board row is a static, always-disabled
 * placeholder in this milestone — wiring it to actually start/stop a timer is
 * Milestone 3's job. `unified-table.spec.ts`'s
 * "starts a timer from the row menu, not a row button" test still covers the
 * main Tickets table, which never renders this column at all.
 */
import { test, expect } from '@playwright/test';

import { TEST_USERS, loginAs } from '../fixtures/users';
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

    // The board row has the extra play-button column; the main table never does.
    const timerButton = tickets.timerButtonForRow(title);
    await expect(timerButton).toBeVisible();
    await expect(timerButton).toBeDisabled();

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
