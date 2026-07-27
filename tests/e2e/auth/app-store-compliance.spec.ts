/**
 * App Store compliance E2E tests.
 *
 * Covers the changes made to resolve the Apple App Review rejections:
 *   • 4.8      — Sign in with Apple offered alongside third-party login services
 *   • 5.1.1(v) — In-app account deletion (initiate → confirm → account gone)
 *
 * The account-deletion tests provision throwaway users so a genuine delete can
 * be exercised end-to-end without disturbing the shared `@test.local` seed
 * users the rest of the suite relies on.
 */
import { test, expect, type Page } from '@playwright/test';
import { SignupPage } from '../pages/SignupPage';
import { LoginPage } from '../pages/LoginPage';
import { DashboardPage } from '../pages/DashboardPage';

/** Create a fresh, disposable account and land on the authenticated app. */
async function signUpThrowawayUser(
  page: Page,
): Promise<{ email: string; password: string; username: string }> {
  const signupPage = new SignupPage(page);
  const dashboardPage = new DashboardPage(page);

  const timestamp = Date.now();
  const email = `delete_me_${timestamp}@test.local`;
  const password = 'TestPass1!';
  const username = `delete_me_${timestamp}`.slice(0, 28);

  await signupPage.goto();
  await signupPage.signup('Delete', 'Me', email, password);
  await signupPage.waitForSignupSuccess();
  await signupPage.claimUsername(username);
  await expect(dashboardPage.hasSidebar()).resolves.toBe(true);

  return { email, password, username };
}

test.describe('App Store compliance — Sign in with Apple (4.8)', () => {
  let loginPage: LoginPage;

  test.beforeEach(async ({ page }) => {
    loginPage = new LoginPage(page);
    await loginPage.goto();
  });

  test('offers Sign in with Apple as a login option', async ({ page }) => {
    await expect(page.getByRole('button', { name: /Continue with Apple/i })).toBeVisible();
  });

  test('offers Apple alongside the other third-party providers', async ({ page }) => {
    // Guideline 4.8 requires an equivalent option to third-party logins; the
    // Apple button must appear next to the GitHub/Google buttons.
    await expect(page.getByRole('button', { name: /Continue with GitHub/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Continue with Apple/i })).toBeVisible();
  });
});

test.describe('App Store compliance — Account deletion (5.1.1(v))', () => {
  test('exposes a Delete account option in Settings', async ({ page }) => {
    await signUpThrowawayUser(page);

    await page.goto('http://localhost:3002/app/settings');
    const deleteButton = page.getByRole('button', { name: 'Delete account' });
    await expect(deleteButton).toBeVisible();
  });

  test('cancelling the confirmation keeps the account intact', async ({ page }) => {
    const user = await signUpThrowawayUser(page);

    await page.goto('http://localhost:3002/app/settings');

    // Dismiss the native confirm() dialog — deletion must NOT proceed.
    page.once('dialog', (dialog) => {
      expect(dialog.message()).toMatch(/delete your account permanently/i);
      void dialog.dismiss();
    });
    await page.getByRole('button', { name: 'Delete account' }).click();

    // Still authenticated — settings page remains, no redirect to login.
    await expect(page.getByRole('button', { name: 'Delete account' })).toBeVisible();

    // And the account can still sign in after a fresh session.
    const loginPage = new LoginPage(page);
    const dashboardPage = new DashboardPage(page);
    await dashboardPage.logout();
    await loginPage.goto();
    await loginPage.login(user.email, user.password);
    await page.waitForURL('**/dashboard', { timeout: 15000 });
    await expect(dashboardPage.hasSidebar()).resolves.toBe(true);
  });

  test('confirming deletion removes the account and signs the user out', async ({ page }) => {
    await signUpThrowawayUser(page);

    await page.goto('http://localhost:3002/app/settings');

    // Accept the native confirm() dialog — deletion proceeds.
    page.once('dialog', (dialog) => {
      expect(dialog.message()).toMatch(/delete your account permanently/i);
      void dialog.accept();
    });
    await page.getByRole('button', { name: 'Delete account' }).click();

    // The delete flow signs the user out — the login screen returns.
    await expect(page.getByRole('heading', { name: 'Sign in to your account' })).toBeVisible({
      timeout: 15000,
    });
  });

  test('a deleted account can no longer sign in', async ({ page }) => {
    const user = await signUpThrowawayUser(page);

    await page.goto('http://localhost:3002/app/settings');
    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: 'Delete account' }).click();

    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.login(user.email, user.password);

    // Login must fail — the account no longer exists.
    await expect(loginPage.isOnLoginPage()).resolves.toBe(true);
    const error = await loginPage.getErrorMessage();
    expect(error).toBeTruthy();
  });
});
