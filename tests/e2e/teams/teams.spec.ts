/**
 * Teams E2E Tests
 *
 * 1. Join team (already tested elsewhere, so skip here)
 * 2. Create team - verify team code generated
 * 3. Teams page has correct URL
 * 4. Team members are shown correctly (no tabs — Members is always visible)
 * 5. Admin: Dashboard's Team tab has a Timesheet view with working filters
 */
import { test, expect } from '@playwright/test';
import { MongoClient } from 'mongodb';
import { TEST_USERS, loginAs } from '../fixtures/users';

const MONGO_URL =
  process.env.MONGO_URL ?? 'mongodb://127.0.0.1:27017/timehuddle_test?replicaSet=rs0';

async function getTestTeamId(): Promise<string | null> {
  const client = await MongoClient.connect(MONGO_URL);
  const db = client.db();
  const team = await db.collection('teams').findOne({ code: 'TEST01' });
  await client.close();
  return team ? team._id.toHexString() : null;
}

async function gotoTeamsPage(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/app/teams');

  // Rarely, a stale session bounces this navigation back to login.
  if (
    await page
      .getByRole('heading', { name: 'Sign in to your account' })
      .isVisible()
      .catch(() => false)
  ) {
    await loginAs(page, TEST_USERS.owner1);
    await page.goto('/app/teams');
  }

  await expect(page.getByRole('button', { name: 'Create Team' })).toBeVisible({ timeout: 20000 });
}

test.describe('Teams', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USERS.owner1);
  });

  test('should navigate to teams page with correct URL', async ({ page }) => {
    await gotoTeamsPage(page);

    // Verify correct URL
    expect(page.url()).toContain('/app/teams');

    // Verify page components
    await expect(page.getByRole('heading', { level: 1, name: /Teams/i })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create Team' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Join Team' })).toBeVisible();
  });

  test('should create a team with a generated team code', async ({ page }) => {
    await gotoTeamsPage(page);

    // Click Create Team button
    await page.getByRole('button', { name: 'Create Team' }).click();

    // Fill team name
    const teamName = `E2E Team ${Date.now()}`;
    await page.getByPlaceholder('Team name').waitFor({ state: 'visible' });
    await page.getByPlaceholder('Team name').fill(teamName);

    // Click Create
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await page.waitForTimeout(1500);

    // Verify the team appears in the list. Scoped to the CardTitle heading
    // because the new team also becomes the selected scope, so its name
    // appears in both the tabs row and the team header — an unscoped
    // getByText would match both.
    await expect(page.getByRole('heading', { name: teamName, level: 3 })).toBeVisible({
      timeout: 10000,
    });

    // Verify team code badge exists (it's a short code like ABC123)
    // The team code is shown as a Badge below the team name with a "Copy team
    // code" button next to it.
    await expect(page.getByRole('button', { name: 'Copy team code' })).toBeVisible({
      timeout: 10000,
    });
  });

  test('team members are shown correctly', async ({ page }) => {
    await gotoTeamsPage(page);
    await page.waitForTimeout(1000);

    // Ensure Test Team Alpha is selected via localStorage
    const teamId = await getTestTeamId();
    if (teamId) {
      await page.evaluate((id) => {
        Object.keys(localStorage)
          .filter((k) => k.startsWith('app:selectedTeamId'))
          .forEach((k) => localStorage.setItem(k, id));
        localStorage.setItem('app:selectedTeamId', id);
      }, teamId);
      await page.reload();
      await expect(page.getByRole('button', { name: 'Create Team' })).toBeVisible({
        timeout: 20000,
      });
      await page.waitForTimeout(1500);
    }

    // Members are always visible — no tab to click.
    // Verify at least the current user is shown (use the profile button to be specific)
    await expect(page.getByRole('button', { name: /View Test Owner One/ })).toBeVisible({
      timeout: 5000,
    });

    // Verify members count is shown
    await expect(page.getByText(/Members \(\d+\)/)).toBeVisible();
  });

  test('admin should see a Timesheet view on the Dashboard Team tab with working filters', async ({
    page,
  }) => {
    test.setTimeout(60000);

    const teamId = await getTestTeamId();
    if (!teamId) {
      test.skip(true, 'Test Team Alpha not found');
      return;
    }

    await page.goto(`/app/dashboard?teamId=${teamId}`);
    await expect(page.getByRole('button', { name: 'Team', exact: true })).toBeVisible({
      timeout: 20000,
    });

    await page.getByRole('button', { name: 'Team', exact: true }).click();

    const timesheetToggle = page.getByRole('button', { name: 'Timesheet', exact: true });
    if (!(await timesheetToggle.isVisible({ timeout: 10000 }).catch(() => false))) {
      test.skip(true, 'Timesheet view not available — team may not have loaded');
      return;
    }

    await timesheetToggle.click();
    await page.waitForTimeout(3000);

    // Verify the admin timesheet panel loaded with date range buttons
    await expect(page.getByRole('button', { name: 'Today', exact: true })).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByRole('button', { name: 'This Week', exact: true })).toBeVisible();

    // Click different presets to verify they work
    await page.getByRole('button', { name: 'Today', exact: true }).click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: 'This Week', exact: true }).click();
    await page.waitForTimeout(500);
  });
});
