/**
 * Unified ticket table E2E tests (Milestone 2.1).
 *
 * Guards the behaviour that replaced the Huddle/Redmine view switcher: one
 * table for every source, with source as a column and a filter rather than a
 * mode, sortable column headers, row selection and scrolling.
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

  test('switches between open and closed tickets, with a count of each', async () => {
    const title = `E2E Open Closed ${Date.now()}`;
    await tickets.createTicket(title);
    await tickets.search(title);

    await expect(tickets.openOption).toBeChecked();
    // The counts are the showing view's, after its search.
    await expect(tickets.openOption).toHaveAccessibleName('Open tickets, 1');
    await expect(tickets.closedOption).toHaveAccessibleName('Closed tickets, 0');

    await tickets.showClosedTickets();
    await expect(tickets.closedOption).toBeChecked();
    await expect(tickets.rowByTitle(title)).toHaveCount(0);

    await tickets.showOpenTickets();
    await expect(tickets.openOption).toBeChecked();
    await expect(tickets.rowByTitle(title)).toBeVisible();
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

  test('opens a ticket from anywhere in its row, but not from its controls', async ({ page }) => {
    const title = `E2E Row Click ${Date.now()}`;
    await tickets.createTicket(title);
    await tickets.search(title);
    const row = tickets.rowByTitle(title);

    // Selecting the row, and opening its menu, do their own job and stay put.
    await row.getByRole('checkbox').click();
    await row.getByRole('button', { name: 'Ticket options' }).click();
    await page.keyboard.press('Escape');
    // The Tickets URL carries `?team=` (deep linking), so only the path is pinned.
    await expect(page).toHaveURL(/\/app\/tickets(\?|$)/);

    // A plain cell — not the title — opens the ticket.
    await row.getByText('TimeHuddle', { exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible({
      timeout: 20000,
    });
  });

  test('scrolls the rows under a fixed header, with no pagination', async ({ page }) => {
    // A short window and a few tickets: more rows than the card can show.
    await page.setViewportSize({ width: 1280, height: 480 });
    const stamp = Date.now();
    for (const n of [1, 2, 3, 4]) await tickets.createTicket(`E2E Scroll ${stamp} ${n}`);
    await tickets.search(`E2E Scroll ${stamp}`);
    await expect(tickets.activePanel.locator('tr[data-ticket-id]')).toHaveCount(4);

    const scroller = tickets.activePanel.locator('.ticket-table-scroll');
    const header = scroller.locator('thead');
    const measure = () =>
      scroller.evaluate((area) => ({
        overflows: area.scrollHeight > area.clientHeight + 1,
        scrollTop: area.scrollTop,
        headerTop: Math.round(area.querySelector('thead')!.getBoundingClientRect().top),
        areaTop: Math.round(area.getBoundingClientRect().top),
      }));

    const before = await measure();
    expect(before.overflows).toBe(true);

    await scroller.evaluate((area) => area.scrollTo({ top: area.scrollHeight }));
    const after = await measure();
    expect(after.scrollTop).toBeGreaterThan(0);
    // The header has not moved: it is still at the top of the scroller.
    expect(after.headerTop).toBe(after.areaTop);
    await expect(header).toBeVisible();
    await expect(tickets.rowByTitle(`E2E Scroll ${stamp} 1`)).toBeInViewport();

    // Changing what is listed goes back to the first row.
    await tickets.sortByColumn('Title');
    await expect.poll(async () => (await measure()).scrollTop).toBe(0);

    await expect(page.getByRole('navigation', { name: 'Ticket pages' })).toHaveCount(0);
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
