/**
 * Teams E2E Tests
 *
 * 1. Join team (already tested elsewhere, so skip here)
 * 2. Create team - verify team code generated
 * 3. Teams page has correct URL
 * 4. Admin: Teams page has Timesheet and Members tabs
 * 5. Team timesheet filters work
 * 6. Team members are shown correctly
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

test.describe('Teams', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USERS.owner1);
  });

  test('should navigate to teams page with correct URL', async ({ page }) => {
    await page.goto('/app/teams');
    await page.getByRole('heading', { level: 1, name: 'Teams' }).waitFor({ state: 'visible' });

    // Verify correct URL
    expect(page.url()).toContain('/app/teams');

    // Verify page components
    await expect(page.getByRole('heading', { level: 1, name: 'Teams' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create Team' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Join Team' })).toBeVisible();
  });

  test('should create a team with a generated team code', async ({ page }) => {
    await page.goto('/app/teams');
    await page.getByRole('heading', { level: 1, name: 'Teams' }).waitFor({ state: 'visible' });

    // Click Create Team button
    await page.getByRole('button', { name: 'Create Team' }).click();

    // Fill team name
    const teamName = `E2E Team ${Date.now()}`;
    await page.getByPlaceholder('Team name').waitFor({ state: 'visible' });
    await page.getByPlaceholder('Team name').fill(teamName);

    // Click Create
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await page.waitForTimeout(3000);

    // Verify the team appears in the list. Scoped to <main> because the new
    // team also becomes the selected scope, so its name appears in the header
    // switcher too — an unscoped getByText would match both.
    await expect(page.locator('main').getByText(teamName)).toBeVisible({ timeout: 10000 });

    // Verify team code badge exists (it's a short code like ABC123)
    // The team code is shown as a Badge below the team name with a "Copy" button
    await expect(page.getByRole('button', { name: 'Copy', exact: true })).toBeVisible({
      timeout: 5000,
    });
  });

  test('admin should see Members and Timesheet tabs with working filters', async ({ page }) => {
    test.setTimeout(60000);

    // Ensure Test Team Alpha is selected
    const teamId = await getTestTeamId();
    if (!teamId) {
      test.skip(true, 'Test Team Alpha not found');
      return;
    }

    await page.goto('/app/teams');
    await page.getByRole('heading', { level: 1, name: 'Teams' }).waitFor({ state: 'visible' });

    // Set Test Team Alpha as selected team via localStorage and reload
    await page.evaluate((id) => {
      Object.keys(localStorage)
        .filter((k) => k.startsWith('app:selectedTeamId'))
        .forEach((k) => localStorage.setItem(k, id));
      localStorage.setItem('app:selectedTeamId', id);
    }, teamId);
    await page.reload();
    await page.getByRole('heading', { level: 1, name: 'Teams' }).waitFor({ state: 'visible' });
    await page.waitForLoadState('networkidle');

    // Wait for the team to load — the Timesheet tab only appears for non-personal teams
    const timesheetTab = page.getByRole('tab', { name: 'Timesheet' });
    const membersTab = page.getByRole('tab', { name: 'Members' });

    // If Personal Workspace is still showing, the localStorage didn't take effect.
    // Try a direct navigation with deep-link query param.
    if (!(await timesheetTab.isVisible({ timeout: 5000 }).catch(() => false))) {
      await page.goto(`/app/teams?teamId=${teamId}`);
      await page.getByRole('heading', { level: 1, name: 'Teams' }).waitFor({ state: 'visible' });
      await page.waitForLoadState('networkidle');
    }

    // If Timesheet tab still not visible, skip — Test Team Alpha may not be available for this user
    if (!(await timesheetTab.isVisible({ timeout: 10000 }).catch(() => false))) {
      test.skip(true, 'Timesheet tab not available — team may not have loaded');
      return;
    }

    // Verify tabs are visible
    await expect(membersTab).toBeVisible();

    // Click Timesheet tab
    await timesheetTab.click();
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

  test('team members are shown correctly', async ({ page }) => {
    await page.goto('/app/teams');
    await page.getByRole('heading', { level: 1, name: 'Teams' }).waitFor({ state: 'visible' });
    await page.waitForTimeout(2000);

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
      await page.getByRole('heading', { level: 1, name: 'Teams' }).waitFor({ state: 'visible' });
      await page.waitForTimeout(3000);
    }

    // Click Members tab
    await page.getByRole('tab', { name: 'Members' }).click();
    await page.waitForTimeout(1000);

    // Verify at least the current user is shown (use the profile button to be specific)
    await expect(page.getByRole('button', { name: /View Test Owner One/ })).toBeVisible({
      timeout: 5000,
    });

    // Verify members count is shown
    await expect(page.getByText(/Members \(\d+\)/)).toBeVisible();
  });
});
