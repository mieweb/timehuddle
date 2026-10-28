/**
 * Account menu at phone width (issue #574, trimmed in #756)
 *
 * Below 768px — the normal view in the Capacitor app — the avatar menu and the
 * bottom nav's More sheet both carry the account menu. It is Help only now:
 * Enterprise and People are in the main nav, and Usage and Seeder are
 * sections of Settings.
 *
 * 1. The avatar menu lists Help and no Admin or Developers items
 * 2. The More sheet offers Help and no Admin section
 * 3. An org owner reaches Usage through Settings, and the old link still works
 */
import { test, expect, type Page } from '@playwright/test';
import { TEST_USERS, loginAs } from '../fixtures/users';

const PHONE = { width: 390, height: 844 };
const HELP_ITEMS = ['Report an Issue', 'Share Your Feedback', 'App Store'];
const MOVED_ITEMS = ['Enterprise', 'Members', 'Usage', 'Seeder'];

async function openAccountMenu(page: Page) {
  await page.getByRole('button', { name: 'Account menu' }).click();
}

async function openMoreSheet(page: Page) {
  await page
    .getByRole('navigation', { name: 'Bottom navigation' })
    .getByRole('button', { name: 'More' })
    .click();
  const sheet = page.getByRole('dialog', { name: 'More' });
  await expect(sheet).toBeVisible();
  return sheet;
}

test.describe('Account menu on a phone-width screen', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(PHONE);
  });

  test('avatar menu shows Help only, even to an org owner', async ({ page }) => {
    await loginAs(page, TEST_USERS.owner1);
    await openAccountMenu(page);

    for (const label of HELP_ITEMS) {
      await expect(page.getByRole('menuitem', { name: label })).toBeVisible();
    }
    for (const label of MOVED_ITEMS) {
      await expect(page.getByRole('menuitem', { name: label, exact: true })).toHaveCount(0);
    }
  });

  test('More sheet offers Help and no Admin section', async ({ page }) => {
    await loginAs(page, TEST_USERS.owner1);
    const sheet = await openMoreSheet(page);

    await expect(sheet.getByRole('button', { name: 'Help' })).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Admin' })).toHaveCount(0);
    await expect(sheet.getByRole('button', { name: 'Developers' })).toHaveCount(0);
  });

  test('an org owner reaches Usage in Settings, and the old link goes there', async ({ page }) => {
    await loginAs(page, TEST_USERS.owner1);
    await page.goto('/app/org/usage');
    await page.waitForURL(/\/app\/settings\?section=usage/);
    await expect(page.getByRole('heading', { name: 'Usage', level: 2 })).toBeVisible({
      timeout: 20000,
    });
  });
});
