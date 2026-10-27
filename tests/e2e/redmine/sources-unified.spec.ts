/**
 * The Redmine source in the unified ticket table (plan area g).
 *
 * Since #736 a Redmine issue is never a row of its own: the source only feeds
 * the live status and assignee of tickets that carry an issue. What is left to
 * check here is how the table copes with the source itself — what it asks for,
 * and what it shows when the source fails or isn't connected.
 *
 * Redmine is stubbed at the wormhole boundary (see `fixtures/redmine.ts`).
 * Huddle rows are real, created through the UI against the test backend, so
 * every mixed-source assertion here is genuinely mixed.
 */
import { test, expect, type Page } from '@playwright/test';

import { TEST_USERS, loginAs } from '../fixtures/users';
import { TicketsPage } from '../pages/TicketsPage';
import { redmineIssue, relevantList, stubRedmine, type StubValue } from '../fixtures/redmine';

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

const connectedList = (issues = ISSUES) => relevantList(issues);

async function openTable(page: Page, overrides: Record<string, StubValue>) {
  const rm = await stubRedmine(page, overrides);
  const tickets = new TicketsPage(page);
  await tickets.goto();
  return { rm, tickets };
}

test.describe('Unified table with the Redmine source', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USERS.owner1);
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
