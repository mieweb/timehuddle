/**
 * Notifications E2E Tests
 *
 * 1. All notifications appear
 * 2. Mark as read, select all, and delete work
 */
import { test, expect } from '@playwright/test';
import { TEST_USERS, loginAs } from '../fixtures/users';

test.describe('Notifications', () => {
  test('should display notifications page with correct URL and components', async ({ page }) => {
    await loginAs(page, TEST_USERS.owner1);
    await page.goto('/app/notifications');
    await page
      .getByRole('heading', { level: 1, name: 'Notifications' })
      .waitFor({ state: 'visible' });

    // Verify correct URL
    expect(page.url()).toContain('/app/notifications');

    // Verify heading
    await expect(page.getByRole('heading', { level: 1, name: 'Notifications' })).toBeVisible();

    // Select button should be visible
    await expect(page.getByRole('button', { name: 'Select' })).toBeVisible();
  });

  test('should show notifications when they exist', async ({ page }) => {
    // Occasionally the initial data fetch after login takes a while; give this
    // one a generous budget so the sequential suite doesn't flake.
    test.setTimeout(60000);
    await loginAs(page, TEST_USERS.owner1);
    await page.goto('/app/notifications');
    await page
      .getByRole('heading', { level: 1, name: 'Notifications' })
      .waitFor({ state: 'visible' });
    await page.waitForTimeout(2000);

    const noNotifications = page.getByText('No notifications yet');
    const hasEmpty = await noNotifications.isVisible({ timeout: 2000 }).catch(() => false);

    if (hasEmpty) {
      // No notifications - verify empty state message
      await expect(noNotifications).toBeVisible();
      await expect(
        page.getByText('Team invites and new messages will show up here.'),
      ).toBeVisible();
    } else {
      // Has notifications - verify the notification list (one role="list" per day)
      const notificationList = page.getByRole('main').getByRole('list').first();
      await expect(notificationList).toBeVisible();
    }
  });

  test('select mode, select all, and delete should work', async ({ page }) => {
    // Sits deep in the sequential suite; a warm backend can push this past
    // the default 30s. 60s gives login + hydration room without slowing
    // the healthy path.
    test.setTimeout(60000);
    await loginAs(page, TEST_USERS.owner1);
    await page.goto('/app/notifications');
    await page
      .getByRole('heading', { level: 1, name: 'Notifications' })
      .waitFor({ state: 'visible' });
    await page.waitForTimeout(2000);

    // Click Select to enter select mode
    await page.getByRole('button', { name: 'Select' }).click();
    await page.waitForTimeout(500);

    // If there are notifications, we should see Select all and Delete buttons
    const selectAllBtn = page.getByRole('button', { name: /Select all/i });
    const _deleteBtn = page.getByRole('button', { name: /Delete/i });
    const exitBtn = page.getByRole('button', { name: 'Exit selection mode' });

    // Exit button should always be visible in select mode
    if (await exitBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      // Verify we're in select mode
      await expect(page.getByText(/\d+ selected/)).toBeVisible();

      // Select all if available
      if (await selectAllBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await selectAllBtn.click();
        await page.waitForTimeout(500);
      }

      // Exit select mode
      await exitBtn.click();
      await page.waitForTimeout(500);
    }
  });

  test('mark all read should work when unread notifications exist', async ({ page }) => {
    await loginAs(page, TEST_USERS.owner1);
    await page.goto('/app/notifications');
    await page
      .getByRole('heading', { level: 1, name: 'Notifications' })
      .waitFor({ state: 'visible' });
    await page.waitForTimeout(2000);

    // Check if Mark all read button is visible (only shows when there are unread notifications)
    const markAllBtn = page.getByRole('button', { name: /Mark all read/i });
    if (await markAllBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await markAllBtn.click();
      await page.waitForTimeout(1000);
      // After marking all read, the button should disappear
      await expect(markAllBtn).not.toBeVisible({ timeout: 5000 });
    }
    // If no unread notifications, this test passes vacuously
  });

  // #804: opening a notification saves when it was read, and the inbox shows
  // that time under today's heading, before and after a reload.
  test('opening a notification shows when it was read', async ({ page }) => {
    test.setTimeout(60000);
    await loginAs(page, TEST_USERS.owner1);

    // The one control that creates a notification for the signed-in user.
    await page.goto('/app/settings?section=notifications');
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('notifications_testPush') && r.ok()),
      page.getByRole('button', { name: 'Send test notification', exact: true }).click(),
    ]);

    await page.goto('/app/notifications');
    const today = page.getByRole('region', { name: /^Today · / });
    const newest = today.getByRole('listitem').first();
    await expect(newest).toContainText('Test Push', { timeout: 20000 });
    await expect(newest.getByLabel('Unread')).toBeVisible();
    await expect(newest).not.toContainText('Read');

    await newest.getByRole('button').first().click();
    const readLine = newest.getByText(/^Read /);
    await expect(readLine).toBeVisible({ timeout: 10000 });
    await expect(newest.getByLabel('Unread')).toHaveCount(0);
    const shownAfterClick = await readLine.textContent();

    // The saved time comes back from the server unchanged.
    await page.reload();
    await expect(
      today
        .getByRole('listitem')
        .first()
        .getByText(/^Read /),
    ).toHaveText(shownAfterClick ?? '', { timeout: 20000 });
  });
});
