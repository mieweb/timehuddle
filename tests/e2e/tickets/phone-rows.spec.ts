/**
 * The ticket table on a phone (#637): each ticket is a compact row (its title
 * in full, where it sits, then badges), and nothing scrolls sideways.
 */
import { test, expect } from '@playwright/test';

import { TEST_USERS, loginAs } from '../fixtures/users';
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
    await expect(tickets.selectAllCheckbox).toBeVisible();
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

    await tickets.clearFiltersButton.click();
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

  test('goes back to one column per fact on a wide screen', async ({ page }) => {
    const title = `E2E Phone Resize ${Date.now()}`;
    await tickets.createTicket(title);
    await expect(tickets.rowByTitle(title).locator('.ticket-row-facts')).toBeVisible();

    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(tickets.rowByTitle(title).locator('.ticket-row-facts')).toHaveCount(0);
    await expect(page.getByRole('columnheader', { name: /Status/ }).first()).toBeVisible();
  });
});
