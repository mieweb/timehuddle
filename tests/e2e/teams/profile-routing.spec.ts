/**
 * Profile Routing E2E Tests
 *
 * Verifies that profile navigation always lands on /app/profile/:username
 * (or /app/profile/:userId for users without a username) — never at the
 * legacy /:username root path.
 *
 * Scenarios:
 * 1. Clicking a team member on the Teams page → /app/profile/:username
 * 2. Clicking "Profile" in the user dropdown → /app/profile/:ownUsername
 * 3. Profile page displays the correct user's name (not the viewer's)
 */
import { test, expect } from '@playwright/test';
import { MongoClient } from 'mongodb';
import { TEST_USERS, loginAs } from '../fixtures/users';

const MONGO_URL =
  process.env.MONGO_URL ?? 'mongodb://127.0.0.1:27017/timehuddle?directConnection=true';

async function getTeamId(code: string): Promise<string | null> {
  const client = await MongoClient.connect(MONGO_URL);
  const db = client.db();
  const team = await db.collection('teams').findOne({ code });
  await client.close();
  return team ? (team._id.toHexString ? team._id.toHexString() : String(team._id)) : null;
}

/** Select the Test Team Alpha in the teams page via localStorage + reload. */
async function selectTestTeam(page: import('@playwright/test').Page): Promise<boolean> {
  const teamId = await getTeamId('TEST01');
  if (!teamId) return false;

  await page.evaluate((id) => {
    Object.keys(localStorage)
      .filter((k) => k.startsWith('app:selectedTeamId'))
      .forEach((k) => localStorage.setItem(k, id));
    localStorage.setItem('app:selectedTeamId', id);
  }, teamId);
  await page.reload();
  await page.getByRole('heading', { level: 1, name: 'Teams' }).waitFor({ state: 'visible' });
  await page.waitForLoadState('networkidle');
  return true;
}

test.describe('Profile Routing', () => {
  test.setTimeout(60000);

  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USERS.owner1);
  });

  // ── 1. Teams page: click member → /app/profile/:username ──────────────────

  test('clicking a team member navigates to /app/profile/:username', async ({ page }) => {
    await page.goto('/app/teams');
    await page.getByRole('heading', { level: 1, name: 'Teams' }).waitFor({ state: 'visible' });

    const selected = await selectTestTeam(page);
    if (!selected) {
      test.skip(true, 'Test Team Alpha (TEST01) not found in DB');
      return;
    }

    // Switch to Members tab
    const membersTab = page.getByRole('tab', { name: 'Members' });
    await membersTab.waitFor({ state: 'visible', timeout: 15000 });
    await membersTab.click();

    // Click the first member button (View … profile)
    const memberButton = page.getByRole('button', { name: /view .+'s profile/i }).first();
    await memberButton.waitFor({ state: 'visible', timeout: 10000 });

    // Extract expected username from aria-label: "View Test Member One's profile"
    // We clicked a member — just verify the URL is /app/profile/... not /:username
    await memberButton.click();

    await page.waitForURL('**/app/profile/**', { timeout: 10000 });

    const url = page.url();
    expect(url).toMatch(/\/app\/profile\//);
    // Must NOT be a bare root path like /member1
    expect(url).not.toMatch(/^http:\/\/[^/]+\/[^/]+$/);

    // Profile page should be visible — the hero card h1 shows the person's name
    // (the nav bar no longer carries a "Profile" heading per the page-title-in-body refactor)
    await expect(page.locator('h1.text-white').first()).toBeVisible({ timeout: 10000 });
  });

  // ── 2. Teams page: click member1 specifically → /app/profile/member1 ──────

  test('clicking member1 navigates to /app/profile/member1', async ({ page }) => {
    await page.goto('/app/teams');
    await page.getByRole('heading', { level: 1, name: 'Teams' }).waitFor({ state: 'visible' });

    const selected = await selectTestTeam(page);
    if (!selected) {
      test.skip(true, 'Test Team Alpha (TEST01) not found in DB');
      return;
    }

    // Switch to Members tab
    const membersTab = page.getByRole('tab', { name: 'Members' });
    await membersTab.waitFor({ state: 'visible', timeout: 15000 });
    await membersTab.click();

    // Click Test Member One specifically
    const memberButton = page.getByRole('button', {
      name: /view test member one's profile/i,
    });
    await memberButton.waitFor({ state: 'visible', timeout: 10000 });
    await memberButton.click();

    await page.waitForURL('**/app/profile/member1', { timeout: 10000 });

    expect(page.url()).toContain('/app/profile/member1');

    // Profile heading should show member1's name, NOT the viewer's name
    // h1.text-white is the hero card name — AppHeader h1 has no text-white class
    const profileName = page.locator('h1.text-white').first();
    await profileName.waitFor({ state: 'visible', timeout: 10000 });
    const headingText = await profileName.textContent();

    // Should show member1's name or username — not owner1's name
    expect(headingText).not.toBe(TEST_USERS.owner1.name);
    expect(headingText?.toLowerCase()).not.toContain('owner');
  });

  // ── 3. User dropdown: Profile → /app/profile/:ownUsername ─────────────────

  test('Profile button in dropdown navigates to own profile at /app/profile/owner1', async ({
    page,
  }) => {
    await page.goto('/app/dashboard');
    await page.waitForLoadState('networkidle');

    // Open account dropdown
    await page.getByRole('button', { name: /account menu/i }).click();

    // Click Profile
    await page.getByRole('menuitem', { name: /^profile$/i }).click();

    await page.waitForURL('**/app/profile/owner1', { timeout: 10000 });

    expect(page.url()).toContain('/app/profile/owner1');

    // Heading should show owner1's own name
    // h1.text-white is the hero card name — AppHeader h1 has no text-white class
    const profileName = page.locator('h1.text-white').first();
    await profileName.waitFor({ state: 'visible', timeout: 10000 });
    const headingText = await profileName.textContent();
    // Should be "Test Owner One" or "owner1" — not someone else
    expect(headingText?.toLowerCase()).toMatch(/owner|owner1/);
  });

  // ── 4. Direct URL: /app/profile/member1 works and shows correct user ───────

  test('direct navigation to /app/profile/member1 shows member1 profile', async ({ page }) => {
    await page.goto('/app/profile/member1');
    await page.waitForLoadState('networkidle');

    expect(page.url()).toContain('/app/profile/member1');

    // h1.text-white is the hero card name — AppHeader h1 has no text-white class
    const profileName = page.locator('h1.text-white').first();
    await profileName.waitFor({ state: 'visible', timeout: 10000 });
    const headingText = await profileName.textContent();

    // Must show member1's info, not owner1's
    expect(headingText).not.toBe(TEST_USERS.owner1.name);
  });

  // ── 5. Legacy /:username root URLs redirect/404 (not treated as profiles) ──

  test('/:username root path is not treated as a profile route', async ({ page }) => {
    // /member1 at root should NOT resolve to a profile page
    // It should fall through to dashboard or show 404/not-found behaviour
    await page.goto('/member1');
    await page.waitForLoadState('networkidle');

    // Must NOT end up on /member1 showing a profile
    // Either redirected to dashboard or showing something that is NOT a profile
    const url = page.url();
    const isRootUsernamePath = /\/member1$/.test(url);

    if (isRootUsernamePath) {
      // If still on /member1, it should not show the profile hero card
      // (it should show dashboard fallback)
      const profileHero = page.locator('h1:has-text("member1"), h1:has-text("Test Member One")');
      await expect(profileHero).not.toBeVisible({ timeout: 3000 });
    }
    // Acceptable: redirected to /app/dashboard or /app/profile/member1
  });
});
