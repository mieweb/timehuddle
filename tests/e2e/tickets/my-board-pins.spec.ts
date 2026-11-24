/**
 * My Board's Pinned section (#884): pin and unpin from a row's ⋮ menu, put
 * pins in order by drag or Alt+↑/↓, move tickets into and out of Pinned
 * across the "Rest of my board" heading, and the headings that stick to the
 * top as the list scrolls; and Start session, which plans the pins and starts
 * the first once the user clocks in.
 *
 * Both sections are one ReorderableList (src/ui/RowList.tsx), each heading a
 * fixed row in it; where a row sits relative to the "Rest of my board"
 * heading is what says which section it's in.
 */
import { test, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';

import { TEST_USERS, loginAs } from '../fixtures/users';
import { ClockPage } from '../pages/ClockPage';
import { TicketsPage } from '../pages/TicketsPage';
import { getSessionToken } from './helpers';

const REST_HEADING = 'Rest of my board';

/** The reorderable list item a ticket row sits in: what drags and takes Alt+↑/↓. */
function listItem(tickets: TicketsPage, title: string): Locator {
  return tickets
    .rowByTitle(title)
    .locator('xpath=ancestor::*[@data-slot="reorderable-list-item"][1]');
}

/** `titles` in the order they appear in Pinned; the ones not pinned are left out. */
async function pinnedOrder(page: Page, titles: string[]): Promise<string[]> {
  return page.evaluate(
    ({ titles, rest }) => {
      const items = [...document.querySelectorAll('[data-slot="reorderable-list-item"]')];
      const restAt = items.findIndex((item) =>
        item.querySelector('.row-list-section-heading')?.textContent?.includes(rest),
      );
      return items
        .slice(0, restAt)
        .map((item) => titles.find((title) => item.textContent?.includes(title)))
        .filter((title): title is string => Boolean(title));
    },
    { titles, rest: REST_HEADING },
  );
}

/** Makes `ticketIds` (TimeHuddle tickets on the board) the pins, in order, over REST. */
async function setPins(page: Page, request: APIRequestContext, ticketIds: string[]) {
  const res = await request.post('/api/myBoard_setPins', {
    headers: { Authorization: `Bearer ${await getSessionToken(page)}` },
    data: { refs: ticketIds.map((ticketId) => ({ sourceId: 'huddle', ticketId })) },
  });
  expect(res.ok(), await res.text()).toBe(true);
}

/** Waits for the next save of the pin list (a drag or keyboard move). */
function pinsSaved(page: Page) {
  return page.waitForResponse((res) => res.url().includes('myBoard_setPins') && res.ok());
}

async function pinFromMenu(
  page: Page,
  tickets: TicketsPage,
  title: string,
  action: 'Pin' | 'Unpin',
) {
  await tickets.rowByTitle(title).getByRole('button', { name: 'Ticket options' }).click();
  await page.getByRole('menuitem', { name: action, exact: true }).click();
}

test.describe('My Board pins', () => {
  let tickets: TicketsPage;

  test.beforeEach(async ({ page, request }) => {
    await loginAs(page, TEST_USERS.owner1);
    // Start from no pins: pins from an earlier test or retry would sit between
    // the ones a test makes.
    await setPins(page, request, []);
    tickets = new TicketsPage(page);
    await tickets.goto();
  });

  /** Creates tickets with these titles and puts them all on My Board. */
  async function onBoard(...titles: string[]) {
    for (const title of titles) await tickets.createTicket(title);
    for (const title of titles) await tickets.selectTicket(title);
    await tickets.moveToBoardButton.click();
    await tickets.switchToTab('my-board');
    for (const title of titles) await expect(tickets.rowByTitle(title)).toBeVisible();
  }

  test('pins from the row menu, new pins at the bottom, kept across a reload', async ({ page }) => {
    const stamp = Date.now();
    const [first, second] = [`E2E Pin A ${stamp}`, `E2E Pin B ${stamp}`];
    await onBoard(first, second);
    expect(await pinnedOrder(page, [first, second])).toEqual([]);

    await pinFromMenu(page, tickets, second, 'Pin');
    await expect.poll(() => pinnedOrder(page, [first, second])).toEqual([second]);
    await pinFromMenu(page, tickets, first, 'Pin');
    await expect.poll(() => pinnedOrder(page, [first, second])).toEqual([second, first]);

    await page.reload();
    await tickets.switchToTab('my-board');
    await expect(tickets.rowByTitle(first)).toBeVisible();
    expect(await pinnedOrder(page, [first, second])).toEqual([second, first]);

    // Unpin keeps the ticket on the board, back with the rest.
    await pinFromMenu(page, tickets, second, 'Unpin');
    await expect.poll(() => pinnedOrder(page, [first, second])).toEqual([first]);
    await expect(tickets.rowByTitle(second)).toBeVisible();
  });

  test('moves tickets into, within and out of Pinned with Alt+arrows, announced', async ({
    page,
  }) => {
    const stamp = Date.now();
    const [first, second] = [`E2E Keys A ${stamp}`, `E2E Keys B ${stamp}`];
    await onBoard(first, second);
    await pinFromMenu(page, tickets, first, 'Pin');
    await expect.poll(() => pinnedOrder(page, [first, second])).toEqual([first]);

    // Rest is newest first, so the new `second` is its first row: one step up
    // crosses the heading into Pinned, at the bottom.
    let saved = pinsSaved(page);
    await listItem(tickets, second).focus();
    await page.keyboard.press('Alt+ArrowUp');
    await saved;
    await expect.poll(() => pinnedOrder(page, [first, second])).toEqual([first, second]);
    await expect(page.getByText(/^Pinned, position \d+ of \d+$/)).toBeAttached();

    // Within Pinned: one step down puts `first` after `second`, and it's
    // `first` that's announced, though a swap of neighbours reads the same
    // whichever of them moved.
    saved = pinsSaved(page);
    await listItem(tickets, first).focus();
    await page.keyboard.press('Alt+ArrowDown');
    await saved;
    await expect.poll(() => pinnedOrder(page, [first, second])).toEqual([second, first]);
    await expect(
      page.locator('.row-list-sections > [aria-live="polite"]:not([data-slot])'),
    ).toHaveText('Pinned, position 2 of 2');

    // `first` is the last pin: one step down crosses the heading out of Pinned.
    saved = pinsSaved(page);
    await listItem(tickets, first).focus();
    await page.keyboard.press('Alt+ArrowDown');
    await saved;
    await expect.poll(() => pinnedOrder(page, [first, second])).toEqual([second]);
    await expect(page.getByText(`Moved to ${REST_HEADING}`)).toBeAttached();

    await page.reload();
    await tickets.switchToTab('my-board');
    await expect(tickets.rowByTitle(first)).toBeVisible();
    expect(await pinnedOrder(page, [first, second])).toEqual([second]);
  });

  test('a key press still works after a mouse press in the list', async ({ page }) => {
    await onBoard(`E2E Keys After Mouse ${Date.now()}`);
    const heading = page.getByRole('button', { name: /^(Fold|Unfold) Pinned$/ });
    await heading.click();
    await expect(heading).toHaveAccessibleName('Unfold Pinned');
    // A keyboard click has no pointer position; it isn't the end of a drag.
    await heading.focus();
    await page.keyboard.press('Enter');
    await expect(heading).toHaveAccessibleName('Fold Pinned');
  });

  test('a move within Rest of my board changes nothing: it keeps the sort', async ({ page }) => {
    const stamp = Date.now();
    const [first, second] = [`E2E Rest A ${stamp}`, `E2E Rest B ${stamp}`];
    await onBoard(first, second);
    // The rows' order by ticket id: their text has relative times that can
    // tick over ("Just now" → "1m ago") while the test waits.
    const rowOrder = () =>
      tickets.activePanel
        .locator('[data-ticket-id]')
        .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-ticket-id')));
    const before = await rowOrder();

    let saves = 0;
    page.on('request', (req) => {
      if (req.url().includes('myBoard_setPins')) saves += 1;
    });
    // `first` is older, so it sorts below `second`; up within Rest is refused.
    await listItem(tickets, first).focus();
    await page.keyboard.press('Alt+ArrowUp');
    await page.waitForTimeout(800);

    expect(saves).toBe(0);
    expect(await rowOrder()).toEqual(before);
  });

  test('drags a ticket from Rest to the top of Pinned, without opening it', async ({ page }) => {
    const stamp = Date.now();
    const [first, second] = [`E2E Drag A ${stamp}`, `E2E Drag B ${stamp}`];
    await onBoard(first, second);
    await pinFromMenu(page, tickets, first, 'Pin');
    await expect.poll(() => pinnedOrder(page, [first, second])).toEqual([first]);
    const url = page.url();

    // A real pointer drag: press, move past the 5px start threshold, then
    // step onto the top of the pinned row so the list slides it aside.
    const from = (await listItem(tickets, second).boundingBox())!;
    const to = (await listItem(tickets, first).boundingBox())!;
    const x = from.x + from.width / 2;
    const saved = pinsSaved(page);
    await page.mouse.move(x, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(x, from.y + from.height / 2 - 10, { steps: 5 });
    await page.mouse.move(x, to.y + 5, { steps: 20 });
    await page.mouse.up();
    await saved;

    expect(await pinnedOrder(page, [first, second])).toEqual([second, first]);
    // The release isn't a click on the row it lands on.
    expect(page.url()).toBe(url);
  });

  test('section headings stick to the top on a phone, and a stuck one jumps back', async ({
    page,
    request,
  }) => {
    const stamp = Date.now();
    const titles = [1, 2, 3, 4, 5].map((n) => `E2E Sticky ${n} ${stamp}`);
    await onBoard(...titles);
    // Pinned over REST: the menu is covered above, and this is about scrolling.
    const ids = await Promise.all(
      titles.slice(0, 2).map((title) => tickets.rowByTitle(title).getAttribute('data-ticket-id')),
    );
    await setPins(page, request, ids as string[]);
    await page.setViewportSize({ width: 390, height: 640 });
    await page.reload();
    await tickets.switchToTab('my-board');
    await expect.poll(() => pinnedOrder(page, titles)).toEqual([titles[0], titles[1]]);

    const pinnedHeading = page.getByRole('button', { name: /^(Fold|Unfold|Go to) Pinned$/ });
    await expect(pinnedHeading).toHaveAccessibleName('Fold Pinned');

    // Scroll the list a little: Pinned's heading sticks, and tapping it now
    // takes you back to the section instead of folding it.
    await tickets.rowByTitle(titles[0]).evaluate((row) => {
      let scroller = row.parentElement;
      while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) {
        scroller = scroller.parentElement;
      }
      scroller?.scrollBy({ top: 400 });
    });
    await expect(pinnedHeading).toHaveAccessibleName('Go to Pinned');
    await expect(page.locator('.row-list-section-heading[data-stuck]').first()).toBeVisible();

    await pinnedHeading.click();
    await expect(pinnedHeading).toHaveAccessibleName('Fold Pinned');
    await expect(tickets.rowByTitle(titles[0])).toBeInViewport();
  });

  test('Start session plans the pins in order and starts the first at clock-in', async ({
    page,
    request,
  }) => {
    test.slow();
    const clock = new ClockPage(page);
    await clock.ensureClockedOut();
    await tickets.goto();
    const stamp = Date.now();
    const titles = ['A', 'B', 'C'].map((n) => `E2E Session ${n} ${stamp}`);
    await onBoard(...titles);
    // Pinned in an order of their own, not the order they were made in.
    const pinned = [titles[2], titles[0], titles[1]];
    const ids = await Promise.all(
      pinned.map((title) => tickets.rowByTitle(title).getAttribute('data-ticket-id')),
    );
    await setPins(page, request, ids as string[]);
    await page.reload();
    await tickets.switchToTab('my-board');
    await expect.poll(() => pinnedOrder(page, titles)).toEqual(pinned);

    await page.getByRole('button', { name: /^Start session/ }).click();
    await expect(page).toHaveURL(/\/app\/clock(\?|$)/);
    await expect(
      page.getByText(`The timer on ${pinned[0]} starts when you clock in.`),
    ).toBeVisible();
    for (const title of pinned) await expect(clock.proseMirror).toContainText(title);

    const posted = page.waitForRequest((req) => req.url().includes('/api/huddle_createPost'));
    await clock.postPlanAndClockIn();
    const plan = JSON.stringify((await posted).postDataJSON());
    const places = pinned.map((title) => plan.indexOf(title));
    expect(places.every((at) => at >= 0)).toBe(true);
    expect(places).toEqual([...places].sort((a, b) => a - b));

    // Back on the board, with the first pin's timer running.
    await expect(page).toHaveURL(/\/app\/tickets(\?|$)/, { timeout: 15000 });
    await tickets.switchToTab('my-board');
    await expect(tickets.stopTimerButton(pinned[0])).toBeVisible({ timeout: 10000 });

    await tickets.stopTimerButton(pinned[0]).click();
    await clock.ensureClockedOut();
  });
});
