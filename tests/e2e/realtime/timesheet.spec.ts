/**
 * Real-time personal timesheet synchronization.
 *
 * `PersonalTimesheetPanel` subscribes to `clock.liveForUser` for the signed-in
 * user, so a shift started in one tab must appear in that user's timesheet in
 * another tab without a reload.
 *
 * Both tabs are therefore the *same* user in one browser context. The old
 * version of this file logged in as two different users and asserted that both
 * could see a heading — which would pass with the subscription deleted, and
 * could never have observed a sync in any case, since the publication is
 * scoped to `this.userId`.
 *
 * Session rows are counted through their per-row "Edit session" button, the
 * only accessible handle the row exposes.
 */
import { test, expect, type Page, type BrowserContext } from '@playwright/test';

import { TEST_USERS, loginAs } from '../fixtures/users';
import { ClockPage } from '../pages/ClockPage';

const sessionRows = (page: Page) => page.getByRole('button', { name: 'Edit session' });

/** Rows still running: the Clock Out column renders an em dash until clock-out. */
const openSessionRows = (page: Page) =>
  page
    .locator('tbody tr')
    .filter({ has: sessionRows(page) })
    .filter({ hasText: '—' });

async function openTimesheet(page: Page): Promise<void> {
  await page.goto('/app/timesheet');
  await expect(page.getByRole('button', { name: 'Add Entry' })).toBeVisible({ timeout: 20000 });
  // "Add Entry" renders before the sessions load, so a row count read here
  // would be a premature zero. Wait for the list to resolve either way.
  await expect
    .poll(
      async () =>
        (await sessionRows(page).count()) > 0 ||
        (await page.getByText('No clock events in this date range.').count()) > 0,
      { timeout: 20000 },
    )
    .toBe(true);
}

test.describe('Timesheet Real-time Sync', () => {
  let context: BrowserContext;
  let session1: Page;
  let session2: Page;
  let clock1: ClockPage;

  test.beforeEach(async ({ browser }) => {
    context = await browser.newContext();
    session1 = await context.newPage();
    await loginAs(session1, TEST_USERS.admin3);

    clock1 = new ClockPage(session1);
    await clock1.ensureClockedOut();

    session2 = await context.newPage();
    await openTimesheet(session2);
  });

  test.afterEach(async () => {
    await clock1?.ensureClockedOut().catch(() => {});
    await context?.close();
  });

  test('a shift started in one tab appears in the timesheet open in another', async () => {
    const before = await sessionRows(session2).count();

    await clock1.ensureClockedIn('Plan for a timesheet sync test');

    await expect(sessionRows(session2)).toHaveCount(before + 1, { timeout: 15000 });
    await expect(openSessionRows(session2)).toHaveCount(1, { timeout: 15000 });
  });

  test('clocking out closes the row in the other tab', async () => {
    await clock1.ensureClockedIn('Plan for a timesheet close test');
    await expect(openSessionRows(session2)).toHaveCount(1, { timeout: 15000 });

    await clock1.ensureClockedOut();

    await expect(openSessionRows(session2)).toHaveCount(0, { timeout: 15000 });
  });

  test('the synced row survives a reload of the observing tab', async () => {
    // A live update that never reached the server would vanish on refetch.
    const before = await sessionRows(session2).count();
    await clock1.ensureClockedIn('Plan for a timesheet persistence test');
    await expect(sessionRows(session2)).toHaveCount(before + 1, { timeout: 15000 });

    await openTimesheet(session2);

    await expect(sessionRows(session2)).toHaveCount(before + 1, { timeout: 15000 });
  });
});
