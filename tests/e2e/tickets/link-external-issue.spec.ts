/**
 * The "Linked issue" section at the top of a ticket's page (#636, #638): the
 * one place a ticket's Redmine or GitHub link is shown, changed and removed.
 *
 * The ticket is real and lives in the test backend. Redmine is stubbed
 * (`fixtures/redmine.ts`), and so are the link calls themselves
 * (`stubTicketCall`): linking is checked against Redmine under the caller's own
 * key, which the test backend does not have. What links, locks and counts as
 * unsent is asserted server-side in `meteor-backend/tests/`; these specs assert
 * what the page shows and sends.
 */
import { test, expect, type Page } from '@playwright/test';

import {
  BASE_URL,
  connectedStatus,
  issueDetail,
  redmineIssue,
  relevantList,
  stubRedmine,
} from '../fixtures/redmine';
import { TEST_USERS, loginAs } from '../fixtures/users';
import { TicketsPage } from '../pages/TicketsPage';

import { stubTicketCall } from './helpers';

const ISSUE = redmineIssue({ id: 482, subject: 'Export job times out' });

const card = (page: Page) => page.locator('.ticket-linked-issue');

const NO_TIME = { unlinkedSeconds: 0, unsentSeconds: 0, sentSeconds: 0 };

/**
 * A ticket whose link lives in the spec: `tickets.get` is answered by the real
 * backend with the link laid over it, and `tickets.link` / `tickets.unlink`
 * change that link the way the server would.
 */
async function withFakeLink(page: Page, initial: string | null = null) {
  let linkedId = initial;
  let ticket: Record<string, unknown> = {};
  const overlay = () => ({
    ...ticket,
    linkedIssue: linkedId ? { source: 'redmine', id: linkedId } : undefined,
  });

  await page.route('**/api/tickets_get', async (route) => {
    const response = await route.fetch();
    ticket = ((await response.json()) as { result: Record<string, unknown> }).result;
    await route.fulfill({ response, json: { result: overlay() } });
  });
  const link = await stubTicketCall(page, 'tickets.link', (params) => {
    linkedId = String(params.issueId);
    return overlay();
  });
  const unlink = await stubTicketCall(page, 'tickets.unlink', () => {
    linkedId = null;
    return overlay();
  });
  return { link, unlink };
}

/** Creates a ticket through the UI and opens its page. */
async function openNewTicket(page: Page, title: string): Promise<void> {
  const tickets = new TicketsPage(page);
  await tickets.goto();
  await tickets.createTicket(title);
  await tickets.search(title);
  await tickets.rowByTitle(title).getByRole('button', { name: 'Ticket options' }).click();
  await page.getByRole('menuitem', { name: 'Ticket Details' }).click();
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible({
    timeout: 20000,
  });
}

