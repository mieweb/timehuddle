/**
 * "Get issues assigned to me" on an empty My Board (#633).
 *
 * The first fill of a board: one press adds up to ten of the user's assigned
 * Redmine issues, and a notice points at All Sources for the rest.
 *
 * Redmine is stubbed (see `fixtures/redmine.ts`). So is the board, held in
 * memory here: the button only exists on an empty board, and the seed user's
 * real board is shared with every other spec.
 */
import { test, expect, type Page } from '@playwright/test';

import { TEST_USERS, loginAs } from '../fixtures/users';
import { TicketsPage } from '../pages/TicketsPage';
import { connectedStatus, redmineIssue, relevantList, stubRedmine } from '../fixtures/redmine';

type BoardRef = { sourceId: string; ticketId: string };

/** An in-memory My Board answering the `myBoard.*` calls. */
async function stubBoard(page: Page): Promise<BoardRef[]> {
  const board: BoardRef[] = [];
  await page.route('**/api/myBoard_*', async (route) => {
    const method = new URL(route.request().url()).pathname.split('/').pop();
    const refs = ((route.request().postDataJSON() ?? {}) as { refs?: BoardRef[] }).refs ?? [];
    let result: unknown;
    if (method === 'myBoard_addMany') {
      board.push(...refs);
      result = { addedCount: refs.length };
    } else if (method === 'myBoard_removeMany') {
      result = { removedCount: 0 };
    } else {
      result = { entries: board.map((ref) => ({ ...ref, addedAt: '2026-10-07T00:00:00Z' })) };
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ result }),
    });
  });
  return board;
}

/** `count` open issues assigned to the stubbed account, ids from 101, in server order. */
const assignedIssues = (count: number) =>
  Array.from({ length: count }, (_, i) =>
    redmineIssue({ id: 101 + i, subject: `Assigned issue ${101 + i}` }),
  );

/** Sign-in done, Redmine answering with `count` assigned issues, on an empty board. */
async function openEmptyBoard(page: Page, count: number): Promise<BoardRef[]> {
  const board = await stubBoard(page);
  await stubRedmine(page, {
    status: connectedStatus(),
    'issues.relevant': relevantList(assignedIssues(count)),
  });
  await page.goto('/app/tickets');
  return board;
}

const getAssigned = (page: Page) => page.getByRole('button', { name: 'Get issues assigned to me' });
const redmineRows = (page: Page) =>
  page.locator('.tickets-view-panel:visible [data-ticket-source="redmine"]');

test.describe('My Board — get issues assigned to me', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USERS.owner1);
  });

  test('adds the first ten and points at All Sources for the rest', async ({ page }) => {
    const board = await openEmptyBoard(page, 12);

    await getAssigned(page).click();

    await expect(redmineRows(page)).toHaveCount(10);
    // The server's order decides which ten: the first ten it listed.
    expect(board.map((ref) => ref.ticketId)).toEqual(
      Array.from({ length: 10 }, (_, i) => String(101 + i)),
    );
    await expect(getAssigned(page)).toHaveCount(0);
    await expect(page.getByText('2 more issues assigned to you are in All Sources.')).toBeVisible();

    // The link opens All Sources narrowed to the user's assigned Redmine issues.
    await page.getByRole('button', { name: 'Show issues assigned to me in All Sources' }).click();
    await expect(new TicketsPage(page).ticketsTab).toBeChecked();
    await expect(redmineRows(page)).toHaveCount(12);
    await expect(page.locator('[data-ticket-source="huddle"]:visible')).toHaveCount(0);
  });

  test('the notice survives a reload, and stays dismissed once dismissed', async ({ page }) => {
    await openEmptyBoard(page, 12);
    await getAssigned(page).click();

    const notice = page.getByText(/more issues assigned to you/);
    await expect(notice).toBeVisible();
    await page.reload();
    await expect(redmineRows(page)).toHaveCount(10);
    await expect(notice).toBeVisible();

    await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
    await expect(notice).toHaveCount(0);
    await page.reload();
    await expect(redmineRows(page)).toHaveCount(10);
    await expect(notice).toHaveCount(0);
  });

  test('ten or fewer are all added, with no notice', async ({ page }) => {
    await openEmptyBoard(page, 4);

    await getAssigned(page).click();

    await expect(redmineRows(page)).toHaveCount(4);
    await expect(page.getByText(/assigned to you/)).toHaveCount(0);
  });

  test('is not offered without a Redmine account', async ({ page }) => {
    await stubBoard(page);
    await stubRedmine(page, {});
    await page.goto('/app/tickets');

    await expect(page.getByRole('button', { name: 'Browse All Sources' })).toBeVisible();
    await expect(getAssigned(page)).toHaveCount(0);
  });
});
