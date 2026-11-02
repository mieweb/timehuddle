/**
 * The search bar asking every connected server (#734 step 8). The servers are
 * stubbed at `sources_search`, so this says the bar shows their answers, and
 * acts on the right server; `meteor-backend/tests/source-search.test.ts` covers
 * asking them.
 */
import { test, expect, type Page } from '@playwright/test';

import { TEST_USERS, loginAs } from '../fixtures/users';
import { connectedStatus, relevantList, stubRedmine } from '../fixtures/redmine';

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

async function openAndSearch(page: Page, query: string) {
  await stubRedmine(page, {
    status: connectedStatus(),
    'issues.relevant': relevantList([]),
    'issues.search': {
      connected: true,
      baseUrl: 'https://main.example.com',
      kind: 'id',
      issues: [],
    },
  });
  await page.route('**/api/sources_search', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ result: ANSWER }),
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
});
