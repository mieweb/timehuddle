/**
 * Enterprise page: owners and admins manage it, everyone else sees where they belong.
 *
 * The member test is also the check on `orgs.list` carrying `enterpriseName`:
 * `enterprises.list` only covers owners and admins, so without it a member
 * would see "Not part of an enterprise".
 */
import { test, expect } from '@playwright/test';

import { TEST_USERS, loginAs } from '../fixtures/users';

test.describe('Enterprise page', () => {
  test('an owner sees organizations, a defaults summary, and owners and admins', async ({
    page,
  }) => {
    await loginAs(page, TEST_USERS.owner1);
    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('button', { name: 'Enterprise' })
      .click();
    await expect(page).toHaveURL(/\/app\/enterprise/);

    await expect(page.getByRole('heading', { name: 'Organizations' })).toBeVisible({
      timeout: 20000,
    });
    await expect(page.getByRole('heading', { name: 'Defaults' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Owners and admins' })).toBeVisible();

    // The defaults are edited in Settings now, not on this page.
    await page.getByRole('button', { name: 'Edit in Settings' }).click();
    await expect(page).toHaveURL(/section=enterprise/);
    await expect(page.getByLabel('Enterprise name')).toBeVisible();
  });

  test('a member sees their enterprise and organization, read-only', async ({ page }) => {
    await loginAs(page, TEST_USERS.member5);
    await page.goto('/app/enterprise');

    await expect(page.getByText('Your organizations')).toBeVisible({ timeout: 20000 });
    await expect(page.getByText('Not part of an enterprise')).toHaveCount(0);
    await expect(page.getByText('You are a member').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'New organization' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Edit in Settings' })).toHaveCount(0);
  });

  test('Settings shows Enterprise only to its owners and admins', async ({ page }) => {
    await loginAs(page, TEST_USERS.member5);
    await page.goto('/app/settings?section=enterprise');
    // A section you can't see falls back to Profile.
    await expect(page.getByRole('heading', { name: 'Profile', level: 2 })).toBeVisible({
      timeout: 20000,
    });
    await expect(
      page.getByText('Team and organization settings are managed by your admins.'),
    ).toBeVisible();
  });
});