test.describe('Linking a ticket to a Redmine issue', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USERS.owner1);
    await stubRedmine(page, {
      status: connectedStatus(),
      'issues.relevant': relevantList([]),
      'issues.search': { connected: true, baseUrl: BASE_URL, kind: 'id', issues: [ISSUE] },
      'issues.get': { baseUrl: BASE_URL, issue: issueDetail(ISSUE), journals: [] },
    });
  });

  test('links an existing issue by number, after previewing it', async ({ page }) => {
    const { link } = await withFakeLink(page);
    await openNewTicket(page, `Link existing ${Date.now()}`);

    await expect(card(page)).toContainText('Not linked.');
    await card(page).getByRole('button', { name: 'Add link' }).click();

    // Changed in place, with no popup. The choice is GitHub or Redmine only:
    // "TimeHuddle" is not a link to add, and a link is removed with Unlink.
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(card(page).getByRole('radio', { name: 'GitHub' })).toBeVisible();
    await expect(card(page).getByRole('radio', { name: 'TimeHuddle', exact: true })).toHaveCount(0);
    await expect(card(page).getByRole('radio', { name: 'Redmine' })).toBeChecked();
    await card(page).getByLabel('Issue number or link').fill('#482');
    await card(page).getByRole('button', { name: 'Find', exact: true }).click();

    // The issue is shown before anything is linked.
    const preview = card(page).getByRole('group', { name: 'Issue to link' });
    await expect(preview).toContainText('Export job times out');
    expect(link.calls).toHaveLength(0);

    await card(page).getByRole('button', { name: 'Save' }).click();

    await expect.poll(() => link.calls.length).toBe(1);
    expect(link.calls[0]).toMatchObject({ issueId: 482, expectedIssueId: null });
    // The section now shows the issue, read live from Redmine: its number and
    // title as one link out to Redmine, and where it comes from.
    const issueLink = card(page).getByRole('link', { name: 'Open issue #482 in Redmine' });
    await expect(issueLink).toHaveAttribute('href', `${BASE_URL}/issues/482`);
    await expect(issueLink).toContainText('#482');
    await expect(issueLink).toContainText('Export job times out');
    await expect(card(page)).toContainText('from');
    await expect(card(page)).toContainText('Redmine');
    await expect(card(page)).toContainText('In Progress · Assigned to Test User');
  });

  test('unlinks a Redmine issue after a confirmation', async ({ page }) => {
    const { unlink } = await withFakeLink(page, '482');
    await openNewTicket(page, `Unlink ${Date.now()}`);

    await card(page).getByRole('button', { name: 'Unlink' }).click();
    await expect(card(page)).toContainText('Unlink this issue?');
    expect(unlink.calls).toHaveLength(0);
    await card(page).getByRole('button', { name: 'Unlink' }).click();

    await expect.poll(() => unlink.calls.length).toBe(1);
    expect(unlink.calls[0]).toMatchObject({ expectedIssueId: '482' });
    await expect(card(page)).toContainText('Not linked.');
  });

  test('shows a GitHub link in the same section, and can unlink it', async ({ page }) => {
    // Not an issue or pull request URL, so the dialog does not fetch a title for it.
    const url = 'https://github.com/mieweb/timehuddle/discussions/1';
    const tickets = new TicketsPage(page);
    await tickets.goto();
    const title = `GitHub link ${Date.now()}`;
    await tickets.createTicket(title, url);
    await tickets.search(title);
    await tickets.rowByTitle(title).getByRole('button', { name: 'Ticket options' }).click();
    await page.getByRole('menuitem', { name: 'Ticket Details' }).click();

    // Nothing is stubbed here: the GitHub link is a real field on the ticket.
    await expect(card(page).getByRole('link', { name: `Open GitHub link ${url}` })).toBeVisible({
      timeout: 20000,
    });
    await card(page).getByRole('button', { name: 'Unlink' }).click();
    await card(page).getByRole('button', { name: 'Unlink' }).click();

    await expect(card(page)).toContainText('Not linked.');
    await page.reload();
    await expect(card(page)).toContainText('Not linked.', { timeout: 20000 });
  });

  test('shows a linked GitHub issue by its title', async ({ page }) => {
    const url = 'https://github.com/mieweb/timehuddle/issues/638';
    const githubTitle = `Unify ticket creation ${Date.now()}`;
    await page.route('https://api.github.com/repos/mieweb/timehuddle/issues/638', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({ title: githubTitle, body: null }),
      }),
    );

    const tickets = new TicketsPage(page);
    await tickets.goto();
    await page.getByRole('button', { name: 'New Ticket' }).click();
    await page.getByRole('radio', { name: 'GitHub' }).check();
    await page.getByLabel('GitHub issue or pull request link').fill(url);
    // The dialog takes the ticket's title from the issue.
    await expect(page.getByPlaceholder('Ticket title')).toHaveValue(githubTitle, {
      timeout: 15000,
    });
    const created = page.waitForResponse('**/api/tickets_create');
    await page.getByRole('button', { name: 'Create Ticket' }).click();
    const { result } = (await (await created).json()) as { result: { id: string } };

    await page.goto(`/app/tickets/${result.id}`);
    // The link reads as the issue, not as a raw URL, and still goes to GitHub.
    const link = card(page).getByRole('link', { name: `Open GitHub link ${url}` });
    await expect(link).toContainText(`#638`, { timeout: 20000 });
    await expect(link).toContainText(githubTitle);
    await expect(link).toHaveAttribute('href', url);
    await expect(card(page)).toContainText('mieweb/timehuddle');
  });

  test('says what happens to logged time before the link is removed', async ({ page }) => {
    await withFakeLink(page, '482');
    await stubTicketCall(page, 'tickets.linkStatus', () => ({
      lock: null,
      myTime: { unlinkedSeconds: 0, unsentSeconds: 8100, sentSeconds: 5400 },
      othersWithTime: 2,
    }));
    await openNewTicket(page, `Unlink warnings ${Date.now()}`);

    await card(page).getByRole('button', { name: 'Unlink' }).click();

    await expect(page.getByText(/2h 15m you logged on this ticket hasn't been sent/)).toBeVisible();
    await expect(page.getByText('1h 30m you already sent stays on Redmine #482.')).toBeVisible();
    await expect(
      page.getByText('2 teammates who logged time on this ticket will be notified.'),
    ).toBeVisible();
  });

  test('locks the ticket while someone is timing it, and says whose timer it is', async ({
    page,
  }) => {
    await withFakeLink(page, '482');
    const message =
      'Ticket Member is timing this ticket. The timer has to be stopped before it can be changed.';
    await stubTicketCall(page, 'tickets.linkStatus', () => ({
      lock: { holders: [{ userId: 'u2', name: 'Ticket Member' }], message },
      myTime: NO_TIME,
      othersWithTime: 1,
    }));
    await openNewTicket(page, `Locked ${Date.now()}`);

    await expect(page.getByText(message)).toBeVisible();
    await expect(card(page).getByRole('button', { name: 'Change' })).toBeDisabled();
    await expect(card(page).getByRole('button', { name: 'Unlink' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Edit title' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Delete ticket' })).toBeDisabled();
  });

  test('shows a refusal from the server rather than failing silently', async ({ page }) => {
    await withFakeLink(page);
    const refusal =
      'Ticket Member is timing this ticket. The timer has to be stopped before it can be changed.';
    await page.unroute('**/api/tickets_link');
    await stubTicketCall(page, 'tickets.link', () => ({ error: 'ticket-locked', reason: refusal }));
    await openNewTicket(page, `Refused ${Date.now()}`);

    await card(page).getByRole('button', { name: 'Add link' }).click();
    await card(page).getByRole('radio', { name: 'Redmine' }).check();
    await card(page).getByLabel('Issue number or link').fill('482');
    await card(page).getByRole('button', { name: 'Find', exact: true }).click();
    await card(page).getByRole('button', { name: 'Save' }).click();

    // The refusal is shown where the change was attempted, and nothing is lost.
    await expect(card(page).getByText(refusal)).toBeVisible();
    await expect(card(page).getByRole('group', { name: 'Issue to link' })).toBeVisible();
  });
});
