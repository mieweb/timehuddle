/**
 * Clock-out carry-over (M5, #887): clocking out takes the tickets checked off
 * in today's plan out of My Board's Pinned, back to the rest; the unchecked
 * ones stay pinned, in order. The one still running is asked about at
 * clock-out, and kept here.
 *
 * Driven end to end: pins, Start session, Today's plan (M4) checkboxes, and a
 * clock-out with a wrap-up. Pulse ends a session through the same server
 * path (`clockStop`), covered in meteor-backend/tests/carry-over.test.ts.
 */
import { test, expect, type Page } from '@playwright/test';

import { selectSharedTestTeam } from '../fixtures/team';
import { TEST_USERS, loginAs } from '../fixtures/users';
import { setSharedTeamPlanGate } from '../huddle/helpers';
import { ClockPage } from '../pages/ClockPage';
import { TicketsPage } from '../pages/TicketsPage';
import { getSessionToken } from './helpers';

/** `titles` in the order they appear in Pinned; the ones not pinned are left out. */
async function pinnedOrder(page: Page, titles: string[]): Promise<string[]> {
  return page.evaluate((titles) => {
    const items = [...document.querySelectorAll('[data-slot="reorderable-list-item"]')];
    const restAt = items.findIndex((item) =>
      item.querySelector('.row-list-section-heading')?.textContent?.includes('Rest of my board'),
    );
    return items
      .slice(0, restAt)
      .map((item) => titles.find((title) => item.textContent?.includes(title)))
      .filter((title): title is string => Boolean(title));
  }, titles);
}

test.describe('Clock-out carry-over', () => {
  test.beforeAll(() => setSharedTeamPlanGate(true));
  test.afterAll(() => setSharedTeamPlanGate(false));

  test('checked-off pins leave Pinned at clock-out; the rest, and a running one kept, stay', async ({
    page,
    request,
  }) => {
    test.slow();
    await loginAs(page, TEST_USERS.owner1);
    await selectSharedTestTeam(page);
    const clock = new ClockPage(page);
    await clock.goto();
    if (await clock.clockOutButton.isVisible().catch(() => false)) {
      await clock.clockOutButton.click();
      await clock.answerRunningTicket();
    } else {
      await clock.ensureClockedOut();
    }
    await expect(clock.banner).toContainText(/Clocked out/i);

    // Four tickets on the board, pinned in order.
    const stamp = Date.now();
    const titles = ['A', 'B', 'C', 'D'].map((n) => `E2E Carry ${n} ${stamp}`);
    const tickets = new TicketsPage(page);
    await tickets.goto();
    for (const title of titles) await tickets.createTicket(title);
    for (const title of titles) await tickets.selectTicket(title);
    await tickets.moveToBoardButton.click();
    await tickets.switchToTab('my-board');
    const ids = await Promise.all(
      titles.map((title) => tickets.rowByTitle(title).getAttribute('data-ticket-id')),
    );
    const res = await request.post('/api/myBoard_setPins', {
      headers: { Authorization: `Bearer ${await getSessionToken(page)}` },
      data: { refs: ids.map((ticketId) => ({ sourceId: 'huddle', ticketId })) },
    });
    expect(res.ok(), await res.text()).toBe(true);
    await page.reload();
    await tickets.switchToTab('my-board');
    await expect.poll(() => pinnedOrder(page, titles)).toEqual(titles);

    // Start session: the plan holds the four, and A runs once clocked in.
    await page.getByRole('button', { name: /^Start session/ }).click();
    await expect(page).toHaveURL(/\/app\/clock(\?|$)/);
    // Clock in once the pins are written in, or the plan posts without them.
    for (const title of titles) await expect(clock.proseMirror).toContainText(title);
    await clock.postPlanAndClockIn();
    await expect(page).toHaveURL(/\/app\/tickets(\?|$)/, { timeout: 15000 });

    // Check off B and C, and A while it's still running; D stays unchecked.
    await clock.goto();
    const plan = page.locator('.clock-plan-composer');
    const boxes = plan.getByRole('checkbox');
    await expect(boxes).toHaveCount(4);
    for (const index of [0, 1, 2]) {
      const saved = page.waitForResponse('**/api/clock_checkPlanItem');
      await boxes.nth(index).check();
      await saved;
    }

    // A still runs: clocking out asks, and keeping it unchecks it.
    await clock.typeWrapUp('Carry-over check');
    await clock.postWrapUpAndClockOutButton.click();
    await expect(clock.runningTicketDialog).toContainText(titles[0]);
    await clock.answerRunningTicket('Keep for next session');
    await expect(clock.banner).toContainText(/Clocked out/i);

    await tickets.goto();
    await tickets.switchToTab('my-board');
    await expect.poll(() => pinnedOrder(page, titles)).toEqual([titles[0], titles[3]]);
    // Unpinned, still on the board.
    for (const title of titles) await expect(tickets.rowByTitle(title)).toBeVisible();
  });
});
