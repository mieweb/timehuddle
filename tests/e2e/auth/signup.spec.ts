import { test, expect } from '@playwright/test';
import { SignupPage } from '../pages/SignupPage';
import { LoginPage } from '../pages/LoginPage';
import { DashboardPage } from '../pages/DashboardPage';
import { TEST_USERS } from '../fixtures/users';

test.describe('Signup', () => {
  let signupPage: SignupPage;
  let loginPage: LoginPage;
  let dashboardPage: DashboardPage;

  test.beforeEach(async ({ page }) => {
    signupPage = new SignupPage(page);
    loginPage = new LoginPage(page);
    dashboardPage = new DashboardPage(page);
  });

  test('should display signup form when accessing with mode=signup', async () => {
    await signupPage.goto();
    const isOnSignup = await signupPage.isOnSignupPage();
    expect(isOnSignup).toBe(true);
  });

  test('should create account with valid data', async ({ page: _page }) => {
    const timestamp = Date.now();
    const testEmail = `signup_create_${timestamp}@test.local`;
    const username = `signup_create_${timestamp}`.slice(0, 28);

    await signupPage.goto();
    await signupPage.signup('Signup', 'TestCreate', testEmail, 'TestPass1!');

    // Should redirect to dashboard (or authenticated route)
    await signupPage.waitForSignupSuccess();

    // Handle the Username Required dialog
    await signupPage.claimUsername(username);

    // Verify authenticated — sidebar visible
    await expect(dashboardPage.hasSidebar()).resolves.toBe(true);
  });

  test('should not allow signup with existing email', async () => {
    const existingUser = TEST_USERS.owner1;

    await signupPage.goto();
    await signupPage.signup('Duplicate', 'User', existingUser.email, 'TestPass1!');

    // Should show error (Meteor returns a generic error for duplicate emails)
    const error = await signupPage.getErrorMessage();
    expect(error).toBeTruthy();
    expect(error).toMatch(
      /already exists|already registered|email.*taken|already.*used|something went wrong|credentials/i,
    );
  });

  test('should not allow signup with weak password', async () => {
    const timestamp = Date.now();
    const testEmail = `signup_weak_${timestamp}@test.local`;

    await signupPage.goto();
    await signupPage.signup('Weak', 'Password', testEmail, 'weak');

    // Client-side validation: "Password must be at least 8 characters"
    const error = await signupPage.getErrorMessage();
    expect(error).toBeTruthy();
    expect(error).toMatch(/password.*8|password.*characters|password.*short/i);
  });

  test('should allow immediate login after signup', async ({ page }) => {
    const timestamp = Date.now();
    const testEmail = `signup_relogin_${timestamp}@test.local`;
    const testPassword = 'TestPass1!';
    const username = `signup_relogin_${timestamp}`.slice(0, 28);

    // Signup
    await signupPage.goto();
    await signupPage.signup('Signup', 'Relogin', testEmail, testPassword);
    await signupPage.waitForSignupSuccess();

    // Handle the Username Required dialog
    await signupPage.claimUsername(username);

    // Verify dashboard loaded
    await expect(dashboardPage.hasSidebar()).resolves.toBe(true);

    // Logout
    await dashboardPage.logout();

    // Login again with the same credentials
    await loginPage.goto();
    await loginPage.login(testEmail, testPassword);
    await page.waitForURL('**/dashboard', { timeout: 15000 });

    // Verify authenticated
    await expect(dashboardPage.hasSidebar()).resolves.toBe(true);
  });

  test('should switch to login mode when clicking Sign In button', async () => {
    await signupPage.goto();
    await signupPage.clickSignIn();

    // Should show login form
    await expect(loginPage.isOnLoginPage()).resolves.toBe(true);
  });
});
