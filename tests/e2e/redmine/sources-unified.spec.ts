/**
 * Redmine rows in the unified ticket table (plan area g).
 *
 * `tickets/unified-table.spec.ts` covers the same table with *no* Redmine
 * account linked — the degraded path most users see. This file is its
 * counterpart: what the table does once a source actually contributes rows.
 *
 * Redmine is stubbed at the wormhole boundary (see `fixtures/redmine.ts`).
 * Huddle rows are real, created through the UI against the test backend, so
 * every mixed-source assertion here is genuinely mixed.
 */
import { test, expect, type Page } from '@playwright/test';

import { TEST_USERS, loginAs } from '../fixtures/users';
import { TicketsPage } from '../pages/TicketsPage';
import { BASE_URL, redmineIssue, stubRedmine, type StubValue } from '../fixtures/redmine';

const ISSUES = [
  redmineIssue({ id: 15, subject: 'Alpha intake validation', priority: { id: 4, name: 'Normal' } }),
  redmineIssue({
    id: 23,
    subject: 'Zulu export timeout',
    status: { id: 1, name: 'New', isClosed: false },
    priority: { id: 5, name: 'High' },
    project: { id: 2, name: 'Exports' },
  }),
];

const connectedList = (issues = ISSUES) => ({
  connected: true,
  baseUrl: BASE_URL,
  issues,
  partial: false,
});

async function openTable(page: Page, overrides: Record<string, StubValue>) {
  const rm = await stubRedmine(page, overrides);
  const tickets = new TicketsPage(page);
  await tickets.goto();
  return { rm, tickets };
}

test.describe('Unified table with Redmine rows', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USERS.owner1);
  });

  test('renders Redmine issues as rows, keyed by source and id', async ({ page }) => {
    const { tickets } = await openTable(page, { 'issues.relevant': connectedList() });

    // Isolated to Redmine first: the table paginates at roughly a screenful,
    // and Huddle rows left behind by earlier specs would push these off it.
    await tickets.filterBySource('Redmine');

    await expect(tickets.rowsFromSource('redmine')).toHaveCount(2);
    await expect(tickets.activePanel.locator('tr[data-ticket-key="redmine:15"]')).toHaveCount(1);
    await expect(tickets.rowByTitle('Alpha intake validation')).toHaveCount(1);
  });

  test('asks for the relevant list, keeping the issues the user hid from suggestions', async ({
    page,
  }) => {
    // MVP2 replaced the unfiltered `issues.list` with `issues.relevant`. The table
    // must pass `includeDismissed: true`: dismissing a search suggestion means
    // "stop offering me this", and a row vanishing from a table would be a
    // different promise than the one the x makes.
    const { rm } = await openTable(page, { 'issues.relevant': connectedList() });

    await expect.poll(() => rm.callCount('issues.relevant')).toBeGreaterThan(0);
    expect(rm.calls('issues.relevant')[0]).toEqual({ includeDismissed: true });
  });

  test('offers "Open in Redmine" on a Redmine row', async ({ page }) => {
    const { tickets } = await openTable(page, { 'issues.relevant': connectedList() });

    await tickets.search('Alpha intake validation');
    await tickets
      .rowByTitle('Alpha intake validation')
      .getByRole('button', { name: 'Ticket options' })
      .click();

    await expect(page.getByText('Open in Redmine', { exact: true })).toBeVisible();
  });

  test('offers no timer on a Redmine row — timers live on My Board (M3 D1)', async ({ page }) => {
    const { tickets } = await openTable(page, { 'issues.relevant': connectedList() });

    await tickets.search('Alpha intake validation');
    await tickets
      .rowByTitle('Alpha intake validation')
      .getByRole('button', { name: 'Ticket options' })
      .click();

    await expect(page.getByText(/start timer|stop timer/i)).toHaveCount(0);
  });

  test('the Source filter isolates each source', async ({ page }) => {
    const { tickets } = await openTable(page, { 'issues.relevant': connectedList() });
    await tickets.createTicket(`Huddle row ${Date.now()}`);

    await tickets.filterBySource('Redmine');
    await expect(tickets.rowsFromSource('huddle')).toHaveCount(0);
    expect(await tickets.rowsFromSource('redmine').count()).toBeGreaterThan(0);

    await tickets.clearFiltersButton.click();
    await tickets.filterBySource('TimeHuddle');
    await expect(tickets.rowsFromSource('redmine')).toHaveCount(0);
    expect(await tickets.rowsFromSource('huddle').count()).toBeGreaterThan(0);
  });

  test('sorting orders both sources together, not source by source', async ({ page }) => {
    const { tickets } = await openTable(page, { 'issues.relevant': connectedList() });
    // Sorts between the two Redmine subjects, so a per-source sort is visible.
    await tickets.createTicket('Mike huddle ticket');

    await tickets.sortByColumn('Title');

    const titles = await tickets.activePanel.locator('tr[data-ticket-id]').allInnerTexts();
    const ordered = titles.join(' | ');
    expect(ordered.indexOf('Alpha intake')).toBeLessThan(ordered.indexOf('Mike huddle'));
    expect(ordered.indexOf('Mike huddle')).toBeLessThan(ordered.indexOf('Zulu export'));
  });

  test('one source failing leaves the other rendered, with an error banner', async ({ page }) => {
    // The whole point of the partitioned `useUnifiedTickets`: Redmine being
    // down must not take the Huddle tickets with it.
    const { tickets } = await openTable(page, {
      'issues.relevant': { status: 500, reason: 'Redmine is unreachable' },
    });
    await tickets.createTicket(`Survivor ${Date.now()}`);

    // Scoped to the visible panel: Tickets and My Board both stay mounted, so
    // each renders its own copy of the banner.
    const banner = tickets.activePanel.getByLabel('Source load errors');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('Redmine is unreachable');
    expect(await tickets.rowsFromSource('huddle').count()).toBeGreaterThan(0);
  });

  test('a disconnected account contributes no rows and no error', async ({ page }) => {
    // Not being linked is a silent omission by design, not a failure state.
    const { tickets } = await openTable(page, {
      'issues.relevant': { connected: false, baseUrl: null, issues: [] },
    });
    await tickets.createTicket(`Huddle only ${Date.now()}`);

    await expect(tickets.rowsFromSource('redmine')).toHaveCount(0);
    await expect(tickets.activePanel.getByLabel('Source load errors')).toHaveCount(0);
  });
});
