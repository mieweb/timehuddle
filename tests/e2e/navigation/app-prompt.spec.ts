/**
 * Get-the-app strip on the dashboard (#859)
 *
 * The first time the dashboard renders in a browser tab, a one-line strip
 * under the navbar tells people
 * without the app about it, and offers people on an iPhone or Android phone
 * who have it to open this page in the app. Who "has it" comes from the
 * server (`nativeAppLastSeenAt`, written by the native app on launch), so these
 * tests set that field directly.
 *
 * Playwright sets `navigator.webdriver`, which hides the card for the rest of
 * the suite; these tests clear it so the card shows as it would for a person.
 *
 * 1. Laptop, no app: the strip, no popup until Download opens the QR code
 *    (one code to the backend's /get-app, both store badges); once per tab,
 *    not on coming back to the dashboard or on reload
 * 2. Laptop, has either app: no strip
 * 3. iPhone, no app: Download goes to the App Store; ✕ dismisses the strip
 * 4. iPhone, has the app: Open in App links to the current page
 * 5. Android, no app (even with the iOS app): Download opens the app or Google Play
 * 6. Android, has the app: Open in App through the same intent link
 * 7. Automated browser: no strip
 */
import { test, expect, devices, type Page } from '@playwright/test';
import { MongoClient } from 'mongodb';

import { TEST_USERS, loginAs } from '../fixtures/users';

const MONGO_URL =
  process.env.MONGO_URL ?? 'mongodb://127.0.0.1:27017/timehuddle_test?replicaSet=rs0';
const USER = TEST_USERS.admin1;
const IPHONE = devices['iPhone 13'];
const ANDROID = devices['Pixel 7'];
const QR_TITLE = 'Get TimeHuddle for your phone';
const INSTALL_TEXT = 'TimeHuddle is on mobile.';
const OPEN_TEXT = 'Continue in the app.';

/** The one-line strip under the navbar. */
const strip = (page: Page) => page.getByRole('region', { name: 'TimeHuddle mobile app' });

/** Set which native apps the user has opened recently; none clears them all. */
async function setNativeApps(...platforms: Array<'ios' | 'android'>) {
  const client = await MongoClient.connect(MONGO_URL);
  try {
    const users = client.db().collection('users');
    await users.updateOne(
      { 'emails.address': USER.email },
      platforms.length
        ? {
            $set: {
              nativeAppLastSeenAt: Object.fromEntries(platforms.map((p) => [p, new Date()])),
            },
          }
        : { $unset: { nativeAppLastSeenAt: '' } },
    );
  } finally {
    await client.close();
  }
}

/** Act like a person's browser: Playwright's `navigator.webdriver` hides the prompt. */
async function asPerson(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false });
  });
}

/**
 * Wait for the signed-in app to render. `loginAs` only waits for the dashboard
 * URL, which is set before the dashboard renders, so a "no strip" check made
 * straight after it would pass before a wrong card could appear.
 */
async function expectSignedInShell(page: Page) {
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
}

test.afterAll(async () => {
  await setNativeApps();
});

