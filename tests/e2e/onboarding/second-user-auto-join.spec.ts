import { test, expect } from '@playwright/test';

/**
 * Test that a new user signing up is auto-joined to the default organization
 * and does NOT see the installer modal.
 */

test.describe('New User Auto-Join', () => {
  test('new user is auto-joined to default org and does not see installer modal', async ({ page }) => {
    const timestamp = Date.now();

    // Navigate to signup
    await page.goto('http://localhost:3000/app?mode=signup');
    await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();

    // Use unique name to avoid username collisions across parallel workers
    const uniqueName = `Aj${String(timestamp).slice(-6)}`;
    await page.getByPlaceholder('Jane').fill(uniqueName);
    await page.getByPlaceholder('Doe').fill('User');
    await page.getByPlaceholder('you@example.com').fill(`autojoin${timestamp}@example.com`);
    await page.getByPlaceholder('••••••••').first().fill('TestPassword123!');
    await page.getByPlaceholder('••••••••').last().fill('TestPassword123!');
    await page.getByRole('button', { name: 'Create account' }).click();

    // Claim username
    await expect(page.getByRole('heading', { name: 'Username Required' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/✓.*is available/)).toBeVisible({ timeout: 8000 });
    await page.getByRole('button', { name: 'Claim username' }).click();

    // Should NOT see installer modal — should land on dashboard
    await expect(page).toHaveURL(/\/app\/(dashboard|org|enterprise)/, { timeout: 15000 });
    const installerModal = page.getByRole('heading', { name: 'Complete Initial Setup' });
    await expect(installerModal).not.toBeVisible();

    // Verify user can access org members page (auto-joined)
    await page.goto('http://localhost:3000/app/org/members');
    await expect(page.getByRole('heading', { name: /Members/i }).first()).toBeVisible({ timeout: 10000 });

    // Verify user appears in the members list (unique name from signup)
    await expect(page.getByText(new RegExp(`${uniqueName} User`, 'i'))).toBeVisible({ timeout: 5000 });
  });
});
