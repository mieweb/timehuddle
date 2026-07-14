/**
 * Dashboard E2E Tests
 *
 * 1. Landing on dashboard has correct route and all components loaded
 * 2. Active session button navigates to clock page
 */
import { test, expect } from '@playwright/test';
import { TEST_USERS, loginAs } from '../fixtures/users';

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USERS.owner1);
  });

  test('should land on dashboard with correct route and all components', async ({ page }) => {
    // 1. Route is correct
    expect(page.url()).toContain('/app/dashboard');

    // 2. Dashboard heading
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();

    // 3. Sidebar navigation is visible
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();

    // 4. Account menu is visible
    await expect(page.getByRole('button', { name: 'Account menu' })).toBeVisible();

    // 5. Dashboard stat cards are visible
    await expect(page.getByText('Hours today')).toBeVisible();
    await expect(page.getByText('Open tickets', { exact: true })).toBeVisible();
    await expect(page.getByText('Closed today')).toBeVisible();
    await expect(page.getByText('High priority')).toBeVisible();

    // 6. Active tickets section is visible
    await expect(page.getByRole('heading', { name: /Active tickets/i })).toBeVisible();

    // 7. All sidebar navigation items exist
    await expect(page.getByRole('button', { name: /^Dashboard$/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Tickets$/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Timesheet$/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Teams$/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Organization$/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Notifications$/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Activity Log$/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Clock$/i })).toBeVisible();
  });

  test('active session button navigates to clock page', async ({ page }) => {
    // Clock in first via the Clock page
    await page.goto('/app/clock');
    await page.getByRole('heading', { level: 1, name: /Clock/i }).waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Clock in' }).click();
    // Wait for clock out button to confirm we're clocked in
    await page
      .getByRole('button', { name: 'Clock out' })
      .waitFor({ state: 'visible', timeout: 5000 });

    // Navigate back to dashboard
    await page.goto('/app/dashboard');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // The dashboard shows "Session Active" alert with a "View" button.
    // Allow extra time — the dashboard polls for clock state which can be slow.
    await expect(page.getByText('Session Active')).toBeVisible({ timeout: 20000 });
    const viewButton = page.getByRole('button', { name: 'View', exact: true });
    await expect(viewButton).toBeVisible();

    // Click "View" to navigate to clock page
    await viewButton.click();
    await expect(page).toHaveURL(/\/app\/clock/);
    await expect(page.getByRole('heading', { level: 1, name: /Clock/i })).toBeVisible();

    // Verify still clocked in
    await expect(page.getByRole('button', { name: 'Clock out' })).toBeVisible();

    // Clock out to clean up
    await page.getByRole('button', { name: 'Clock out' }).click();
    await page
      .getByRole('button', { name: 'Clock in' })
      .waitFor({ state: 'visible', timeout: 5000 });
  });
});
