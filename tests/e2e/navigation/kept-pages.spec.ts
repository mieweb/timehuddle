/**
 * Pages kept mounted behind other pages (#669; the policy is in
 * src/ui/ROUTING.md).
 *
 * Leaving a kept page and coming back through the sidebar must bring back its
 * view with no loading state, and a cold load shows a skeleton, not a blank
 * area. Every navigation away and back is a client-side sidebar click: a
 * `page.goto` remounts the whole app and would pass whether or not the page
 * was kept.
 */
import { expect, test, type Page } from '@playwright/test';

import { selectSharedTestTeam } from '../fixtures/team';
import { TEST_USERS, loginAs } from '../fixtures/users';

const param = (page: Page, key: string) => new URL(page.url()).searchParams.get(key);

async function openFromSidebar(page: Page, name: string) {
  await page
    .getByRole('button', { name: new RegExp(`^${name}$`, 'i') })
    .first()
    .click();
}

/** Away to a page that is not kept, and back again. */
async function leaveAndReturn(page: Page, name: string) {
  await openFromSidebar(page, 'Clock');
  await expect(page).toHaveURL(/\/app\/clock/);
  await openFromSidebar(page, name);
}

test.describe('Kept pages', () => {
  test.setTimeout(90000);

  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USERS.owner1);
  });

  test('Dashboard comes back on the same tab and view', async ({ page }) => {
    await selectSharedTestTeam(page);
    await page.goto('/app/dashboard');
    await page.getByRole('tab', { name: 'Team', exact: true }).click();
    await page.getByRole('tab', { name: 'Timesheet', exact: true }).click();
    await expect.poll(() => param(page, 'view')).toBe('timesheet');

    await leaveAndReturn(page, 'Dashboard');

    await expect.poll(() => param(page, 'view'), { timeout: 1500 }).toBe('timesheet');
    expect(param(page, 'tab')).toBe('team');
    await expect(page.getByRole('tab', { name: 'Timesheet', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByRole('status').filter({ hasText: 'Loading dashboard' })).toHaveCount(0);
  });

  test('a link that names a Dashboard view wins over the remembered one', async ({ page }) => {
    await selectSharedTestTeam(page);
    await page.goto('/app/dashboard');
    await page.getByRole('tab', { name: 'Timesheet', exact: true }).click();
    await expect.poll(() => param(page, 'view')).toBe('timesheet');

    await openFromSidebar(page, 'Clock');
    await page.evaluate(() => {
      window.history.pushState(null, '', '/app/dashboard?tab=me');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    await expect.poll(() => param(page, 'tab')).toBe('me');
    expect(param(page, 'view')).toBeNull();
  });

  test('Work comes back on the same day', async ({ page }) => {
    await page.goto('/app/work');
    await page.getByRole('button', { name: /previous week/i }).click();
    await expect.poll(() => param(page, 'date')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const date = param(page, 'date');

    await leaveAndReturn(page, 'Work');

    await expect.poll(() => param(page, 'date'), { timeout: 1500 }).toBe(date);
  });

  test('Activity Log comes back without reloading', async ({ page }) => {
    await page.goto('/app/activity');
    const loading = page.getByRole('status').filter({ hasText: 'Loading activity log' });
    await expect(loading).toHaveCount(0, { timeout: 20000 });

    await leaveAndReturn(page, 'Activity Log');

    await expect(page.getByRole('heading', { level: 1, name: 'Activity Log' })).toBeVisible();
    await expect(loading).toHaveCount(0, { timeout: 1500 });
  });

  test('a cold Activity Log load shows a skeleton, not a blank area', async ({ page }) => {
    // Hold the log back so the loading state stays up long enough to see.
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route('**/api/activity_log*', async (route) => {
      await held;
      await route.continue();
    });

    await page.goto('/app/activity');
    await expect(page.getByRole('status').filter({ hasText: 'Loading activity log' })).toHaveCount(
      1,
      { timeout: 20000 },
    );
    await expect(page.locator('.loading-region-placeholders')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
    release();
    await expect(page.locator('.loading-region')).toHaveCount(0, { timeout: 20000 });
  });

  test('a kept page comes back scrolled where it was left', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 400 });
    await selectSharedTestTeam(page);
    await page.goto('/app/dashboard');
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible({
      timeout: 20000,
    });
    const main = page.locator('main');
    const scrollTop = () => main.evaluate((el) => Math.round(el.scrollTop));
    await main.evaluate((el) => el.scrollTo({ top: 200 }));
    await expect.poll(scrollTop).toBeGreaterThan(0);
    // Read back rather than assumed: scroll anchoring nudges the position when
    // a card above it finishes loading.
    const left = await scrollTop();

    await leaveAndReturn(page, 'Dashboard');

    await expect.poll(scrollTop).toBe(left);
  });
});
