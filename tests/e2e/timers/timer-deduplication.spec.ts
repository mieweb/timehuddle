/**
 * Timer deduplication — starting a ticket timer several times in one day must
 * reuse the same WorkItem rather than creating a row per start.
 *
 * Timers are started from My Board (M3 D1), so the flow here is: clock in,
 * create a ticket, move it to My Board, then drive its ▶/⏸ button. The
 * uniqueness key is `{userId, source, ticketId, date}` — this covers the
 * same-day half of that; `timers.test.ts` covers the per-date and per-source
 * halves at the API level.
 */
import { test, expect, type Page } from '@playwright/test';

import { TEST_USERS, loginAs } from '../fixtures/users';
import { ClockPage } from '../pages/ClockPage';
import { TicketsPage } from '../pages/TicketsPage';

/**
 * The Work page's own day table. Scoped by its accessible name because
 * `TicketsPage` stays mounted (hidden) on every route, so a bare `tbody tr`
 * also matches ticket rows.
 */
const workItemRows = (page: Page, title: string) =>
  page
    .getByRole('table', { name: /Work items for/ })
    .locator('tbody tr')
    .filter({ hasText: title });

test.describe('Timer Deduplication', () => {
  let tickets: TicketsPage;
  let clock: ClockPage;

  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USERS.owner1);
    clock = new ClockPage(page);
    tickets = new TicketsPage(page);
    await clock.ensureClockedIn('Plan for the timer deduplication test');
  });

  test('reuses one work item across repeated starts on the same day', async ({ page }) => {
    const title = `Dedup Test ${Date.now()}`;
    await tickets.goto();
    await tickets.createTicket(title);
    await tickets.moveToBoard(title);

    // Three start/stop cycles against the same ticket on the same day.
    for (let i = 0; i < 3; i++) {
      await tickets.startTimerButton(title).click();
      await expect(tickets.stopTimerButton(title)).toBeVisible();
      await tickets.stopTimerButton(title).click();
      await expect(tickets.startTimerButton(title)).toBeVisible();
    }

    await page.goto('/app/work');
    await page.waitForLoadState('domcontentloaded');

    await expect(workItemRows(page, title)).toHaveCount(1);
  });

  test('records the session on the Work page for the day it ran', async ({ page }) => {
    const title = `Dates Test ${Date.now()}`;
    await tickets.goto();
    await tickets.createTicket(title);
    await tickets.moveToBoard(title);

    await tickets.startTimerButton(title).click();
    await expect(tickets.stopTimerButton(title)).toBeVisible();
    await tickets.stopTimerButton(title).click();
    await expect(tickets.startTimerButton(title)).toBeVisible();

    await page.goto('/app/work');
    await page.waitForLoadState('domcontentloaded');
    await expect(workItemRows(page, title)).toHaveCount(1);
  });
});
