/**
 * Real-time notification synchronization.
 *
 * The DDP client subscribes to `notifications.liveForUser` globally
 * (src/lib/ddp.ts), so a notification created in one tab must reach the same
 * user's other tabs without a reload. The publication is scoped to
 * `this.userId`, which is why both tabs here are one user in one context —
 * the old version of this file logged in as two *different* users and then
 * compared substring-matched element counts, an assertion that holds equally
 * well when nothing syncs at all.
 *
 * The sidebar's "Test push notification" button is the trigger: it is the one
 * control in the app that creates a notification for the signed-in user
 * on demand (`notifications.testPush`).
 */
import { test, expect, type Page, type BrowserContext } from '@playwright/test';

import { TEST_USERS, loginAs } from '../fixtures/users';

/** The notification list's own <ul role="list"> — the sidebar's lists have no explicit role. */
const rows = (page: Page) => page.locator('ul[role="list"] > li');
const unreadDots = (page: Page) => page.getByLabel('Unread');
/** Exact, because a delivered notification's own row reads "Test Push …". */
const testPushButton = (page: Page) =>
  page.getByRole('button', { name: 'Test push notification', exact: true });

async function openNotifications(page: Page): Promise<void> {
  await page.goto('/app/notifications');
  // "Mark all read" only renders while something is unread, so the always-on
  // "Select" button is what tells us the page has finished loading.
  await expect(page.getByRole('button', { name: 'Select', exact: true })).toBeVisible({
    timeout: 20000,
  });
}

test.describe('Real-time Notifications', () => {
  let context: BrowserContext;
  let session1: Page;
  let session2: Page;

  test.beforeEach(async ({ browser }) => {
    context = await browser.newContext();
    session1 = await context.newPage();
    await loginAs(session1, TEST_USERS.admin3);
    await openNotifications(session1);

    session2 = await context.newPage();
    await openNotifications(session2);
  });

  test.afterEach(async () => {
    await context?.close();
  });

  test('a notification created in one tab appears in the other', async () => {
    const before = await rows(session2).count();

    await testPushButton(session1).click();

    await expect(rows(session2)).toHaveCount(before + 1, { timeout: 15000 });
    await expect(session2.getByText('Test Push').first()).toBeVisible();
  });

  test('it arrives unread in the observing tab', async () => {
    const beforeUnread = await unreadDots(session2).count();

    await testPushButton(session1).click();

    await expect(unreadDots(session2)).toHaveCount(beforeUnread + 1, { timeout: 15000 });
  });

  test('read state is persisted, but reaches the other tab only on reload', async () => {
    // `subscribeNewNotifications` (src/lib/ddp.ts) forwards documents it has
    // not seen before and nothing else, so an *update* to an existing
    // notification — which is what marking it read is — never reaches an open
    // tab. This test pins that down rather than pretending otherwise: the
    // change must survive a refetch, and the second tab must agree after one.
    await testPushButton(session1).click();
    await expect(unreadDots(session2)).not.toHaveCount(0, { timeout: 15000 });

    await session2.getByRole('button', { name: 'Mark all read' }).click();
    await expect(unreadDots(session2)).toHaveCount(0, { timeout: 15000 });

    await openNotifications(session1);
    await expect(unreadDots(session1)).toHaveCount(0, { timeout: 15000 });
  });
});
