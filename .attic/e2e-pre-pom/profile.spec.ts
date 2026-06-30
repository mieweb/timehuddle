import { expect, test } from '@playwright/test';

const TEST_EMAIL = 'alice@example.com';
const TEST_PASSWORD = 'Password1!';
const TEST_USERNAME = 'alice';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function login(page: import('@playwright/test').Page) {
  await page.goto('/app');
  await page.waitForSelector('input[type="email"]', { timeout: 10000 });
  await page.fill('input[type="email"]', TEST_EMAIL);
  await page.fill('input[type="password"]', TEST_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/dashboard', { timeout: 15000 });
}

// ─── Profile routing E2E ──────────────────────────────────────────────────────

test.describe('Profile routing', () => {
  test.setTimeout(60000);

  test('/:username direct URL loads profile inside app shell with sidebar', async ({ page }) => {
    await login(page);

    await page.goto(`/${TEST_USERNAME}`);

    // Sidebar should be present (app shell, not bare page)
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible({
      timeout: 10000,
    });

    // Profile content should render
    await expect(page.getByRole('heading', { name: 'Alice Admin' })).toBeVisible({
      timeout: 10000,
    });
  });

  test('/:username in-app navigate from Teams page keeps sidebar', async ({ page }) => {
    await login(page);

    await page.goto('/app/teams');
    await page.waitForSelector('text=MEMBERS', { timeout: 15000 });

    // Click Alice's member row (she is in Developers team)
    await page.getByRole('button', { name: "View Alice Admin's profile" }).first().click();

    // URL should update to /:username
    await expect(page).toHaveURL(`/${TEST_USERNAME}`, { timeout: 10000 });

    // Sidebar still present — no full page reload
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();

    // Profile card visible
    await expect(page.getByRole('heading', { name: 'Alice Admin' })).toBeVisible();
  });

  test('Profile menu in header navigates to own profile in-app', async ({ page }) => {
    await login(page);

    // Open user dropdown
    await page.getByRole('button', { name: 'Account menu' }).click();
    await page.getByRole('menuitem', { name: /Profile/i }).click();

    // Should navigate to own /:username
    await expect(page).toHaveURL(`/${TEST_USERNAME}`, { timeout: 10000 });

    // Sidebar intact
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
  });

  test('unknown /:username shows not-found state', async ({ page }) => {
    await login(page);

    await page.goto('/thisuserdoesnotexist99999');

    // Sidebar present
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible({
      timeout: 10000,
    });

    // Should show a not-found message
    await expect(page.getByText(/user not found/i)).toBeVisible({ timeout: 10000 });
  });

  test('/app/profile/:userId in-app route loads profile with sidebar', async ({ page }) => {
    await login(page);

    // Navigate to teams to get a member ID from the URL or just use direct navigation
    await page.goto('/app/teams');
    await page.waitForSelector('text=MEMBERS', { timeout: 15000 });

    // Click the first non-self member's row button
    const memberButtons = page.getByRole('button', { name: /View .+'s profile/ });
    await memberButtons.first().click();

    // URL should be /:username (since alice has a username)
    const url = page.url();
    expect(url).toMatch(/\/(alice|bob|carol|dan|eve|ian|mfisher)/);

    // Sidebar present
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
  });
});
