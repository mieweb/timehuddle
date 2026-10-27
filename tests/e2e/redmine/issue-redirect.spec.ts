/**
 * `/app/tickets/redmine/:id` since #736: a Redmine issue has no page of its own.
 *
 * Old links (search suggestions, timesheet rows for time logged on a bare
 * issue) still point there. The page finds or creates the issue's ticket in
 * the selected team and replaces the URL with that ticket's page. Carrying is
 * stubbed: the test backend has no Redmine to create a ticket from.
 */
import { test, expect } from '@playwright/test';

import { TEST_USERS, loginAs } from '../fixtures/users';
import { connectedStatus, stubRedmine } from '../fixtures/redmine';
import { carrierIdOf, stubCarryIssue } from '../fixtures/timers';

test.describe('A Redmine issue address (#736)', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USERS.owner1);
    await stubRedmine(page, { status: connectedStatus() });
  });

  test('opens the ticket carrying the issue, in place of the old address', async ({ page }) => {
    const carries = await stubCarryIssue(page);

    await page.goto('/app/tickets/redmine/15');

    await expect(page).toHaveURL(new RegExp(`/app/tickets/${carrierIdOf(15)}(\\?|$)`));
    expect(carries).toEqual([{ teamId: expect.any(String), issueId: 15 }]);
    // Replaced, not pushed: Back leaves the ticket rather than redirecting again.
    await page.goBack();
    await expect(page).not.toHaveURL(/\/app\/tickets\/redmine\//);
  });

  test('says why when the issue cannot be carried', async ({ page }) => {
    await page.route('**/api/tickets_carryIssue', (route) =>
      route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'issue-unavailable', reason: 'issue-unavailable' }),
      }),
    );

    await page.goto('/app/tickets/redmine/15');

    await expect(page.getByRole('alert')).toContainText(
      "That Redmine issue doesn't exist, or you don't have access to it.",
    );
    await expect(page).toHaveURL(/\/app\/tickets\/redmine\/15/);
  });
});
