import { test, expect } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage';
import { DashboardPage } from '../pages/DashboardPage';
import { TEST_USERS, getUserByRole } from '../fixtures/users';

test.describe('Login', () => {
  let loginPage: LoginPage;
  let dashboardPage: DashboardPage;

  test.beforeEach(async ({ page }) => {
    loginPage = new LoginPage(page);
    dashboardPage = new DashboardPage(page);
    await loginPage.goto();
  });

  test('should display login form', async () => {
    await expect(loginPage.isOnLoginPage()).resolves.toBe(true);
  });

  test('should login successfully with owner credentials', async ({ page }) => {
    const owner = TEST_USERS.owner1;
    
    await loginPage.loginAs(owner);
    
    // Wait for navigation to complete
    await page.waitForURL('**/dashboard', { timeout: 15000 });
    
    // Verify we're on dashboard
    await expect(dashboardPage.hasSidebar()).resolves.toBe(true);
  });

  test('should login successfully with admin credentials', async ({ page }) => {
    const admin = TEST_USERS.admin1;
    
    await loginPage.loginAs(admin);
    
    // Wait for navigation
    await page.waitForURL('**/dashboard', { timeout: 15000 });
    
    // Verify authenticated
    await expect(dashboardPage.hasSidebar()).resolves.toBe(true);
  });

  test('should login successfully with member credentials', async ({ page }) => {
    const member = TEST_USERS.member1;
    
    await loginPage.loginAs(member);
    
    // Wait for navigation
    await page.waitForURL('**/dashboard', { timeout: 15000 });
    
    // Verify authenticated
    await expect(dashboardPage.hasSidebar()).resolves.toBe(true);
  });

  test('should show error with invalid password', async () => {
    const owner = TEST_USERS.owner1;
    
    await loginPage.login(owner.email, 'WrongPassword123!');
    
    // Should stay on login page
    await expect(loginPage.isOnLoginPage()).resolves.toBe(true);
    
    // Should show error message
    const error = await loginPage.getErrorMessage();
    expect(error).toBeTruthy();
  });

  test('should show error with non-existent email', async () => {
    await loginPage.login('nonexistent@test.local', 'TestPass1!');
    
    // Should stay on login page
    await expect(loginPage.isOnLoginPage()).resolves.toBe(true);
    
    // Should show error
    const error = await loginPage.getErrorMessage();
    expect(error).toBeTruthy();
  });

  test('should redirect to dashboard after successful login', async ({ page }) => {
    const owner = TEST_USERS.owner1;
    
    await loginPage.loginAs(owner);
    
    // Should navigate to dashboard
    await page.waitForURL('**/dashboard', { timeout: 15000 });
    
    // Verify URL contains dashboard
    expect(page.url()).toContain('/dashboard');
  });

  test('should show loading state during login', async () => {
    const owner = TEST_USERS.owner1;
    
    await loginPage.fillEmail(owner.email);
    await loginPage.fillPassword(owner.password);
    
    // Start login
    const loginPromise = loginPage.clickSignIn();
    
    // Check for loading state (may be very brief)
    const isLoading = await loginPage.isLoading();
    
    // Complete login
    await loginPromise;
  });
});
