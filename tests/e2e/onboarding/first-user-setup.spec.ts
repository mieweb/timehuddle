import { test, expect } from '@playwright/test';

test.describe('New User Signup and Onboarding', () => {
  test('signup, claim username, and land on dashboard', async ({ page }) => {
    const timestamp = Date.now();

    // Navigate to signup page
    await page.goto('http://localhost:3000/app?mode=signup');
    await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();

    // Use unique name to avoid username collisions across parallel workers
    const uniqueName = `Ob${String(timestamp).slice(-6)}`;
    await page.getByPlaceholder('Jane').fill(uniqueName);
    await page.getByPlaceholder('Doe').fill('Test');
    await page.getByPlaceholder('you@example.com').fill(`onboard${timestamp}@example.com`);
    await page.getByPlaceholder('••••••••').first().fill('TestPassword123!');
    await page.getByPlaceholder('••••••••').last().fill('TestPassword123!');

    // Submit signup form
    await page.getByRole('button', { name: 'Create account' }).click();

    // Wait for username claim modal
    await expect(page.getByRole('heading', { name: 'Username Required' })).toBeVisible({
      timeout: 10000,
    });

    // Verify username input is pre-filled and availability check completes
    const usernameInput = page.getByPlaceholder('your-handle');
    await expect(usernameInput).not.toBeEmpty();
    // Wait for the availability check (debounced 400ms + network)
    await expect(page.getByText(/✓.*is available/)).toBeVisible({ timeout: 8000 });

    // Claim username
    await page.getByRole('button', { name: 'Claim username' }).click();

    // After claiming username, user should reach the dashboard (auto-joined to default org)
    await expect(page).toHaveURL(/\/app\/(dashboard|enterprise)/, { timeout: 15000 });

    // Verify the user is logged in — sidebar should be visible
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible({
      timeout: 5000,
    });
  });
});
