/**
 * Activity Log E2E.
 *
 * The log is written by the backend as a side effect of ordinary work, so each
 * test performs the work first and then asserts the entry it must produce.
 * Nothing here is conditional: the previous version hid its only real
 * assertion behind `if (!hasEmpty)`, so an activity log that recorded nothing
 * at all would still have passed.
 */
import { test, expect, type Page } from '@playwright/test';

import { TEST_USERS, loginAs } from '../fixtures/users';
import { ClockPage } from '../pages/ClockPage';
import { TicketsPage } from '../pages/TicketsPage';

const activityList = (page: Page) => page.getByRole('list', { name: 'Activity log' });
const entries = (page: Page) => activityList(page).locator('li');

async function openActivityLog(page: Page): Promise<void> {
  await page.goto('/app/activity');
  await expect(page.getByRole('heading', { level: 1, name: 'Activity Log' })).toBeVisible({
    timeout: 20000,
  });
}

test.describe('Activity Log', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USERS.owner1);
  });

  test('renders the activity log page', async ({ page }) => {
    await openActivityLog(page);

    expect(page.url()).toContain('/app/activity');
    await expect(
      page.getByText('A chronological log of your activity in TimeHuddle.'),
    ).toBeVisible();
  });

  test('records a completed shift', async ({ page }) => {
    const clock = new ClockPage(page);
    await clock.ensureClockedOut();
    await clock.ensureClockedIn('Plan for an activity log test');
    await clock.ensureClockedOut();

    await openActivityLog(page);

    await expect(entries(page).filter({ hasText: 'Clocked in' }).first()).toBeVisible({
      timeout: 20000,
    });
    await expect(entries(page).filter({ hasText: 'Clocked out' }).first()).toBeVisible({
      timeout: 20000,
    });
  });

  test('records a created ticket, by title', async ({ page }) => {
    const title = `Activity Log Test ${Date.now()}`;
    const tickets = new TicketsPage(page);
    await tickets.goto();
    await tickets.createTicket(title);

    await openActivityLog(page);

    await expect(entries(page).filter({ hasText: title })).toHaveCount(1, { timeout: 20000 });
    await expect(entries(page).filter({ hasText: title })).toContainText('Created ticket');
  });

  test('keeps both kinds of event in one chronological list', async ({ page }) => {
    // The log merges sources — clock events come from `clockevents`, ticket
    // events from the ticket activity feed — so one of them going missing is
    // only visible when both are expected at once.
    const clock = new ClockPage(page);
    await clock.ensureClockedOut();
    await clock.ensureClockedIn('Plan for a combined activity log test');

    const title = `Combined Activity ${Date.now()}`;
    const tickets = new TicketsPage(page);
    await tickets.goto();
    await tickets.createTicket(title);
    await clock.ensureClockedOut();

    await openActivityLog(page);

    await expect(entries(page).filter({ hasText: 'Clocked in' }).first()).toBeVisible({
      timeout: 20000,
    });
    await expect(entries(page).filter({ hasText: title })).toHaveCount(1);
    await expect(entries(page).count()).resolves.toBeGreaterThanOrEqual(3);
  });
});
