/**
 * Finding a ticket by its ID from the Tickets search bar (#736c).
 *
 * The dropdown lists the tickets a typed ID names, in any of the user's teams,
 * above the Redmine issues, and choosing one opens it. Runs against the real
 * backend with no Redmine linked, so the Tickets group stands on its own.
 * Outside IDs (`RM0-233`, `timehuddle-223`) are covered by the selector's
 * tests in meteor-backend/tests/ticket-search-core.test.ts.
 */
import { test, expect } from '@playwright/test';

import { TEST_USERS, loginAs } from '../fixtures/users';
import { TicketsPage } from '../pages/TicketsPage';

import { createTicket, deleteTicket, ticketRow } from './helpers';

test.describe('Find a ticket by ID', () => {
  test('lists the ticket a typed ID names, and opens it', async ({ page }) => {
    await loginAs(page, TEST_USERS.owner1);
    const title = `Find by ID ${Date.now()}`;
    await createTicket(page, title);
    const meta = await ticketRow(page, title).first().locator('.ticket-row-meta').textContent();
    const ref = meta?.match(/[A-Z][A-Z0-9]*-\d+/)?.[0];
    expect(ref, 'the new ticket shows its ID').toBeTruthy();

    const input = new TicketsPage(page).searchInput;
    const menu = page.getByRole('listbox', { name: 'Redmine suggestions' });
    const option = menu.getByRole('option', { name: new RegExp(title) });

    // The prefix in any case, and the bare number, both find it.
    await input.fill(ref!.toLowerCase());
    await expect(menu.getByText('Tickets', { exact: true })).toBeVisible();
    await expect(option).toContainText(ref!);
    await input.fill(ref!.split('-')[1]);
    await expect(option).toBeVisible();

    await input.press('ArrowDown');
    await input.press('Enter');
    await expect(page).toHaveURL(/\/app\/tickets\/[0-9a-f]{24}$/);
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();

    await deleteTicket(page, title);
  });
});
