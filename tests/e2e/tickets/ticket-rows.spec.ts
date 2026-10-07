/**
 * The ticket list's one row layout (#668): at every width each ticket is a row
 * — its title in full, where it sits, then its properties — that spreads out
 * as the list gets more room, and nothing scrolls sideways.
 */
import { test, expect } from '@playwright/test';

import { TEST_USERS, loginAs } from '../fixtures/users';
import { ClockPage } from '../pages/ClockPage';
import { TicketsPage } from '../pages/TicketsPage';

const PHONE = { width: 390, height: 844 };

/** How far the list scrolls sideways; 0 when it fits. */
const sidewaysOverflow = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const area = document.querySelector<HTMLElement>(
      '.tickets-view-panel:not(.hidden) .row-list-scroll',
    );
    return area ? area.scrollWidth - area.clientWidth : null;
  });

test.describe('Ticket rows', () => {
  let tickets: TicketsPage;

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(PHONE);
    await loginAs(page, TEST_USERS.owner1);
    tickets = new TicketsPage(page);
    await tickets.goto();
  });

  test('fits every width, with no sideways scroll', async ({ page }) => {
    const title = `E2E Phone Row ${Date.now()}`;
    await tickets.createTicket(title);
    await expect(tickets.rowByTitle(title)).toBeVisible();

    for (const width of [360, 600, 900, 1280, 1920]) {
      await page.setViewportSize({ width, height: 800 });
      const overflow = await sidewaysOverflow(page);
      expect(overflow, `at ${width}px`).not.toBeNull();
      expect(overflow, `at ${width}px`).toBeLessThanOrEqual(1);
    }
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
      .locator('.row-list-title, .row-list-meta, .row-list-properties')
      .evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBeLessThan(lines[1]);
    expect(lines[1]).toBeLessThan(lines[2]);

    const menu = row.getByRole('button', { name: 'Ticket options' });
    await expect(menu).toBeVisible();
    const box = await menu.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x + box!.width).toBeLessThanOrEqual(PHONE.width);

    // There are no columns at all.
    await expect(page.getByRole('columnheader')).toHaveCount(0);
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

  test('keeps desktop selection controls and progressively collapses filters to fit', async ({
    page,
  }) => {
    const title = `E2E Responsive Filters ${Date.now()}`;
    await tickets.createTicket(title);
    await page.setViewportSize({ width: 1280, height: 800 });
    const row = tickets.rowByTitle(title);
    const listCard = tickets.activePanel.locator('.ticket-list-card');
    const inlineFilters = tickets.activePanel.locator('[data-ticket-inline-filter]');

    await expect(row.getByRole('checkbox')).toBeVisible();
    await expect(tickets.selectModeButton).toBeHidden();
    await expect(inlineFilters).toHaveCount(5);

    // Keep the viewport fixed: only the list's available container width changes.
    await listCard.evaluate((element) => {
      (element as HTMLElement).style.flex = 'none';
      (element as HTMLElement).style.width = '420px';
    });
    await expect.poll(() => inlineFilters.count()).toBeLessThan(5);

    await tickets.sortFilterButton.click();
    await expect(page.getByRole('menu').getByRole('group', { name: /^Filter by / })).toHaveCount(
      5 - (await inlineFilters.count()),
    );
    for (const field of ['Source', 'Status', 'Priority', 'Assignees', 'Project']) {
      const inlineFilter = page.getByRole('button', {
        name: new RegExp(`^Filter by ${field}(?::|$)`),
      });
      if (!(await inlineFilter.isVisible())) {
        await expect(tickets.filterSection(field)).toBeVisible();
      }
    }
    await page.keyboard.press('Escape');

    await listCard.evaluate((element) => {
      (element as HTMLElement).style.width = '1100px';
    });
    await expect(inlineFilters).toHaveCount(5);
  });

  test('drops the selection when the view changes, but preserves it when resizing', async ({
    page,
  }) => {
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

    // Enter selection mode before resizing: desktop keeps checkboxes visible,
    // and the phone's Select control preserves the selected ticket on return.
    await page.setViewportSize(PHONE);
    await tickets.selectModeButton.click();
    await row.getByRole('checkbox').check();
    await expect(tickets.deselectAllButton).toBeVisible();

    // Resizing never hides a selected row's checkbox or changes selection mode.
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(tickets.deselectAllButton).toBeVisible();
    await page.setViewportSize(PHONE);
    await expect(tickets.deselectAllButton).toBeVisible();
    await expect(row.getByRole('checkbox')).toBeChecked();

    // The same selection stays visible when the list grows again.
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(tickets.deselectAllButton).toBeVisible();
    await expect(row.getByRole('checkbox')).toBeChecked();
  });

  test('switches between open and closed tickets from the header', async ({ page }) => {
    const title = `E2E Phone Closed ${Date.now()}`;
    await tickets.createTicket(title);
    const showOpen = tickets.openOption;
    const showClosed = tickets.closedOption;

    // One switcher only, always in the list header.
    await expect(showOpen).toHaveCount(1);
    await expect(showOpen).toBeChecked();
    await expect(showOpen).toHaveAccessibleName(/^Open tickets, \d+\+?$/);
    await expect(page.locator('.ticket-view-controls')).toHaveCount(0);

    await showClosed.click();
    await expect(showClosed).toBeChecked();
    await expect(tickets.rowByTitle(title)).toHaveCount(0);

    // Still there when the closed list is empty and the table is not drawn.
    await showOpen.click();
    await expect(tickets.rowByTitle(title)).toBeVisible();
  });

  test('sorts from the overflow menu and filters from the available control', async ({ page }) => {
    const title = `E2E Phone Menu ${Date.now()}`;
    await tickets.createTicket(title);
    const menuButton = page.getByRole('button', { name: /^Sort and filter/ });

    // Sorting: the menu says which field is sorted, and which way, in words.
    await menuButton.click();
    await page.getByRole('menuitem', { name: 'Title', exact: true }).click();
    await menuButton.click();
    await expect(page.getByRole('menuitem', { name: 'Title (sorted ascending)' })).toBeVisible();
    await page.keyboard.press('Escape');

    // A filter remains available whether inline or inside the overflow menu.
    await tickets.openFilter('Source');
    await page.getByRole('menuitem', { name: 'TimeHuddle', exact: true }).click();
    await expect(tickets.rowByTitle(title)).toBeVisible();
    await expect(tickets.rowsFromSource('redmine')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Sort and filter, 1 filter on' })).toBeVisible();

    // Clearing them remains available in the overflow menu.
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

    const overflow = await sidewaysOverflow(page);
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

  test('spreads the same row out as the list gets wider, with no layout swap', async ({ page }) => {
    const title = `E2E Resize ${Date.now()}`;
    await tickets.createTicket(title);
    const row = tickets.rowByTitle(title);
    const titleTop = () =>
      row.locator('.ticket-row-title').evaluate((el) => el.getBoundingClientRect().top);
    const factsTop = () =>
      row.locator('.row-list-properties').evaluate((el) => el.getBoundingClientRect().top);

    // Narrow: the properties wrap under the title.
    expect(await factsTop()).toBeGreaterThan((await titleTop()) + 10);

    // Wide: the same row, with its properties beside the title. No columns
    // appear, and the header controls stay where they were.
    await page.setViewportSize({ width: 1440, height: 800 });
    await expect(row.locator('.ticket-row-facts')).toContainText('TimeHuddle');
    expect(Math.abs((await factsTop()) - (await titleTop()))).toBeLessThanOrEqual(8);
    await expect(page.getByRole('columnheader')).toHaveCount(0);

    // Open/Closed sits at the start of the list header at every width.
    for (const width of [360, 1440]) {
      await page.setViewportSize({ width, height: 800 });
      const header = await tickets.activePanel.locator('.row-list-header').boundingBox();
      const open = await tickets.openOption.boundingBox();
      expect(header).not.toBeNull();
      expect(open).not.toBeNull();
      expect(open!.x - header!.x, `at ${width}px`).toBeLessThan(80);
      expect(open!.y - header!.y, `at ${width}px`).toBeLessThan(20);
    }
  });
});
