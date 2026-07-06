import { test, expect } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { DashboardPage } from '../pages/DashboardPage';
import { TEST_USERS } from '../fixtures/users';

/**
 * E2E Test: Logout Navigation
 *
 * Verifies that logout properly navigates to root URL regardless of which page
 * the user is on when they logout.
 *
 * Related fix: When logging out from /app/teams or any other /app/* page,
 * the URL should navigate to `/` and show the login form, not keep the /app/* URL.
 */
test.describe('Logout Navigation', () => {
  let loginPage: LoginPage;
  let dashboardPage: DashboardPage;

  test.beforeEach(async ({ page }) => {
    loginPage = new LoginPage(page);
    dashboardPage = new DashboardPage(page);
    await loginPage.goto();
  });

  test('should navigate to / when logging out from dashboard', async ({ page }) => {
    const user = TEST_USERS.owner1;

    // Login
    await loginPage.loginAs(user);
    await page.waitForURL('**/dashboard', { timeout: 15000 });

    // Verify we're on dashboard
    expect(page.url()).toContain('/dashboard');

    // Logout from dashboard
    await dashboardPage.logout();
    await page.waitForTimeout(1000);

    // Should navigate to root
    expect(page.url()).toMatch(/\/$|\/\?/); // Root or root with query params
    expect(page.url()).not.toContain('/app/');

    // Login form should be visible
    await expect(loginPage.isOnLoginPage()).resolves.toBe(true);
  });

  test('should navigate to / when logging out from teams page', async ({ page }) => {
    const user = TEST_USERS.owner1;

    // Login
    await loginPage.loginAs(user);
    await page.waitForURL('**/dashboard', { timeout: 15000 });

    // Navigate to teams page
    await page.getByRole('button', { name: /^Teams$/i }).click();
    await page.waitForTimeout(1000);

    // Verify we're on teams page
    expect(page.url()).toContain('/app/teams');

    // Logout from teams page
    await dashboardPage.logout();
    await page.waitForTimeout(1000);

    // Should navigate to root, not stay on /app/teams
    expect(page.url()).toMatch(/\/$|\/\?/);
    expect(page.url()).not.toContain('/app/teams');

    // Login form should be visible
    await expect(loginPage.isOnLoginPage()).resolves.toBe(true);
  });

  test('should navigate to / when logging out from organization page', async ({ page }) => {
    const user = TEST_USERS.owner1;

    // Login
    await loginPage.loginAs(user);
    await page.waitForURL('**/dashboard', { timeout: 15000 });

    // Navigate to organization page
    await page.getByRole('button', { name: /^Organization$/i }).click();
    await page.waitForTimeout(1000);

    // Verify we're on organization page
    expect(page.url()).toContain('/app/organization');

    // Logout
    await dashboardPage.logout();
    await page.waitForTimeout(1000);

    // Should navigate to root
    expect(page.url()).toMatch(/\/$|\/\?/);
    expect(page.url()).not.toContain('/app/organization');

    // Login form should be visible
    await expect(loginPage.isOnLoginPage()).resolves.toBe(true);
  });

  test('should navigate to / when logging out from members page', async ({ page }) => {
    const user = TEST_USERS.owner1;

    // Login
    await loginPage.loginAs(user);
    await page.waitForURL('**/dashboard', { timeout: 15000 });

    // Navigate to org members page
    await page.getByRole('button', { name: /^Organization$/i }).click();
    await page.waitForTimeout(500);

    // Click members link in the navigation or page
    const membersButton = page
      .getByRole('link', { name: /members/i })
      .or(page.getByRole('button', { name: /members/i }));

    if (await membersButton.isVisible()) {
      await membersButton.click();
      await page.waitForTimeout(1000);

      // Verify we're on members page
      expect(page.url()).toContain('/app/org/members');

      // Logout
      await dashboardPage.logout();
      await page.waitForTimeout(1000);

      // Should navigate to root
      expect(page.url()).toMatch(/\/$|\/\?/);
      expect(page.url()).not.toContain('/app/org/members');

      // Login form should be visible
      await expect(loginPage.isOnLoginPage()).resolves.toBe(true);
    }
  });

  test('should clear /app/* URL when showing login form after session expires', async ({
    page,
  }) => {
    const user = TEST_USERS.owner1;

    // Login
    await loginPage.loginAs(user);
    await page.waitForURL('**/dashboard', { timeout: 15000 });

    // Navigate to teams page
    await page.getByRole('button', { name: /^Teams$/i }).click();
    await page.waitForTimeout(1000);
    expect(page.url()).toContain('/app/teams');

    // Manually clear the session token to simulate expired session
    await page.evaluate(() => {
      localStorage.removeItem('meteor_resume_token');
      localStorage.removeItem('timecore_session_token');
    });

    // Reload the page - should redirect to login
    await page.reload();
    await page.waitForTimeout(2000);

    // Should be on root path with login form, not /app/teams
    expect(page.url()).toMatch(/\/$|\/\?/);
    expect(page.url()).not.toContain('/app/');

    // Login form should be visible
    await expect(loginPage.isOnLoginPage()).resolves.toBe(true);
  });

  test('should allow logging in again after logout', async ({ page }) => {
    const user = TEST_USERS.owner1;

    // Login
    await loginPage.loginAs(user);
    await page.waitForURL('**/dashboard', { timeout: 15000 });

    // Navigate to any page
    await page.getByRole('button', { name: /^Teams$/i }).click();
    await page.waitForTimeout(1000);

    // Logout
    await dashboardPage.logout();
    await page.waitForTimeout(1000);

    // Should be able to login again
    await loginPage.loginAs(user);
    await page.waitForURL('**/dashboard', { timeout: 15000 });

    // Verify authenticated
    await expect(dashboardPage.hasSidebar()).resolves.toBe(true);
    expect(page.url()).toContain('/dashboard');
  });
});