test.describe('App card on a laptop', () => {
  test('shows once per tab, and opens the QR code only when asked', async ({ page }) => {
    await setNativeApps();
    await asPerson(page);
    await loginAs(page, USER);

    const installCard = strip(page);
    await expect(installCard).toBeVisible();
    await expect(installCard).toContainText(INSTALL_TEXT);
    // A notice, not a popup: nothing opens until it's asked for.
    const modal = page.getByRole('dialog', { name: QR_TITLE });
    await expect(modal).toHaveCount(0);

    await installCard.getByRole('button', { name: 'Download' }).click();
    await expect(modal).toBeVisible();
    // One code for both phones, pointing at the backend's /get-app redirect.
    await expect(modal.getByRole('img', { name: /QR code/ })).toHaveCount(1);
    const stores = modal.getByRole('navigation', { name: 'App stores' });
    await expect(stores.getByRole('link', { name: 'Download on the App Store' })).toHaveAttribute(
      'href',
      /apps\.apple\.com/,
    );
    await expect(stores.getByRole('link', { name: 'Get it on Google Play' })).toHaveAttribute(
      'href',
      /play\.google\.com/,
    );
    await modal.getByRole('button', { name: 'Close' }).last().click();
    await expect(modal).toBeHidden();

    // Once per tab: not again on coming back to the dashboard, nor on reload.
    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('button', { name: 'Tickets', exact: true })
      .click();
    await expect(page).toHaveURL(/\/app\/tickets/);
    await page.goBack();
    await expect(page).toHaveURL(/\/app\/dashboard/);
    await expectSignedInShell(page);
    await expect(installCard).toHaveCount(0);

    await page.reload();
    await expectSignedInShell(page);
    await expect(installCard).toHaveCount(0);
  });

  test('leaves someone who has the app alone', async ({ page }) => {
    await setNativeApps('android');
    await asPerson(page);
    await loginAs(page, USER);

    await expectSignedInShell(page);
    await expect(strip(page)).toHaveCount(0);
  });
});

test.describe('App card on an iPhone', () => {
  test.use({ userAgent: IPHONE.userAgent, viewport: IPHONE.viewport, hasTouch: true });

  test('offers someone without the app the App Store, and can be dismissed', async ({ page }) => {
    await setNativeApps();
    await asPerson(page);
    await loginAs(page, USER);

    const installCard = strip(page);
    await expect(installCard).toBeVisible();
    await expect(installCard).toContainText(INSTALL_TEXT);
    await expect(installCard.getByRole('button', { name: 'Download' })).toBeVisible();

    await installCard.getByRole('button', { name: 'Dismiss' }).click();
    await expect(installCard).toHaveCount(0);
  });

  test('offers someone with the app to open this page in it', async ({ page }) => {
    await setNativeApps('ios');
    await asPerson(page);
    await loginAs(page, USER);

    const openCard = strip(page);
    await expect(openCard).toContainText(OPEN_TEXT);
    await expect(openCard.getByRole('link', { name: 'Open in App' })).toHaveAttribute(
      'href',
      /^timehuddle:\/\/open\/app\/dashboard/,
    );
  });
});

test.describe('App card on an Android phone', () => {
  test.use({ userAgent: ANDROID.userAgent, viewport: ANDROID.viewport, hasTouch: true });

  test('offers someone without the Android app Google Play, even with the iOS app', async ({
    page,
  }) => {
    await setNativeApps('ios');
    await asPerson(page);
    await loginAs(page, USER);

    const installCard = strip(page);
    await expect(installCard).toBeVisible();
    await expect(installCard).toContainText(INSTALL_TEXT);
    // Opens the app when it's installed after all, Google Play when it isn't.
    await expect(installCard.getByRole('link', { name: 'Download' })).toHaveAttribute(
      'href',
      /^intent:\/\/open\/app\/dashboard.*package=com\.mieweb\.timehuddle;S\.browser_fallback_url=https%3A%2F%2Fplay\.google\.com/,
    );
  });

  test('offers someone with the app to open this page in it', async ({ page }) => {
    await setNativeApps('android');
    await asPerson(page);
    await loginAs(page, USER);

    const openCard = strip(page);
    await expect(openCard).toContainText(OPEN_TEXT);
    await expect(openCard.getByRole('link', { name: 'Open in App' })).toHaveAttribute(
      'href',
      /^intent:\/\/open\/app\/dashboard.*scheme=timehuddle;package=com\.mieweb\.timehuddle;/,
    );
  });
});

test('an automated browser never sees the strip', async ({ page }) => {
  await setNativeApps();
  await loginAs(page, USER);

  await expectSignedInShell(page);
  await expect(strip(page)).toHaveCount(0);
});
