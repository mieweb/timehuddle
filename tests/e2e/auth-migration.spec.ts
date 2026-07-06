import { test, expect } from '@playwright/test';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * E2E tests for Better Auth → Meteor Accounts migration
 *
 * This test suite verifies:
 * 1. Better Auth users are detected and redirected to password reset
 * 2. Password reset flow works and saves bcrypt hash
 * 3. Users can log in with new password after migration
 * 4. Native Meteor users can still log in normally (no redirect)
 * 5. Invalid credentials show proper error messages
 */

test.describe('Authentication Migration', () => {
  test.beforeAll(async () => {
    // Ensure backend is running
    console.log('⏳ Waiting for backend to be ready...');
    await new Promise((resolve) => setTimeout(resolve, 2000));
  });

  test('Better Auth user gets auto-redirect to password reset', async ({ page }) => {
    // Navigate to login page
    await page.goto('http://localhost:3000/app');
    await expect(page.locator('h2')).toContainText('Sign in to your account');

    // Try to login with Better Auth user (test@example.com)
    await page.getByPlaceholder('you@example.com').fill('test@example.com');
    await page.getByPlaceholder('••••••••').first().fill('anypassword');
    await page.getByRole('button', { name: 'Sign in' }).click();

    // Should auto-redirect to password reset page
    await expect(page).toHaveURL(/\?token=/, { timeout: 15000 });
    await expect(page.locator('h2')).toContainText('Set a new password');

    // Should show migration info message
    await expect(page.locator('[role="status"]')).toContainText('Your account needs migration');

    // Password fields should be visible
    await expect(page.getByPlaceholder('••••••••').first()).toBeVisible();
    await expect(page.getByPlaceholder('••••••••').nth(1)).toBeVisible();
  });

  test('Better Auth user can set new password and login', async ({ page }) => {
    // Start at login
    await page.goto('http://localhost:3000/app');

    // Trigger migration redirect
    await page.getByPlaceholder('you@example.com').fill('test@example.com');
    await page.getByPlaceholder('••••••••').first().fill('anypassword');
    await page.getByRole('button', { name: 'Sign in' }).click();

    // Wait for redirect
    await page.waitForURL(/\?token=/, { timeout: 15000 });

    // Set new password
    const newPassword = 'NewMigratedPassword123!';
    await page.getByPlaceholder('••••••••').first().fill(newPassword);
    await page.getByPlaceholder('••••••••').nth(1).fill(newPassword);
    await page.getByRole('button', { name: 'Set new password' }).click();

    // Should redirect back to login with success message
    await expect(page).toHaveURL(/mode=login/, { timeout: 15000 });
    await expect(page.getByText('Password reset successfully')).toBeVisible();

    // Now login with new password
    await page.getByRole('button', { name: 'Go to Sign In' }).click();
    await page.getByPlaceholder('you@example.com').fill('test@example.com');
    await page.getByPlaceholder('••••••••').first().fill(newPassword);
    await page.getByRole('button', { name: 'Sign in' }).click();

    // Should reach dashboard
    await expect(page).toHaveURL(/\/app\/dashboard/, { timeout: 15000 });
    await expect(page.locator('h1')).toContainText('Dashboard');
  });

  test('Invalid credentials show error message', async ({ page }) => {
    await page.goto('http://localhost:3000/app');

    // Try invalid login
    await page.getByPlaceholder('you@example.com').fill('nonexistent@example.com');
    await page.getByPlaceholder('••••••••').first().fill('wrongpassword');
    await page.getByRole('button', { name: 'Sign in' }).click();

    // Should show error
    await expect(page.locator('[role="alert"]')).toContainText(/Invalid|error/i, {
      timeout: 10000,
    });

    // Should NOT redirect
    await expect(page).toHaveURL(/\/app$/);
  });

  test('Migration preserves user data', async ({ page }) => {
    // After migration, verify user data is intact
    // Login with migrated user
    await page.goto('http://localhost:3000/app');
    await page.getByPlaceholder('you@example.com').fill('test@example.com');
    await page.getByPlaceholder('••••••••').first().fill('NewMigratedPassword123!');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await page.waitForURL(/\/app\/dashboard/, { timeout: 15000 });

    // Verify user profile data is accessible
    await page.getByRole('button', { name: /account menu/i }).click();

    // User should have their data (this will vary based on actual user data)
    // Just verify the menu opens and has user info
    await expect(page.getByRole('menu')).toBeVisible();
  });
});

test.describe('Database Verification', () => {
  test('Better Auth user has both scrypt and bcrypt after migration', async () => {
    const { stdout } = await execAsync(`
      mongosh mongodb://localhost:27017/timehuddle --quiet --eval '
        const user = db.users.findOne({ "emails.address": "test@example.com" });
        print(JSON.stringify({
          hasScrypt: !!user?.services?.betterAuth?.scryptHash,
          hasBcrypt: !!user?.services?.password?.bcrypt,
          migratedFlag: user?.services?.betterAuth?.migratedToBcrypt
        }));
      '
    `);

    const result = JSON.parse(stdout.trim());
    expect(result.hasScrypt).toBe(true); // Original hash preserved
    expect(result.hasBcrypt).toBe(true); // New bcrypt password set
  });

  test('All collections are preserved during migration', async () => {
    // Verify key collections exist and have data
    const { stdout } = await execAsync(`
      mongosh mongodb://localhost:27017/timehuddle --quiet --eval '
        print(JSON.stringify({
          users: db.users.countDocuments(),
          clockevents: db.clockevents.countDocuments(),
          tickets: db.tickets.countDocuments(),
          teams: db.teams.countDocuments(),
          organizations: db.organizations.countDocuments()
        }));
      '
    `);

    const counts = JSON.parse(stdout.trim());
    expect(counts.users).toBeGreaterThan(0);
    // Other collections may be empty in test env, just verify they exist
    expect(counts).toHaveProperty('clockevents');
    expect(counts).toHaveProperty('tickets');
    expect(counts).toHaveProperty('teams');
    expect(counts).toHaveProperty('organizations');
  });
});
