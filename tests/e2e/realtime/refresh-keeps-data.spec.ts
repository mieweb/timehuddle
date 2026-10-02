/**
 * Pull-to-refresh failure behaviour, checked screen by screen.
 *
 * The rule every screen must follow: a refresh that fails leaves what's on
 * screen in place, clears the spinner, and shows the "Couldn't refresh" toast.
 * It never empties a list, blanks the page, or signs the user out.
 *
 * Failures are simulated by aborting every REST call (`/api/**`); the live
 * DDP socket is left alone so the session itself stays valid. The offline
 * test covers the socket going away too.
 */
import { test, expect, type Page, type BrowserContext, type Locator } from '@playwright/test';
import { TEST_USERS, loginAs } from '../fixtures/users';
import { selectSharedTestTeam } from '../fixtures/team';
import { pullToRefresh } from '../fixtures/refresh';

const APP = 'http://localhost:3002';

interface Screen {
  name: string;
  open: (page: Page) => Promise<void>;
  /** Something the screen's data puts on screen, which a wiped refresh would remove. */
  content: (page: Page) => Locator;
}

const SCREENS: Screen[] = [
  {
    name: 'Dashboard (Team)',
    open: async (page) => {
      await page.goto(`${APP}/app/dashboard`);
      await page.getByRole('tab', { name: 'Team' }).click();
    },
    content: (page) => page.locator('main').getByText(TEST_USERS.admin1.name).first(),
  },
  {
    name: 'Teams',
    open: async (page) => {
      await page.goto(`${APP}/app/teams`);
    },
    content: (page) => page.locator('main').getByText(TEST_USERS.admin1.name).first(),
  },
  {
    name: 'Profile',
    open: async (page) => {
      await page.goto(`${APP}/app/dashboard`);
      await page.getByRole('button', { name: 'Account menu' }).click();
      await page.getByRole('menuitem', { name: 'Profile' }).click();
    },
    content: (page) => page.getByRole('tab', { name: 'Activity' }),
  },
  {
    name: 'Activity Log',
    open: async (page) => {
      await page.goto(`${APP}/app/activity`);
      await expect(page.getByLabel('Loading activity log')).toHaveCount(0, { timeout: 10000 });
    },
    // The list, or its empty state — whichever this user has. A wiped refresh
    // replaces either one with the load-error message.
    content: (page) => page.locator('main').getByText(/A chronological log/),
  },
];

test.describe('Pull-to-refresh keeps the screen when it fails', () => {
  let context: BrowserContext;
  let page: Page;

  test.beforeEach(async ({ browser }) => {
    // Touch-enabled context — pull-to-refresh is a no-op on non-touch devices.
    context = await browser.newContext({ hasTouch: true });
    page = await context.newPage();
    await loginAs(page, TEST_USERS.admin1);
    await selectSharedTestTeam(page);
  });

  test.afterEach(async () => {
    await context.close();
  });

  for (const screen of SCREENS) {
    test(`${screen.name}: a failed refresh keeps the data and reports it`, async () => {
      await screen.open(page);
      await expect(screen.content(page)).toBeVisible({ timeout: 15000 });

      await page.route('**/api/**', (route) => route.abort());
      await pullToRefresh(page);

      await expect(page.getByText(/Couldn't refresh/)).toBeVisible({ timeout: 13000 });
      await expect(page.getByText('Refreshing...')).toBeHidden();
      await expect(screen.content(page)).toBeVisible();
      await expect(page.getByText(/Failed to load/)).toHaveCount(0);
      await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
    });
  }

  test('Activity Log: the list stays on screen through a failed refresh', async () => {
    await SCREENS[3].open(page);
    await expect(SCREENS[3].content(page)).toBeVisible({ timeout: 15000 });
    const entries = await page.locator('main li').count();

    await page.route('**/api/**', (route) => route.abort());
    await pullToRefresh(page);
    await expect(page.getByText(/Couldn't refresh/)).toBeVisible({ timeout: 13000 });

    await expect(page.locator('main li')).toHaveCount(entries);
  });

  // The counterpart to the Profile case above: "keep what's on screen" must not
  // outrank the server revoking access, or a removed teammate goes on seeing a
  // profile they can no longer load.
  test('Profile: a refresh that comes back 403 takes the profile down', async () => {
    await SCREENS[2].open(page);
    await expect(SCREENS[2].content(page)).toBeVisible({ timeout: 15000 });

    await page.route('**/api/users_get*', (route) =>
      route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ reason: 'Not a teammate' }),
      }),
    );
    await page.route('**/api/users_getByUsername*', (route) =>
      route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ reason: 'Not a teammate' }),
      }),
    );
    await pullToRefresh(page);

    await expect(page.getByText('Profile Unavailable')).toBeVisible({ timeout: 13000 });
    await expect(SCREENS[2].content(page)).toHaveCount(0);
  });

  test('Settings: a refresh keeps unsaved edits in the profile form', async () => {
    await page.goto(`${APP}/app/settings`);
    const displayName = page.getByLabel('Display name');
    await expect(displayName).not.toHaveValue('', { timeout: 10000 });

    const unsaved = `Unsaved name ${Date.now()}`;
    await displayName.fill(unsaved);
    await pullToRefresh(page);
    await expect(page.getByText('Refreshing...')).toBeHidden({ timeout: 13000 });
    // Give the profile reload that the refresh triggers time to land.
    await page.waitForTimeout(1500);

    await expect(displayName).toHaveValue(unsaved);
  });

  test('Dashboard: one refresh fetches each dashboard request once', async () => {
    await SCREENS[0].open(page);
    await expect(SCREENS[0].content(page)).toBeVisible({ timeout: 15000 });
    await page.waitForLoadState('networkidle');

    const ticketRequests: string[] = [];
    page.on('request', (request) => {
      if (/\/api\/tickets_list/.test(request.url())) ticketRequests.push(request.url());
    });
    await pullToRefresh(page);
    await expect(page.getByText('Refreshing...')).toBeHidden({ timeout: 13000 });
    await page.waitForLoadState('networkidle');

    expect(ticketRequests).toHaveLength(1);
  });

  test('offline: a refresh does not sign the user out', async () => {
    await page.goto(`${APP}/app/dashboard`);
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible({
      timeout: 15000,
    });

    await context.setOffline(true);
    await pullToRefresh(page);
    await expect(page.getByText(/Couldn't refresh/)).toBeVisible({ timeout: 13000 });

    // The session check gives up after its own timeouts (~5–8s); outlast them.
    await page.waitForTimeout(15000);
    await expect(page).toHaveURL(/\/app\/dashboard/);
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();

    await context.setOffline(false);
  });
});
