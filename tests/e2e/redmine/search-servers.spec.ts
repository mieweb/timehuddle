/**
 * The search bar asking every connected server (#734 step 8). The servers are
 * stubbed at `sources_search`, so this says the bar shows their answers, and
 * acts on the right server; `meteor-backend/tests/source-search.test.ts` covers
 * asking them.
 */
import { test, expect, type Page } from '@playwright/test';

import { TEST_USERS, loginAs } from '../fixtures/users';
import { connectedStatus, redmineIssue, relevantList, stubRedmine } from '../fixtures/redmine';
import { createTicket, deleteTicket } from '../tickets/helpers';

const issue = (id: number, subject: string, tickets: { id: string; teamId: string }[] = []) => ({
  id,
  subject,
  url: `https://other.example.com/issues/${id}`,
  project: { id: 1, name: 'Ops' },
  status: null,
  assignedTo: null,
  priority: null,
  tracker: null,
  createdAt: null,
  updatedAt: null,
  tickets,
});

const ANSWER = {
  servers: [
    {
      host: 'other.example.com',
      prefix: 'OT',
      type: 'redmine',
      failed: false,
      issues: [issue(233, 'Printer jams on page 2')],
    },
    { host: 'down.example.com', prefix: 'DN', type: 'redmine', failed: true, issues: [] },
  ],
};

async function openAndSearch(
  page: Page,
  query: string,
  { answer = ANSWER, mainIssues = [] as unknown[] } = {},
) {
  await stubRedmine(page, {
    status: connectedStatus(),
    'issues.relevant': relevantList([]),
    'issues.search': {
      connected: true,
      baseUrl: 'https://main.example.com',
      kind: 'id',
      issues: mainIssues,
    },
  });
  await page.route('**/api/sources_search', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ result: answer }),
    }),
  );
  await page.goto('/app/tickets');
  const input = page.getByRole('combobox');
  await input.click();
  await input.fill(query);
}

test.describe('Searching every connected server', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USERS.owner1);
  });

  test("lists a server's issues under its name, by their outside ID", async ({ page }) => {
    await openAndSearch(page, '233');
    await expect(page.getByText('From other.example.com')).toBeVisible();
    await expect(page.getByText('OT-233', { exact: true })).toBeVisible();
    await expect(page.getByText('Printer jams on page 2')).toBeVisible();
  });

  test('says which server failed, and still lists the others', async ({ page }) => {
    await openAndSearch(page, '233');
    await expect(page.getByText("down.example.com didn't respond.")).toBeVisible();
    await expect(page.getByText('OT-233', { exact: true })).toBeVisible();
  });

  test("says when GitHub's rate limit is why it found nothing", async ({ page }) => {
    await openAndSearch(page, 'printer', {
      answer: {
        servers: [
          ...ANSWER.servers,
          {
            host: 'github.com',
            prefix: '',
            type: 'github',
            failed: true,
            rateLimited: true,
            issues: [],
          },
        ],
      },
    });
    await expect(
      page.getByText('Rate limit reached on GitHub. Try again in a few minutes.'),
    ).toBeVisible();
    await expect(page.getByText("down.example.com didn't respond.")).toBeVisible();
  });

  test('opens a result in TimeHuddle, making its ticket first', async ({ page }) => {
    const carried: unknown[] = [];
    await page.route('**/api/tickets_carryIssue', (route) => {
      carried.push(route.request().postDataJSON());
      return route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'stopped-here', reason: 'Stopped by the test.' }),
      });
    });
    await openAndSearch(page, '233');
    const external = page.waitForEvent('popup', { timeout: 1500 }).catch(() => null);
    await page.getByRole('option', { name: /OT-233/ }).click();
    await expect.poll(() => carried.length).toBe(1);
    expect(carried[0]).toMatchObject({ issueId: 233, host: 'other.example.com' });
    expect(await external).toBeNull();
  });

  test("makes the ticket on the issue's own server when a timer starts", async ({ page }) => {
    const carried: unknown[] = [];
    await page.route('**/api/tickets_carryIssue', (route) => {
      carried.push(route.request().postDataJSON());
      return route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'stopped-here', reason: 'Stopped by the test.' }),
      });
    });
    await openAndSearch(page, '233');
    await page
      .getByRole('option', { name: /OT-233/ })
      .locator('button')
      .first()
      .click();
    await expect.poll(() => carried.length).toBe(1);
    expect(carried[0]).toMatchObject({ issueId: 233, host: 'other.example.com' });
  });

  test('lists a bare number found as a ticket, on the main server and on another, each labelled', async ({
    page,
  }) => {
    const title = `Bare number ${Date.now()}`;
    const created = page.waitForResponse('**/api/tickets_create');
    await createTicket(page, title);
    const { result } = (await (await created).json()) as { result: { number: number } };
    const n = result.number;

    await openAndSearch(page, String(n), {
      mainIssues: [redmineIssue({ id: n, subject: 'On the main server' })],
      answer: {
        servers: [
          {
            host: 'other.example.com',
            prefix: 'OT',
            type: 'redmine',
            failed: false,
            issues: [issue(n, 'On another server')],
          },
        ],
      },
    });
    const menu = page.getByRole('listbox', { name: 'Search results' });
    await expect(menu.getByText('Tickets', { exact: true })).toBeVisible();
    await expect(menu.getByRole('option', { name: new RegExp(title) })).toBeVisible();
    await expect(menu.getByRole('option', { name: /On the main server/ })).toContainText(`#${n}`);
    await expect(menu.getByText('From other.example.com')).toBeVisible();
    await expect(menu.getByRole('option', { name: /On another server/ })).toContainText(`OT-${n}`);

    await deleteTicket(page, title);
  });

  test("opens an issue's ticket in this team, else another team's, without making one", async ({
    page,
  }) => {
    const carried: unknown[] = [];
    await page.route('**/api/tickets_carryIssue', (route) => {
      carried.push(route.request().postDataJSON());
      return route.abort();
    });
    // No ticket search hits, so the issue is listed under its server.
    await page.route('**/api/tickets_search', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ result: { kind: 'id', tickets: [] } }),
      }),
    );
    const title = `Carried here ${Date.now()}`;
    const created = page.waitForResponse('**/api/tickets_create');
    await createTicket(page, title);
    const here = ((await (await created).json()) as { result: { id: string; teamId: string } })
      .result;
    const elsewhere = { id: 'a'.repeat(24), teamId: 'b'.repeat(24) };
    const withTickets = (tickets: { id: string; teamId: string }[]) => ({
      servers: [
        {
          host: 'other.example.com',
          prefix: 'OT',
          type: 'redmine',
          failed: false,
          issues: [issue(233, 'Shared issue', tickets)],
        },
      ],
    });

    // Another team's ticket is listed first; this team's still wins.
    await openAndSearch(page, '233', { answer: withTickets([elsewhere, here]) });
    await page.getByRole('option', { name: /OT-233/ }).click();
    await expect(page).toHaveURL(new RegExp(`/app/tickets/${here.id}$`));

    // Only another team's: that one opens.
    await page.unroute('**/api/sources_search');
    await openAndSearch(page, '233', { answer: withTickets([elsewhere]) });
    await page.getByRole('option', { name: /OT-233/ }).click();
    await expect(page).toHaveURL(new RegExp(`/app/tickets/${elsewhere.id}$`));
    expect(carried).toEqual([]);

    await deleteTicket(page, title);
  });
});
