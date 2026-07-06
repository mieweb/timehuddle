import { test, expect } from '@playwright/test';

/**
 * E2E Test: Better Auth → Meteor Accounts Migration Flow
 *
 * Verifies that users with Better Auth credentials are automatically detected,
 * redirected to password reset, can set a new password, and then login successfully.
 */

test.describe('Better Auth Migration Flow', () => {
  test.beforeEach(async ({ page }) => {
    // Start at login page
    await page.goto('http://localhost:3000/app');
    await expect(page.locator('h2')).toContainText('Sign in to your account');
  });

  test('detects Better Auth user and redirects to password reset', async ({ page }) => {
    // User with Better Auth scryptHash in database
    const betterAuthEmail = 'test@test.com';
    const anyPassword = 'anypassword'; // Password doesn't matter for detection

    // Fill login form
    await page.getByPlaceholder('you@example.com').fill(betterAuthEmail);
    await page.getByPlaceholder('••••••••').first().fill(anyPassword);

    // Submit login
    await page.getByRole('button', { name: 'Sign in' }).click();

    // Should auto-redirect to password reset page with token in URL
    await expect(page).toHaveURL(/\/app\?token=.+/, { timeout: 10000 });

    // Should show password reset heading
    await expect(page.locator('h2')).toContainText('Set a new password');

    // Should show migration info message
    await expect(page.getByText('Your account needs migration')).toBeVisible();

    // Should show password form fields
    await expect(page.getByPlaceholder('••••••••').first()).toBeVisible(); // New password
    await expect(page.getByPlaceholder('••••••••').nth(1)).toBeVisible(); // Confirm password
  });

  test('completes migration: sets new password and logs in', async ({ page }) => {
    const betterAuthEmail = 'dharamkarpoonam9@gmail.com'; // Another test user
    const newPassword = 'MigratedPassword123!';

    // Step 1: Trigger migration detection
    await page.getByPlaceholder('you@example.com').fill(betterAuthEmail);
    await page.getByPlaceholder('••••••••').first().fill('anypassword');
    await page.getByRole('button', { name: 'Sign in' }).click();

    // Wait for redirect to password reset
    await expect(page).toHaveURL(/\/app\?token=.+/, { timeout: 10000 });
    await expect(page.locator('h2')).toContainText('Set a new password');

    // Step 2: Set new password
    await page.getByPlaceholder('••••••••').first().fill(newPassword); // New password
    await page.getByPlaceholder('••••••••').nth(1).fill(newPassword); // Confirm password
    await page.getByRole('button', { name: 'Set new password' }).click();

    // Should show success message
    await expect(page.getByText('Password reset successfully')).toBeVisible({ timeout: 10000 });

    // Step 3: Return to login and sign in with new password
    await page.getByRole('button', { name: 'Go to Sign In' }).click();

    // Email should be pre-filled
    await expect(page.getByPlaceholder('you@example.com')).toHaveValue(betterAuthEmail);

    // Enter new password
    await page.getByPlaceholder('••••••••').fill(newPassword);
    await page.getByRole('button', { name: 'Sign in' }).click();

    // Should successfully login and reach dashboard
    await expect(page).toHaveURL(/\/app\/dashboard/, { timeout: 15000 });
    await expect(page.locator('h1')).toContainText('Dashboard');
  });

  test('handles mismatched password confirmation', async ({ page }) => {
    const betterAuthEmail = 'jane@gmail.com';

    // Trigger migration
    await page.getByPlaceholder('you@example.com').fill(betterAuthEmail);
    await page.getByPlaceholder('••••••••').first().fill('anypassword');
    await page.getByRole('button', { name: 'Sign in' }).click();

    // Wait for password reset page
    await expect(page).toHaveURL(/\/app\?token=.+/, { timeout: 10000 });

    // Enter mismatched passwords
    await page.getByPlaceholder('••••••••').first().fill('Password123!');
    await page.getByPlaceholder('••••••••').nth(1).fill('DifferentPassword123!');
    await page.getByRole('button', { name: 'Set new password' }).click();

    // Should show error about passwords not matching
    await expect(page.getByText(/password.*match/i)).toBeVisible({ timeout: 5000 });
  });

  test('preserves token across page reloads', async ({ page }) => {
    const betterAuthEmail = 'iostest@test.com';

    // Trigger migration
    await page.getByPlaceholder('you@example.com').fill(betterAuthEmail);
    await page.getByPlaceholder('••••••••').first().fill('anypassword');
    await page.getByRole('button', { name: 'Sign in' }).click();

    // Wait for password reset page with token
    await expect(page).toHaveURL(/\/app\?token=.+/, { timeout: 10000 });
    const urlWithToken = page.url();
    const token = new URL(urlWithToken).searchParams.get('token');

    expect(token).toBeTruthy();
    expect(token?.length).toBeGreaterThan(20); // Reset tokens are long

    // Reload the page
    await page.reload();

    // Token should still be in URL
    await expect(page).toHaveURL(urlWithToken);

    // Form should still be visible
    await expect(page.locator('h2')).toContainText('Set a new password');
    await expect(page.getByPlaceholder('••••••••').first()).toBeVisible();
  });

  test('regular Meteor users can login normally', async ({ page: _page }) => {
    // If there are any native Meteor users (not migrated from Better Auth),
    // they should be able to login normally without triggering migration flow.
    // This test assumes a Meteor user exists - skip if none available.

    // For now, this is a placeholder - in production you'd check if any
    // users exist WITHOUT services.betterAuth.scryptHash and test those.
    test.skip();
  });
});

test.describe('Migration Database State', () => {
  test('preserves user data and relationships', async ({ page: _page, context: _context }) => {
    // This would require database access in the test environment
    // For now it's a manual verification documented in the migration script
    test.skip();
  });

  test('converts scryptHash to bcrypt after password reset', async ({ page: _page }) => {
    // This would require database access to verify
    // Manual verification: user should have both services.betterAuth.scryptHash
    // and services.password.bcrypt after migration
    test.skip();
  });
});
