/**
 * The ticket table on a phone (#637, #660): each ticket is a compact row (its
 * title in full, where it sits, then badges), and nothing scrolls sideways.
 * Rows have no checkbox until Select is pressed, and Open/Close and the
 * sort-and-filter menu sit in the table's header.
 */
import { test, expect } from '@playwright/test';

import { TEST_USERS, loginAs } from '../fixtures/users';
import { ClockPage } from '../pages/ClockPage';
import { TicketsPage } from '../pages/TicketsPage';

const PHONE = { width: 390, height: 844 };

test.describe('Ticket rows on a phone', () => {
  let tickets: TicketsPage;

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(PHONE);
    await loginAs(page, TEST_USERS.owner1);
    tickets = new TicketsPage(page);
    await tickets.goto();
  });

  test('fits the screen, with no sideways scroll', async ({ page }) => {
    const title = `E2E Phone Row ${Date.now()}`;
    await tickets.createTicket(title);
    await expect(tickets.rowByTitle(title)).toBeVisible();

    const overflow = await page.evaluate(() => {
      const area = document.querySelector<HTMLElement>('.ticket-table-scroll');
      return area ? area.scrollWidth - area.clientWidth : null;
    });
    expect(overflow).not.toBeNull();
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('lays a ticket out as title, details and badges, and keeps its menu in reach', async ({
    page,
  }) => {
    const title = `E2E Phone Facts ${Date.now()}`;
    await tickets.createTicket(title);
    const row = tickets.rowByTitle(title);

    // The title, then where the ticket sits, then who has it and its state.
    await expect(row.locator('.ticket-row-meta')).toContainText('#');
    await expect(row.locator('.ticket-row-facts')).toContainText(TEST_USERS.owner1.name);
    await expect(row.locator('.ticket-row-facts')).toContainText('TimeHuddle');
    await expect(row.locator('.ticket-row-facts')).toContainText('open');
    const lines = await row
      .locator('.ticket-row-body > *')
      .evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBeLessThan(lines[1]);
    expect(lines[1]).toBeLessThan(lines[2]);

    const menu = row.getByRole('button', { name: 'Ticket options' });
    await expect(menu).toBeVisible();
    const box = await menu.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x + box!.width).toBeLessThanOrEqual(PHONE.width);

    // The columns those facts had on a wide screen are gone.
    await expect(page.getByRole('columnheader', { name: /Status/ })).toHaveCount(0);
  });

  test('shows checkboxes only while selecting, and drops the selection after', async () => {
    const title = `E2E Phone Select ${Date.now()}`;
    await tickets.createTicket(title);
    const row = tickets.rowByTitle(title);

    await expect(row.getByRole('checkbox')).toHaveCount(0);
    await expect(tickets.selectAllCheckbox).toHaveCount(0);

    await tickets.selectModeButton.click();
    await expect(tickets.doneSelectingButton).toHaveAttribute('aria-pressed', 'true');
    await expect(tickets.selectAllCheckbox).toBeVisible();
    await tickets.selectTicket(title);
    await expect(tickets.moveToBoardButton).toBeVisible();

    // Done hides the checkboxes, so nothing may stay ticked behind them.
    await tickets.doneSelectingButton.click();
    await expect(row.getByRole('checkbox')).toHaveCount(0);
    await expect(tickets.moveToBoardButton).toHaveCount(0);
    await tickets.selectModeButton.click();
    await expect(row.getByRole('checkbox')).not.toBeChecked();
  });

  test('drops the selection when the view or the layout changes', async ({ page }) => {
    const title = `E2E Phone Reset ${Date.now()}`;
    await tickets.createTicket(title);
    const row = tickets.rowByTitle(title);

    // Switching view ends selection mode and clears what was ticked.
    await tickets.selectModeButton.click();
    await row.getByRole('checkbox').check();
    await expect(tickets.deselectAllButton).toBeVisible();
    await tickets.switchToTab('my-board');
    await expect(tickets.deselectAllButton).toHaveCount(0);
    await expect(tickets.selectModeButton).toHaveAttribute('aria-pressed', 'false');
    await tickets.switchToTab('tickets');
    await expect(row.getByRole('checkbox')).toHaveCount(0);

    // A row ticked in the wide table is not left selected, unseen, on a phone.
    await page.setViewportSize({ width: 1280, height: 800 });
    await row.getByRole('checkbox').check();
    await expect(tickets.deselectAllButton).toBeVisible();
    await page.setViewportSize(PHONE);
    await expect(tickets.deselectAllButton).toHaveCount(0);
    await expect(row.getByRole('checkbox')).toHaveCount(0);

    // And selection mode on a phone does not carry over to the wide table.
    await tickets.selectModeButton.click();
    await row.getByRole('checkbox').check();
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(tickets.deselectAllButton).toHaveCount(0);
    await expect(row.getByRole('checkbox')).not.toBeChecked();
  });

  test('switches between open and closed tickets from the header', async ({ page }) => {
    const title = `E2E Phone Closed ${Date.now()}`;
    await tickets.createTicket(title);
    const showOpen = tickets.openOption;
    const showClosed = tickets.closedOption;

    // One switcher only: the toolbar's copy is the wide screen's.
    await expect(showOpen).toHaveCount(1);
    await expect(showOpen).toBeChecked();
    await expect(showOpen).toHaveAccessibleName(/^Open tickets, \d+\+?$/);
    await expect(page.locator('.ticket-view-controls')).toBeHidden();

    await showClosed.click();
    await expect(showClosed).toBeChecked();
    await expect(tickets.rowByTitle(title)).toHaveCount(0);

    // Still there when the closed list is empty and the table is not drawn.
    await showOpen.click();
    await expect(tickets.rowByTitle(title)).toBeVisible();
  });

  test('sorts and filters from one menu in the header', async ({ page }) => {
    const title = `E2E Phone Menu ${Date.now()}`;
    await tickets.createTicket(title);
    const menuButton = page.getByRole('button', { name: /^Sort and filter/ });

    // Sorting: the Title header is still there to report it.
    await menuButton.click();
    await page.getByRole('menuitem', { name: 'Title', exact: true }).click();
    await expect(page.getByRole('columnheader', { name: /Title/ })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
    // The menu says which field is sorted, and which way, in words.
    await menuButton.click();
    await expect(page.getByRole('menuitem', { name: 'Title (sorted ascending)' })).toBeVisible();
    await page.keyboard.press('Escape');

    // Filtering: the same choices a column's own filter offers on a wide screen.
    await menuButton.click();
    await page.getByRole('menuitem', { name: 'TimeHuddle', exact: true }).click();
    await expect(tickets.rowByTitle(title)).toBeVisible();
    await expect(tickets.rowsFromSource('redmine')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Sort and filter, 1 filter on' })).toBeVisible();
    // The section says which choice is applied, not only that one is.
    await page.getByRole('button', { name: 'Sort and filter, 1 filter on' }).click();
    await expect(page.getByRole('menu').getByText('Filter by Source: TimeHuddle')).toBeVisible();
    await page.keyboard.press('Escape');

    // Clearing them is in the same menu; the toolbar has no room for it here.
    await page.getByRole('button', { name: 'Sort and filter, 1 filter on' }).click();
    await page.getByRole('menuitem', { name: 'Clear filters' }).click();
    await expect(page.getByRole('button', { name: 'Sort and filter', exact: true })).toBeVisible();
  });

  test('works from the keyboard: focus goes in, arrows move, Escape comes back', async ({
    page,
  }) => {
    await tickets.createTicket(`E2E Phone Keys ${Date.now()}`);
    const menuButton = page.getByRole('button', { name: /^Sort and filter/ });
    const items = page.getByRole('menuitem');

    await menuButton.click();
    await expect(items.first()).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(items.nth(1)).toBeFocused();
    await page.keyboard.press('End');
    await expect(items.last()).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(menuButton).toBeFocused();

    // Choosing an item also hands focus back, since the item itself goes away.
    await menuButton.click();
    await items.first().press('Enter');
    await expect(menuButton).toBeFocused();

    // Tab closes the menu, so its arrow keys cannot reach into the page.
    await menuButton.click();
    await expect(items.first()).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('menu')).toHaveCount(0);
  });

  test('keeps the whole menu reachable on a short screen', async ({ page }) => {
    await tickets.createTicket(`E2E Phone Short ${Date.now()}`);
    await page.setViewportSize({ width: 390, height: 520 });

    await page.getByRole('button', { name: /^Sort and filter/ }).click();
    const last = page.getByRole('menuitem').last();
    await last.scrollIntoViewIfNeeded();
    const box = await last.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y + box!.height).toBeLessThanOrEqual(520);
  });

  test('wraps a long title instead of cutting it off', async () => {
    const title = `E2E Phone Wrap ${Date.now()} with a title long enough that it cannot fit on one line of a phone`;
    await tickets.createTicket(title);
    const titleButton = tickets.rowByTitle(title).locator('.ticket-row-title');

    await expect(titleButton).toHaveText(title);
    const { height, clipped } = await titleButton.evaluate((el) => ({
      height: el.getBoundingClientRect().height,
      clipped: el.scrollWidth > el.clientWidth + 1,
    }));
    // Taller than one line of text, and nothing hidden off the edge.
    expect(height).toBeGreaterThan(30);
    expect(clipped).toBe(false);
  });

  test('My Board fits a 360px screen, timer column included', async ({ page }) => {
    // My Board adds the ▶/⏸ column, so it is the tightest layout there is;
    // 360px is the narrowest phone the app supports.
    const narrow = { width: 360, height: 740 };
    await new ClockPage(page).ensureClockedIn();
    await page.setViewportSize(narrow);
    await tickets.goto();

    const title = `E2E Phone Board ${Date.now()}`;
    await tickets.createTicket(title);
    await tickets.selectModeButton.click();
    await tickets.moveToBoard(title);
    const row = tickets.rowByTitle(title);
    await expect(row).toBeVisible();
    // Switching view left selection mode; go back in, for the row at its tightest.
    await tickets.selectModeButton.click();

    const overflow = await page.evaluate(() => {
      const area = document.querySelector<HTMLElement>('.ticket-table-scroll');
      return area ? area.scrollWidth - area.clientWidth : null;
    });
    expect(overflow).not.toBeNull();
    expect(overflow).toBeLessThanOrEqual(1);

    // Every control on the row is on screen: select (in selection mode, the
    // tightest the row gets), timer, and the row menu.
    const controls = [
      row.getByRole('checkbox'),
      tickets.timerButtonForRow(title),
      row.getByRole('button', { name: 'Ticket options' }),
    ];
    for (const control of controls) {
      const box = await control.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(narrow.width);
    }

    await tickets.selectTicket(title);
    await expect(tickets.removeFromBoardButton).toBeVisible();
    await tickets.doneSelectingButton.click();

    await tickets.startTimerButton(title).click();
    await expect(tickets.stopTimerButton(title)).toBeVisible();
    await tickets.stopTimerButton(title).click();
    await expect(tickets.startTimerButton(title)).toBeVisible();
  });

  test('goes back to one column per fact on a wide screen', async ({ page }) => {
    const title = `E2E Phone Resize ${Date.now()}`;
    await tickets.createTicket(title);
    await expect(tickets.rowByTitle(title).locator('.ticket-row-facts')).toBeVisible();

    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(tickets.rowByTitle(title).locator('.ticket-row-facts')).toHaveCount(0);
    await expect(page.getByRole('columnheader', { name: /Status/ }).first()).toBeVisible();
  });
});
