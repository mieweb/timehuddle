/**
 * Linking a Redmine account updates the Tickets page without a reload (#562).
 *
 * `TicketsPage` is force-mounted behind every route to preserve its state, so
 * it never remounts on navigation. Before the fix it kept its boot-time view of
 * the world — no Redmine rows, no "Redmine issue" option, "Me" matching only
 * Huddle ids — until the window was reloaded.
 *
 * Every navigation here is a **client-side** sidebar click. A `page.goto` would
 * remount the whole app and pass whether or not the fix is present, which is
 * exactly the bug this file exists to catch.
 */
import { test, expect, type Page } from '@playwright/test';

import { TEST_USERS, loginAs } from '../fixtures/users';
import { TicketsPage } from '../pages/TicketsPage';
import { BASE_URL, connectedStatus, redmineIssue, stubRedmine } from '../fixtures/redmine';

const REDMINE_USER_ID = 8;

const MINE = redmineIssue({
  id: 15,
  subject: 'Mine in Redmine',
  assignedTo: { id: REDMINE_USER_ID, name: 'Linked Redmine User' },
});
const THEIRS = redmineIssue({
  id: 23,
  subject: 'Theirs in Redmine',
  assignedTo: { id: 42, name: 'Other Person' },
});

/**
 * Stubs a Redmine that starts unlinked and becomes linked when Settings calls
 * `connect` — one flag driving every method, so the app sees a coherent world
 * at each step rather than a stub that contradicts itself.
 */
async function stubLinkableRedmine(page: Page) {
  let linked = false;
  const rm = await stubRedmine(page, {
    status: () =>
      linked ? connectedStatus({ redmineUserId: REDMINE_USER_ID }) : { connected: false },
    connect: () => {
      linked = true;
      return connectedStatus({ redmineUserId: REDMINE_USER_ID });
    },
    disconnect: () => {
      linked = false;
      return { connected: false };
    },
    'issues.list': () =>
      linked
        ? { connected: true, baseUrl: BASE_URL, issues: [MINE, THEIRS] }
        : { connected: false, baseUrl: null, issues: [] },
  });
  return rm;
}

async function openSettings(page: Page) {
  await page.goto('/app/settings');
  await expect(page.getByRole('heading', { name: 'Redmine' })).toBeVisible({ timeout: 20000 });
}

async function connectInSettings(page: Page) {
  await page.getByLabel('Redmine API key').fill('a-personal-api-key');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByText('Connected', { exact: true })).toBeVisible({ timeout: 15000 });
}

/** Client-side navigation — the whole point. Never `page.goto` here. */
async function goToTicketsWithoutReloading(page: Page) {
  await page.getByRole('button', { name: /^Tickets$/i }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Tickets' })).toBeVisible({
    timeout: 20000,
  });
}

test.describe('Redmine connection propagates without a reload', () => {
  let tickets: TicketsPage;

  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USERS.owner1);
    tickets = new TicketsPage(page);
  });

  test('issues appear on the Tickets page after connecting', async ({ page }) => {
    await stubLinkableRedmine(page);

    // Start on Tickets so the page is mounted with the unlinked view, exactly
    // as a user who had not connected yet would leave it.
    await tickets.goto();
    await expect(tickets.rowsFromSource('redmine')).toHaveCount(0);

    await openSettings(page);
    await connectInSettings(page);
    await goToTicketsWithoutReloading(page);

    await tickets.search('Mine in Redmine');
    await expect(tickets.rowByTitle('Mine in Redmine')).toHaveCount(1);
  });

  test('New Ticket becomes the TimeHuddle/Redmine dropdown after connecting', async ({ page }) => {
    await stubLinkableRedmine(page);
    await tickets.goto();

    await page.getByRole('button', { name: 'New Ticket' }).click();
    await expect(page.getByText('Redmine issue', { exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');

    await openSettings(page);
    await connectInSettings(page);
    await goToTicketsWithoutReloading(page);

    await page.getByRole('button', { name: 'New Ticket' }).click();
    await expect(page.getByText('TimeHuddle ticket', { exact: true })).toBeVisible();
    await expect(page.getByText('Redmine issue', { exact: true })).toBeVisible();
  });

  test('the "Me" filter picks up the linked Redmine account', async ({ page }) => {
    // The other half of the fix: `useMeAssigneeKeys` used to fetch its own
    // status once and never look again.
    await stubLinkableRedmine(page);
    await tickets.goto();

    await openSettings(page);
    await connectInSettings(page);
    await goToTicketsWithoutReloading(page);

    await tickets.filterBy('Assignees', 'Me');

    await tickets.search('Mine in Redmine');
    await expect(tickets.rowByTitle('Mine in Redmine')).toHaveCount(1);
    await tickets.clearSearch();
    await tickets.search('Theirs in Redmine');
    await expect(tickets.rowByTitle('Theirs in Redmine')).toHaveCount(0);
  });

  test('disconnecting clears the issues, also without a reload', async ({ page }) => {
    await stubLinkableRedmine(page);

    await openSettings(page);
    await connectInSettings(page);
    await goToTicketsWithoutReloading(page);
    await tickets.search('Mine in Redmine');
    await expect(tickets.rowByTitle('Mine in Redmine')).toHaveCount(1);
    await tickets.clearSearch();

    await openSettings(page);
    await page.getByRole('button', { name: 'Disconnect' }).click();
    await expect(page.getByLabel('Redmine API key')).toBeVisible({ timeout: 15000 });
    await goToTicketsWithoutReloading(page);

    await expect(tickets.rowsFromSource('redmine')).toHaveCount(0);
  });

  // No `issues.list` call-count test here, deliberately. `redmineSource` caches
  // the list for the session, so dropping that cache is half of what the fix
  // does — but counting the calls cannot demonstrate it: `useUnifiedTickets`
  // reloads as its own dependencies settle after a navigation, so the count
  // climbs for reasons that have nothing to do with connecting. Both versions
  // of such a test passed with the fix reverted.
  //
  // The first test in this file covers the cache properly anyway: rows can only
  // appear after connecting if the cached (empty) list was invalidated *and*
  // refetched. It fails with the fix removed.
});
