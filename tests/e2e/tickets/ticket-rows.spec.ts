/**
 * The ticket list's one row layout (#668): at every width each ticket is the
 * same row — where it sits, its title in full, then its badges under the title
 * — and nothing scrolls sideways. Sorting and filtering are pills in the list
 * header, which fold into a pane behind a chevron when they do not fit.
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

  test('lays a ticket out as details, title and badges, and keeps its menu in reach', async ({
    page,
  }) => {
    const title = `E2E Phone Facts ${Date.now()}`;
    await tickets.createTicket(title);
    const row = tickets.rowByTitle(title);

    // Where the ticket sits, then its title, then who has it and its state.
    await expect(row.locator('.ticket-row-meta')).toContainText(/TH-\d+/);
    await expect(row.locator('.ticket-row-facts')).toContainText(TEST_USERS.owner1.name);
    await expect(row.locator('.ticket-row-facts')).toContainText('TimeHuddle');
    await expect(row.locator('.ticket-row-facts')).toContainText('open');
    const lines = await row
      .locator('.row-list-meta, .row-list-title, .row-list-properties')
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

  test('keeps desktop selection controls, and folds the pills that do not fit into a pane', async ({
    page,
  }) => {
    const title = `E2E Responsive Pills ${Date.now()}`;
    await tickets.createTicket(title);
    await page.setViewportSize({ width: 1440, height: 800 });
    const row = tickets.rowByTitle(title);
    const listCard = tickets.activePanel.locator('.ticket-list-card');
    const inlinePills = tickets.activePanel.locator('.ticket-list-controls [data-ticket-pill]');
    const pane = tickets.activePanel.locator('.ticket-list-controls-pane');
    const PILLS = 8;

    await expect(row.getByRole('checkbox')).toBeVisible();
    await expect(tickets.selectModeButton).toBeHidden();
    // With room, every pill is on the header's line and there is no chevron.
    await expect(inlinePills).toHaveCount(PILLS);
    await expect(tickets.showAllControlsButton).toHaveCount(0);

    // Keep the viewport fixed: only the list's available container width changes.
    await listCard.evaluate((element) => {
      (element as HTMLElement).style.flex = 'none';
      (element as HTMLElement).style.width = '420px';
    });
    await expect.poll(() => inlinePills.count()).toBeLessThan(PILLS);

    // The chevron opens a pane holding every pill, the ones still on the line included.
    await tickets.showAllControlsButton.click();
    await expect(pane.locator('[data-ticket-pill]')).toHaveCount(PILLS);
    await expect(inlinePills).toHaveCount(0);

    // A different size is a different header: the pane closes, and with room
    // again the pills are back on the line.
    await listCard.evaluate((element) => {
      (element as HTMLElement).style.width = '1100px';
    });
    await expect(pane).toHaveCount(0);
    await expect(inlinePills).toHaveCount(PILLS);
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

  test('a selection made on a wide screen keeps its checkboxes on a phone', async ({ page }) => {
    const title = `E2E Wide Select ${Date.now()}`;
    await tickets.createTicket(title);
    const row = tickets.rowByTitle(title);

    // Wide: the checkboxes are there without Select being pressed.
    await page.setViewportSize({ width: 1280, height: 800 });
    await row.getByRole('checkbox').check();
    await expect(tickets.deselectAllButton).toBeVisible();

    // Narrowed to a phone, the ticked row is still shown ticked, and the
    // button offers Done rather than Select, which would wipe it.
    await page.setViewportSize(PHONE);
    await expect(row.getByRole('checkbox')).toBeChecked();
    await expect(tickets.doneSelectingButton).toHaveAttribute('aria-pressed', 'true');

    await tickets.doneSelectingButton.click();
    await expect(row.getByRole('checkbox')).toHaveCount(0);
    await expect(tickets.deselectAllButton).toHaveCount(0);
  });

  test("a row's menu works from the keyboard", async ({ page }) => {
    const title = `E2E Row Menu Keys ${Date.now()}`;
    await tickets.createTicket(title);
    const trigger = tickets.rowByTitle(title).getByRole('button', { name: 'Ticket options' });
    const items = page.getByRole('menu').getByRole('menuitem');

    // Focus goes into the menu, the arrows walk it, and Escape comes back.
    await trigger.click();
    await expect(items.first()).toBeFocused();
    await expect(items.first()).toHaveText('Ticket Details');
    await page.keyboard.press('ArrowDown');
    await expect(items.nth(1)).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test("a row's menu steps over a disabled choice", async ({ page }) => {
    const title = `E2E Row Menu Disabled ${Date.now()}`;
    await tickets.createTicket(title);
    // Until My Board has been read, its menu item is disabled: hold the read back.
    await page.route('**/api/myBoard_list', () => {});
    await page.reload();
    await tickets.waitForLoad();

    await tickets.rowByTitle(title).getByRole('button', { name: 'Ticket options' }).click();
    const menu = page.getByRole('menu');
    await expect(menu.getByRole('menuitem', { name: /My Board$/ })).toBeDisabled();

    // Ticket Details, Copy Link, then past the disabled My Board item.
    await expect(menu.getByRole('menuitem').first()).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('menuitem', { name: 'Copy Link' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('menuitem', { name: 'Edit Ticket' })).toBeFocused();
    await page.keyboard.press('Escape');
  });

  test("a row's menu closes when the list scrolls", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 600 });
    const stamp = Date.now();
    for (const n of [1, 2, 3, 4]) await tickets.createTicket(`E2E Menu Scroll ${stamp} ${n}`);
    await tickets.search(`E2E Menu Scroll ${stamp}`);

    await tickets.activePanel.getByRole('button', { name: 'Ticket options' }).first().click();
    await expect(page.getByRole('menu')).toBeVisible();

    // Kept open, it would ride along over the header as the rows move under it.
    await tickets.activePanel
      .locator('.row-list-scroll')
      .evaluate((area) => area.scrollBy({ top: 120 }));
    await expect(page.getByRole('menu')).toHaveCount(0);
  });

  test('leaving the page drops the selection', async ({ page }) => {
    const title = `E2E Leave Select ${Date.now()}`;
    await tickets.createTicket(title);
    await page.setViewportSize({ width: 1280, height: 800 });
    const row = tickets.rowByTitle(title);
    await row.getByRole('checkbox').check();
    await expect(tickets.deselectAllButton).toBeVisible();

    // The page stays mounted under another route, so this is the same list.
    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByText('Huddle', { exact: true })
      .click();
    await expect(page).toHaveURL(/\/app\/huddle/);
    await tickets.navigateFromSidebar();

    await expect(row.getByRole('checkbox')).not.toBeChecked();
    await expect(tickets.deselectAllButton).toHaveCount(0);
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

  test('sorts and filters from the pane, and says how many filters are on', async ({ page }) => {
    const title = `E2E Phone Pane ${Date.now()}`;
    await tickets.createTicket(title);

    // A property only sorted by is a button: one press sorts, and it says which way.
    await tickets.sortBy('Title');
    expect(await tickets.sortStateOf('Title')).toBe('ascending');
    await tickets.sortBy('Title');
    expect(await tickets.sortStateOf('Title')).toBe('descending');

    // A filter is reached from the pane when its pill is not on the line.
    await tickets.filterBy('Source', 'TimeHuddle');
    await expect(tickets.rowByTitle(title)).toBeVisible();
    await expect(tickets.rowsFromSource('redmine')).toHaveCount(0);

    // Closed, the chevron still says a filter is on.
    await page.getByRole('button', { name: 'Hide the sort and filter controls' }).click();
    await expect(
      page.getByRole('button', { name: 'Show all sort and filter controls, 1 filter on' }),
    ).toBeVisible();

    await tickets.clearFilters();
    await expect(tickets.clearFiltersButton).toHaveCount(0);
  });

  test('several choices of one filter can be on at once', async ({ page }) => {
    const title = `E2E Phone Multi ${Date.now()}`;
    await tickets.createTicket(title);

    await tickets.openFilter('Assignees');
    const me = page.getByRole('menuitemcheckbox', { name: 'Me', exact: true });
    const unassigned = page.getByRole('menuitemcheckbox', { name: 'Unassigned', exact: true });
    await me.click();
    await unassigned.click();

    // The menu stays open for the next choice, and both are ticked.
    await expect(me).toHaveAttribute('aria-checked', 'true');
    await expect(unassigned).toHaveAttribute('aria-checked', 'true');
    // Every other choice is still offered after one is made.
    await expect(
      page.getByRole('menuitemcheckbox', { name: TEST_USERS.owner1.name, exact: true }),
    ).toBeVisible();
    await expect(tickets.rowByTitle(title)).toBeVisible();

    await me.click();
    await expect(me).toHaveAttribute('aria-checked', 'false');
    await expect(tickets.rowByTitle(title)).toHaveCount(0);
  });

  test('a menu works from the keyboard: focus goes in, arrows move, Escape comes back', async ({
    page,
  }) => {
    await tickets.createTicket(`E2E Keys ${Date.now()}`);
    await page.setViewportSize({ width: 1440, height: 800 });
    const trigger = tickets.filterControl('Source');
    const items = page.getByRole('menuitem');

    await trigger.click();
    await expect(items.first()).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(items.nth(1)).toBeFocused();
    await page.keyboard.press('End');
    await expect(items.last()).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(trigger).toBeFocused();

    // Choosing an item also hands focus back, since the item itself goes away.
    await trigger.click();
    await items.first().press('Enter');
    await expect(trigger).toBeFocused();

    // Tab closes the menu, so its arrow keys cannot reach into the page.
    await trigger.click();
    await expect(items.first()).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('menu')).toHaveCount(0);
  });

  test('a menu with a search box starts there, and narrows as you type', async ({ page }) => {
    await tickets.createTicket(`E2E Search ${Date.now()}`);

    await tickets.openFilter('Assignees');
    const search = page.getByRole('searchbox', { name: 'Search people' });
    await expect(search).toBeFocused();

    await search.fill('zzz-nobody');
    await expect(page.getByRole('menuitemcheckbox')).toHaveCount(0);
    await expect(page.getByRole('menu')).toContainText('No matches');

    // Typing does not close the menu, and the arrows leave the box for the
    // choices. Other specs add people whose names start alike, so the down
    // arrow is checked against whichever choice comes first.
    await search.fill(TEST_USERS.owner1.name.slice(0, 4));
    await expect(
      page.getByRole('menuitemcheckbox', { name: TEST_USERS.owner1.name, exact: true }),
    ).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('menuitemcheckbox').first()).toBeFocused();
  });

  test('keeps the whole menu reachable on a short screen', async ({ page }) => {
    await tickets.createTicket(`E2E Phone Short ${Date.now()}`);
    await page.setViewportSize({ width: 390, height: 520 });

    await tickets.openFilter('Assignees');
    const last = page.getByRole('menuitemcheckbox').last();
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

  test('My Board fits a 360px screen, board and timer buttons included', async ({ page }) => {
    // Both views carry the ▶/⏸ button ahead of the row and the My Board toggle
    // at its end; 360px is the narrowest phone the app supports.
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
    // tightest the row gets), the board toggle, timer, and the row menu.
    const controls = [
      row.getByRole('checkbox'),
      tickets.removeFromBoardRowButton(title),
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

    // All Sources has the same two buttons, and fits as well.
    await tickets.switchToTab('tickets');
    await expect(tickets.removeFromBoardRowButton(title)).toBeVisible();
    const allSourcesOverflow = await sidewaysOverflow(page);
    expect(allSourcesOverflow).not.toBeNull();
    expect(allSourcesOverflow).toBeLessThanOrEqual(1);
  });

  test('keeps the same stacked row as the list gets wider, with no layout swap', async ({
    page,
  }) => {
    const title = `E2E Resize ${Date.now()}`;
    await tickets.createTicket(title);
    const row = tickets.rowByTitle(title);
    const titleBox = () =>
      row.locator('.ticket-row-title').evaluate((el) => {
        const { top, left } = el.getBoundingClientRect();
        return { top, left };
      });
    const factsBox = () =>
      row.locator('.row-list-properties').evaluate((el) => {
        const { top, left } = el.getBoundingClientRect();
        return { top, left };
      });

    // Narrow and wide alike: the badges sit under the title, from its left
    // edge. No columns appear.
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 800 });
      await expect(row.locator('.ticket-row-facts')).toContainText('TimeHuddle');
      const [titleAt, factsAt] = [await titleBox(), await factsBox()];
      expect(factsAt.top, `at ${width}px`).toBeGreaterThan(titleAt.top + 10);
      expect(Math.abs(factsAt.left - titleAt.left), `at ${width}px`).toBeLessThanOrEqual(2);
      await expect(page.getByRole('columnheader')).toHaveCount(0);
    }

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
