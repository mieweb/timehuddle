/**
 * Account menu at phone width (issue #574)
 *
 * Below 768px — the normal view in the Capacitor app — the avatar menu used to
 * hide Admin and Help, and the bottom nav's More sheet that was meant to carry
 * them had no Usage entry and no Admin section for an org admin outside an
 * enterprise. owner1 is exactly that user: owner of the default organization,
 * member of no enterprise.
 *
 * 1. Avatar menu lists Admin and Help items, and Usage navigates
 * 2. More sheet's Admin section lists Members and Usage, and Usage navigates
 * 3. A plain member sees Help but no Admin in either place
 */
import { test, expect, type Page } from '@playwright/test';
import { TEST_USERS, loginAs } from '../fixtures/users';

const PHONE = { width: 390, height: 844 };
const HELP_ITEMS = ['Report an Issue', 'Share Your Feedback', 'TestFlight'];

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

  test('avatar menu shows Admin and Help to an org owner', async ({ page }) => {
    await loginAs(page, TEST_USERS.owner1);
    await openAccountMenu(page);

    for (const label of ['Members', 'Usage', ...HELP_ITEMS]) {
      await expect(page.getByRole('menuitem', { name: label })).toBeVisible();
    }

    await page.getByRole('menuitem', { name: 'Usage' }).click();
    await page.waitForURL(/\/app\/org\/usage(\?|$)/);
  });

  test('More sheet Admin section lists Members and Usage for an org owner', async ({ page }) => {
    await loginAs(page, TEST_USERS.owner1);
    const sheet = await openMoreSheet(page);

    await sheet.getByRole('button', { name: 'Admin' }).click();
    await expect(sheet.getByRole('heading', { name: 'Admin' })).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Members' })).toBeVisible();

    await sheet.getByRole('button', { name: 'Usage' }).click();
    await page.waitForURL(/\/app\/org\/usage(\?|$)/);
    await expect(sheet).toBeHidden();
  });

  test('a plain member sees Help but no Admin', async ({ page }) => {
    await loginAs(page, TEST_USERS.member1);

    await openAccountMenu(page);
    for (const label of HELP_ITEMS) {
      await expect(page.getByRole('menuitem', { name: label })).toBeVisible();
    }
    await expect(page.getByRole('menuitem', { name: 'Members' })).toHaveCount(0);
    await expect(page.getByRole('menuitem', { name: 'Usage' })).toHaveCount(0);
    await page.keyboard.press('Escape');

    const sheet = await openMoreSheet(page);
    await expect(sheet.getByRole('button', { name: 'Help' })).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Admin' })).toHaveCount(0);
  });
});
