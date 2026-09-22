/**
 * The Huddle ticket detail page at `/app/tickets/:id` (plan area c).
 *
 * The Redmine issue page has its own spec; this is its TimeHuddle counterpart,
 * and unlike that one it runs entirely against the real backend — nothing here
 * is stubbed, so a passing run means the writes really persisted.
 */
import { test, expect, type Page } from '@playwright/test';

import { TEST_USERS, loginAs } from '../fixtures/users';
import { TicketsPage } from '../pages/TicketsPage';

const sidebar = (page: Page) => page.getByLabel('Ticket details sidebar');

/** Creates a ticket through the UI and opens its detail page. */
async function openNewTicket(page: Page, title: string): Promise<TicketsPage> {
  const tickets = new TicketsPage(page);
  await tickets.goto();
  await tickets.createTicket(title);
  await tickets.rowByTitle(title).getByRole('button', { name: 'Ticket options' }).click();
  await page.getByRole('menuitem', { name: 'Ticket Details' }).click();
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible({
    timeout: 20000,
  });
  return tickets;
}

test.describe('Huddle ticket detail', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USERS.owner1);
  });

  test('renders the ticket with its id and sidebar', async ({ page }) => {
    const title = `Detail render ${Date.now()}`;
    await openNewTicket(page, title);

    await expect(sidebar(page)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Copy ticket id' })).toBeVisible();
    await expect(page).toHaveURL(/\/app\/tickets\/[a-f0-9]{8,}/);
  });

  test('Back to tickets returns to the table', async ({ page }) => {
    const title = `Detail back ${Date.now()}`;
    await openNewTicket(page, title);

    await page.getByRole('button', { name: 'Back to tickets' }).click();

    await expect(page.getByRole('heading', { level: 1, name: 'Tickets' })).toBeVisible();
  });

  test('renames the ticket, and the new title survives a reload', async ({ page }) => {
    const title = `Detail rename ${Date.now()}`;
    const renamed = `${title} renamed`;
    await openNewTicket(page, title);

    await page.getByRole('button', { name: 'Edit title' }).click();
    await page.getByLabel('Ticket title').fill(renamed);
    await page.getByRole('button', { name: 'Save title' }).click();

    await expect(page.getByRole('heading', { level: 1, name: renamed })).toBeVisible({
      timeout: 15000,
    });
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: renamed })).toBeVisible({
      timeout: 20000,
    });
  });

  test('cancelling a rename leaves the title alone', async ({ page }) => {
    const title = `Detail cancel ${Date.now()}`;
    await openNewTicket(page, title);

    await page.getByRole('button', { name: 'Edit title' }).click();
    await page.getByLabel('Ticket title').fill('Discarded title');
    await page.getByRole('button', { name: 'Cancel title edit' }).click();

    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  });

  test('copies the ticket id and announces it', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const title = `Detail copy ${Date.now()}`;
    await openNewTicket(page, title);

    await page.getByRole('button', { name: 'Copy ticket id' }).click();

    await expect(page.getByText('Ticket id copied')).toBeAttached({ timeout: 10000 });
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboard).toMatch(/^[a-f0-9]{8,}$/);
  });

  test('edits the description, and it persists', async ({ page }) => {
    const title = `Detail description ${Date.now()}`;
    await openNewTicket(page, title);

    await page.getByRole('button', { name: 'Edit description' }).click();
    await page.getByLabel('Ticket description').fill('Written by the detail spec.');
    await page.getByRole('button', { name: 'Save', exact: true }).click();

    await expect(page.getByText('Written by the detail spec.')).toBeVisible({ timeout: 15000 });
    await page.reload();
    await expect(page.getByText('Written by the detail spec.')).toBeVisible({ timeout: 20000 });
  });

  test('changes status and priority from the sidebar', async ({ page }) => {
    const title = `Detail status ${Date.now()}`;
    await openNewTicket(page, title);

    const status = sidebar(page).getByRole('combobox', { name: 'Ticket status' });
    await status.click();
    await page.getByRole('option', { name: 'Closed', exact: true }).click();
    await expect(status).toHaveText('Closed', { timeout: 15000 });

    const priority = sidebar(page).getByRole('combobox', { name: 'Ticket priority' });
    await priority.click();
    await page.getByRole('option', { name: 'High', exact: true }).click();
    await expect(priority).toHaveText('High', { timeout: 15000 });

    await page.reload();
    await expect(sidebar(page).getByRole('combobox', { name: 'Ticket status' })).toHaveText(
      'Closed',
      { timeout: 20000 },
    );
  });

  test('deletes the ticket and returns to a table without it', async ({ page }) => {
    const title = `Detail delete ${Date.now()}`;
    const tickets = await openNewTicket(page, title);

    // The delete goes through a native confirm(), not a modal.
    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: 'Delete ticket' }).click();

    await expect(page.getByRole('heading', { level: 1, name: 'Tickets' })).toBeVisible({
      timeout: 20000,
    });
    await expect(tickets.rowByTitle(title)).toHaveCount(0);
  });
});
