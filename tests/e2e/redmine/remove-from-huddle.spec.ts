/**
 * Bulk Delete on Redmine issues, and My Board entries that point at nothing.
 *
 * Deleting a Redmine issue from the Tickets page only takes it out of
 * TimeHuddle: the server records a removal and drops it from My Board, and
 * nothing is sent to Redmine. A Huddle ticket in the same selection is still
 * deleted for good, and the dialog says which is which.
 *
 * Redmine and My Board are stubbed at the wormhole boundary, so these assert
 * what the page does with a given answer; the removal and relevance rules
 * themselves are unit-tested on the Meteor side.
 */
import { test, expect, type Page } from '@playwright/test';

import { TEST_USERS, loginAs } from '../fixtures/users';
import { TicketsPage } from '../pages/TicketsPage';
import {
  connectedStatus,
  redmineIssue,
  relevantList,
  stubRedmine,
  type StubValue,
} from '../fixtures/redmine';
import { stubMyBoard } from '../fixtures/timers';

const ALPHA = redmineIssue({ id: 15, subject: 'Alpha intake validation', reasons: ['assigned'] });

const relevant = (issues = [ALPHA], extra: Record<string, unknown> = {}) =>
  relevantList(issues, extra);

/** Redmine with issue 15 in the table until `issues.removeFromTable` takes it out. */
async function openWithRemovableAlpha(page: Page, board: ReturnType<typeof stubMyBoard>) {
  let removed = false;
  const held = await board;
  const rm = await stubRedmine(page, {
    status: connectedStatus(),
    'issues.relevant': () => relevant(removed ? [] : [ALPHA]),
    'issues.removeFromTable': (params) => {
      removed = true;
      // The server drops the board entries with the removal.
      const ids = (params.issueIds as number[]).map(String);
      for (let i = held.board.length - 1; i >= 0; i--) {
        if (held.board[i].sourceId === 'redmine' && ids.includes(held.board[i].ticketId)) {
          held.board.splice(i, 1);
        }
      }
      return { removedCount: ids.length };
    },
  } satisfies Record<string, StubValue>);
  const tickets = new TicketsPage(page);
  await tickets.goto();
  return { rm, tickets };
}

const confirmDelete = (page: Page) =>
  page.getByRole('button', { name: 'Delete', exact: true }).click();

test.describe('Deleting Redmine issues from TimeHuddle', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USERS.owner1);
  });

  test('takes a Redmine issue out of the table, not out of Redmine', async ({ page }) => {
    const { rm, tickets } = await openWithRemovableAlpha(page, stubMyBoard(page, []));

    await tickets.selectTicket('Alpha intake validation');
    await expect(tickets.bulkDeleteButton).toBeEnabled();
    await tickets.bulkDeleteButton.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Delete ticket?')).toBeVisible();
    await expect(dialog).toContainText('removed from TimeHuddle, not from Redmine');
    await expect(dialog).not.toContainText('permanently');
    await confirmDelete(page);

    await expect(tickets.rowByTitle('Alpha intake validation')).toHaveCount(0);
    expect(rm.calls('issues.removeFromTable')).toEqual([{ issueIds: [15] }]);
  });

  test('works from My Board too, taking the issue off the board', async ({ page }) => {
    const { rm, tickets } = await openWithRemovableAlpha(
      page,
      stubMyBoard(page, [{ sourceId: 'redmine', ticketId: '15' }]),
    );

    await tickets.switchToTab('my-board');
    await tickets.selectTicket('Alpha intake validation');
    await tickets.bulkDeleteButton.click();
    await expect(page.getByRole('dialog')).toContainText('not from Redmine');
    await confirmDelete(page);

    await expect(tickets.rowByTitle('Alpha intake validation')).toHaveCount(0);
    expect(rm.callCount('issues.removeFromTable')).toBe(1);
    await expect(page.getByText(/no longer available/)).toHaveCount(0);
  });

  test('says which tickets are deleted and which only leave TimeHuddle', async ({ page }) => {
    // Created before Redmine is stubbed as connected: with it connected, "New
    // ticket" opens a Huddle-or-Redmine menu the page object does not drive.
    const title = `E2E Mixed Delete ${Date.now()}`;
    await new TicketsPage(page).goto();
    await new TicketsPage(page).createTicket(title);
    const { rm, tickets } = await openWithRemovableAlpha(page, stubMyBoard(page, []));

    await tickets.selectTicket(title);
    await tickets.selectTicket('Alpha intake validation');
    await tickets.bulkDeleteButton.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Delete 2 tickets?')).toBeVisible();
    await expect(dialog).toContainText('1 Redmine issue will be removed from TimeHuddle');
    await expect(dialog).toContainText('1 Huddle ticket will be permanently deleted');
    await confirmDelete(page);

    await expect(tickets.rowByTitle(title)).toHaveCount(0);
    await expect(tickets.rowByTitle('Alpha intake validation')).toHaveCount(0);
    expect(rm.calls('issues.removeFromTable')).toEqual([{ issueIds: [15] }]);
  });
});

test.describe('My Board entries that point at nothing', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USERS.owner1);
  });

  test('offers to remove the ones Redmine says are gone', async ({ page }) => {
    const { removals } = await stubMyBoard(page, [
      { sourceId: 'redmine', ticketId: '15' },
      { sourceId: 'redmine', ticketId: '99' },
    ]);
    await stubRedmine(page, {
      status: connectedStatus(),
      // Issue 15 is in the table because it is on the board; 99 no longer exists.
      'issues.relevant': relevant([{ ...ALPHA, reasons: ['board'] }], {
        unavailableBoardIds: [99],
      }),
    });
    const tickets = new TicketsPage(page);
    await tickets.goto();
    await tickets.switchToTab('my-board');

    await expect(tickets.rowByTitle('Alpha intake validation')).toBeVisible();
    await expect(page.getByText('1 ticket on your board is no longer available.')).toBeVisible();
    await page.getByRole('button', { name: 'Remove 1 unavailable ticket from My Board' }).click();

    await expect(page.getByText(/no longer available/)).toHaveCount(0);
    expect(removals).toEqual([{ refs: [{ sourceId: 'redmine', ticketId: '99' }] }]);
  });

  test('never offers to remove an issue that only failed to load', async ({ page }) => {
    await stubMyBoard(page, [{ sourceId: 'redmine', ticketId: '99' }]);
    await stubRedmine(page, {
      status: connectedStatus(),
      'issues.relevant': relevant([], { partial: true, unavailableBoardIds: [] }),
    });
    const tickets = new TicketsPage(page);
    await tickets.goto();
    await tickets.switchToTab('my-board');

    await expect(
      page.getByText("1 ticket on your board couldn't be loaded right now.").first(),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: /unavailable ticket/ })).toHaveCount(0);
  });
});
