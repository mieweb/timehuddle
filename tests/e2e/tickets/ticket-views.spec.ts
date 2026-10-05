/**
 * The Tickets page's two views (#633): it opens on My Board, the full table is
 * the All Sources tab, and one search bar above both serves whichever is showing.
 */
import { test, expect } from '@playwright/test';

import { TEST_USERS, loginAs } from '../fixtures/users';
import { TicketsPage } from '../pages/TicketsPage';

test.describe('Tickets page views', () => {
  let tickets: TicketsPage;

  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USERS.owner1);
    tickets = new TicketsPage(page);
    // Not `tickets.goto()`: that switches to All Sources, and this is about the default.
    await page.goto('/app/tickets');
    await tickets.heading.waitFor({ state: 'visible' });
  });

  test('opens on My Board, which is the first tab', async ({ page }) => {
    await expect(tickets.myBoardTab).toHaveAttribute('aria-checked', 'true');
    await expect(tickets.ticketsTab).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByRole('radio').first()).toHaveAccessibleName('My Board');
    // The board's own timer column shows it is the board that is visible.
    await expect(tickets.moveToBoardButton).toHaveCount(0);
  });

  test('names the icon-only tab All Sources and opens it by keyboard', async ({ page }) => {
    await expect(page.getByRole('radio', { name: 'Tickets' })).toHaveCount(0);
    await tickets.myBoardTab.focus();
    await page.keyboard.press('ArrowRight');
    await expect(tickets.ticketsTab).toHaveAttribute('aria-checked', 'true');
  });

  test('keeps one search bar above both views, with its text', async ({ page }) => {
    await expect(tickets.searchInput).toHaveCount(1);
    await expect(page.getByPlaceholder('Search My Board…')).toHaveCount(0);

    const title = `E2E Shared Search ${Date.now()}`;
    await tickets.createTicket(title);

    // A new ticket is on its creator's board, so the board is filtered by the bar.
    await tickets.search(title);
    await expect(tickets.rowByTitle(title)).toBeVisible();
    await expect(tickets.activePanel.locator('tr[data-ticket-id]')).toHaveCount(1);

    await tickets.switchToTab('tickets');
    await expect(tickets.searchInput).toHaveValue(title);
    await expect(tickets.rowByTitle(title)).toBeVisible();
    await expect(tickets.activePanel.locator('tr[data-ticket-id]')).toHaveCount(1);

    await tickets.search('');
    await tickets.switchToTab('my-board');
    await expect(tickets.searchInput).toHaveValue('');
  });
});
