import { test, expect } from '@playwright/test';
import { memberAction, memberRow, openMembers } from '../fixtures/people';
import { TEST_USERS, loginAs } from '../fixtures/users';

/**
 * E2E Test: Organization Member Blocking Feature
 *
 * Uses the shared `owner1@test.local` seed user (see backend/scripts/seed.ts and
 * meteor-backend/scripts/set-test-passwords.mjs) so the suite is hermetic —
 * no dependency on a developer-created account.
 */
test.describe('Organization Member Blocking Feature', () => {
  const owner = TEST_USERS.owner1;

  test.beforeEach(async ({ page }) => {
    // Login as owner
    await loginAs(page, owner);
  });

  test('should display members page with a row menu', async ({ page }) => {
    await openMembers(page);

    // The owner's own row has its menu, with block and remove turned off for themselves.
    const view = await memberAction(page, owner.name, 'View profile');
    await expect(view).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Remove from organization' })).toBeDisabled();
    await page.keyboard.press('Escape');
  });

  test('should open the block dialog from a member row and cancel it', async ({ page }) => {
    await openMembers(page);

    // The actual block/unblock happy path is covered by member-blocking-full-flow
    // and meteor-backend/tests/organizations.test.ts; this only opens and cancels.
    const target = TEST_USERS.member1;
    await expect(memberRow(page, target.name).first()).toBeVisible();
    await (await memberAction(page, target.name, 'Block access')).click();

    // Modal renders its title via the @mieweb/ui ModalHeader (not an <hN>),
    // so match by dialog role + visible text.
    const modal = page.getByRole('dialog');
    await expect(modal).toBeVisible({ timeout: 5000 });
    await expect(modal.getByText('Block Member').first()).toBeVisible();
    await modal.getByRole('button', { name: 'Cancel' }).click();
    await expect(modal).toBeHidden({ timeout: 5000 });
  });

  test('should show blocked badge for blocked members', async ({ page }) => {
    await openMembers(page);

    // A blocked member's row says so, and its menu offers Unblock instead of Block.
    const blockedBadges = page.getByText('Blocked', { exact: true });
    if ((await blockedBadges.count()) > 0) {
      const blockedRow = page.getByRole('row').filter({ has: blockedBadges.first() });
      await blockedRow.getByRole('button', { name: /^More actions for/ }).click();
      await expect(page.getByRole('menuitem', { name: 'Unblock' })).toBeVisible();
      await page.keyboard.press('Escape');
    }
  });
});
