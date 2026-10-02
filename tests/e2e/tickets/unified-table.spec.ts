/**
 * Unified ticket table E2E tests (Milestone 2.1).
 *
 * Guards the behaviour that replaced the Huddle/Redmine view switcher: one
 * table for every source, with source as a column and a filter rather than a
 * mode, sortable column headers, row selection and pagination.
 *
 * Test accounts have no linked Redmine account, so these assert the shape of
 * the table and the *degraded* path most users see — Huddle rows only, no
 * error, no dead controls. Redmine row rendering is covered by the adapter unit
 * tests in `src/features/tickets/sources/`.
 */
import { test, expect } from '@playwright/test';

import { TEST_USERS, loginAs } from '../fixtures/users';
import { TicketsPage } from '../pages/TicketsPage';

test.describe('Unified ticket table', () => {
  let tickets: TicketsPage;

  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USERS.owner1);
    tickets = new TicketsPage(page);
    await tickets.goto();
  });

  test('has no view switcher — the heading is plain text', async ({ page }) => {
    const heading = page.getByRole('heading', { level: 1, name: 'Tickets' });
    await expect(heading).toBeVisible();

    // The switcher used to live inside the h1 as a dropdown trigger.
    await expect(heading.getByRole('button')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /switch tickets view/i })).toHaveCount(0);
    await expect(page.getByText('Tickets v1', { exact: true })).toHaveCount(0);
  });

  test('has no filter chip bar — filters live on the headers', async ({ page }) => {
    await tickets.createTicket(`E2E Chips ${Date.now()}`);

    // The old chip row rendered these as standalone buttons outside the table.
    await expect(page.getByRole('button', { name: 'Clear all' })).toHaveCount(0);
    await expect(tickets.filterTrigger('Source')).toBeVisible();
    await expect(tickets.filterTrigger('Status')).toBeVisible();
    await expect(tickets.filterTrigger('Priority')).toBeVisible();
    await expect(tickets.filterTrigger('Assignees')).toBeVisible();
  });

  test('toggles closed tickets with the switch', async () => {
    await expect(tickets.closedSwitch).not.toBeChecked();
    await tickets.showClosedTickets();
    await expect(tickets.closedSwitch).toBeChecked();
    await tickets.showOpenTickets();
    await expect(tickets.closedSwitch).not.toBeChecked();
  });

  test('renders the expected columns', async ({ page }) => {
    await tickets.createTicket(`E2E Columns ${Date.now()}`);

    for (const header of [
      'Title',
      'Issue #',
      'Source',
      'Status',
      'Priority',
      'Assignees',
      'Project',
      'Updated',
    ]) {
      await expect(page.getByRole('columnheader', { name: new RegExp(header) })).toBeVisible();
    }
  });

  test('tags every row with its source', async ({ page }) => {
    await tickets.createTicket(`E2E Unified ${Date.now()}`);

    const row = page.locator('tr[data-ticket-source]').first();
    await expect(row).toBeVisible();

    // Row identity is source-namespaced so ids cannot collide across sources.
    expect(await row.getAttribute('data-ticket-key')).toMatch(/^(huddle|redmine):/);
    await expect(tickets.rowsFromSource('huddle').first()).toBeVisible();
  });

  test('offers every registered source in the Source column filter', async ({ page }) => {
    await tickets.filterTrigger('Source').click();
    await expect(page.getByRole('menuitem', { name: 'TimeHuddle' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Redmine' })).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('isolates a single source', async () => {
    await tickets.createTicket(`E2E Isolate ${Date.now()}`);

    await tickets.filterBySource('TimeHuddle');
    await expect(tickets.rowsFromSource('redmine')).toHaveCount(0);
    expect(await tickets.rowsFromSource('huddle').count()).toBeGreaterThan(0);

    await tickets.clearFiltersButton.click();
    await expect(tickets.clearFiltersButton).toHaveCount(0);
  });

  test('sorts from the column headers and exposes aria-sort', async () => {
    await tickets.createTicket(`E2E Sort ${Date.now()}`);
    const before = await tickets.getTicketCount();

    // Default sort is Updated, descending.
    expect(await tickets.sortStateOf('Updated')).toBe('descending');

    await tickets.sortByColumn('Title');
    expect(await tickets.sortStateOf('Title')).toBe('ascending');
    expect(await tickets.sortStateOf('Updated')).toBe('none');

    // Clicking the active column flips it rather than re-sorting ascending.
    await tickets.sortByColumn('Title');
    expect(await tickets.sortStateOf('Title')).toBe('descending');

    // Sorting is presentation only — no rows gained or lost.
    expect(await tickets.getTicketCount()).toBe(before);
  });

  test('selects rows, including a tri-state select-all', async ({ page }) => {
    await tickets.createTicket(`E2E Select ${Date.now()}`);

    const firstRowCheckbox = page.locator('tr[data-ticket-id]').first().getByRole('checkbox');
    await firstRowCheckbox.check();
    await expect(firstRowCheckbox).toBeChecked();

    await tickets.selectAllCheckbox.check();
    const rowCheckboxes = page.locator('tr[data-ticket-id]').getByRole('checkbox');
    const count = await rowCheckboxes.count();
    for (let i = 0; i < count; i++) {
      await expect(rowCheckboxes.nth(i)).toBeChecked();
    }

    await tickets.selectAllCheckbox.uncheck();
    for (let i = 0; i < count; i++) {
      await expect(rowCheckboxes.nth(i)).not.toBeChecked();
    }
  });

  test('pages instead of scrolling the rows', async ({ page }) => {
    // The row area must not be a vertical scroller — paging replaces it.
    const rowArea = page.locator('tr[data-ticket-id]').first();
    await expect(rowArea).toBeVisible();

    const overflowsVertically = await page.evaluate(() => {
      const row = document.querySelector('tr[data-ticket-id]');
      const host = row?.closest('div.overflow-hidden');
      return host ? host.scrollHeight > host.clientHeight + 2 : false;
    });
    expect(overflowsVertically).toBe(false);
  });

  test('offers no way to start a timer — that lives only on My Board (M3 D1)', async ({ page }) => {
    const title = `E2E Timer Menu ${Date.now()}`;
    await tickets.createTicket(title);

    const row = tickets.rowByTitle(title).first();
    await expect(row.getByRole('button', { name: /start timer|stop timer/i })).toHaveCount(0);

    await row.getByRole('button', { name: 'Ticket options' }).click();
    await expect(page.getByRole('menuitem', { name: /timer/i })).toHaveCount(0);
    await page.keyboard.press('Escape');
  });

  test('renders Huddle tickets with no error when Redmine is not linked', async ({ page }) => {
    await expect(page.getByLabel('Source load errors')).toHaveCount(0);
    await expect(tickets.newTicketButton).toBeEnabled();
  });

  test('announces the result count to assistive tech', async ({ page }) => {
    const status = page.getByRole('status');
    await expect(status).toHaveText(/\d+ (open|closed) tickets?|Loading tickets/);
  });
});
