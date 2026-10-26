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
import { connectedStatus, redmineIssue, relevantList, stubRedmine } from '../fixtures/redmine';

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
    'issues.relevant': () =>
      linked
        ? relevantList([MINE, THEIRS])
        : { connected: false, baseUrl: null, issues: [], partial: false },
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
  // The page opens on My Board; the issues these specs look for are in All Sources.
  await page.getByRole('radio', { name: 'All Sources' }).click();
}

test.describe('Redmine connection propagates without a reload', () => {
  let tickets: TicketsPage;

  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USERS.owner1);
    tickets = new TicketsPage(page);
  });

  test('the New Ticket dialog offers Redmine after connecting', async ({ page }) => {
    await stubLinkableRedmine(page);
    await tickets.goto();

    const chooseRedmine = async () => {
      await page.getByRole('button', { name: 'New Ticket' }).click();
      await page.getByRole('radio', { name: 'Redmine' }).check();
    };

    // Unlinked: the dialog says to connect Redmine instead of offering a search.
    await chooseRedmine();
    await expect(page.getByText(/Connect your Redmine account in Settings/)).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();

    await openSettings(page);
    await connectInSettings(page);
    await goToTicketsWithoutReloading(page);

    await chooseRedmine();
    await expect(page.getByLabel('Issue number or link')).toBeVisible();
  });
});
