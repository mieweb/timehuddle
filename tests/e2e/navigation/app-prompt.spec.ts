/**
 * Install / open-in-app prompt (#859)
 *
 * The first time TimeHuddle opens in a browser tab it asks people without the app
 * to install it, and offers to open the app to people on an iPhone or Android
 * phone who have it. Who "has it" comes from the server (`nativeAppLastSeenAt`, written by the
 * native app on launch), so these tests set that field directly.
 *
 * Playwright sets `navigator.webdriver`, which hides the prompt for the rest
 * of the suite; these tests clear it so the prompt shows as it would for a
 * person.
 *
 * 1. Laptop, no app: one QR code (to the backend's /get-app) and both store
 *    badges, once per tab, not on reload or in-app navigation
 * 2. Laptop, has either app: no prompt
 * 3. iPhone, no app: install sheet
 * 4. iPhone, has the app: open-in-app sheet that links to the current page
 * 5. Android, no app (even with the iOS app): Google Play install sheet
 * 6. Android, has the app: open-in-app sheet
 * 7. Automated browser: no prompt
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

test.afterAll(async () => {
  await setNativeApps();
});

test.describe('App prompt on a laptop', () => {
  test('asks to install once per tab, not on reload or in-app navigation', async ({ page }) => {
    await setNativeApps();
    await asPerson(page);
    await loginAs(page, USER);

    const modal = page.getByRole('dialog', { name: QR_TITLE });
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

    await modal.getByRole('button', { name: 'Not Now' }).click();
    await expect(modal).toBeHidden();

    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('button', { name: 'Tickets', exact: true })
      .click();
    await expect(page).toHaveURL(/\/app\/tickets/);
    await expect(modal).toBeHidden();

    await page.reload();
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
    await expect(modal).toBeHidden();
  });

  test('leaves someone who has the app alone', async ({ page }) => {
    await setNativeApps('android');
    await asPerson(page);
    await loginAs(page, USER);

    await expect(page.getByRole('dialog', { name: QR_TITLE })).toHaveCount(0);
  });
});

test.describe('App prompt on an iPhone', () => {
  test.use({ userAgent: IPHONE.userAgent, viewport: IPHONE.viewport, hasTouch: true });

  test('asks someone without the app to install it', async ({ page }) => {
    await setNativeApps();
    await asPerson(page);
    await loginAs(page, USER);

    const sheet = page.getByRole('dialog', { name: 'Get TimeHuddle for iPhone' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Get the App' })).toBeVisible();

    await sheet.getByRole('button', { name: 'Not Now' }).click();
    await expect(sheet).toBeHidden();
  });

  test('offers someone with the app to open this page in it', async ({ page }) => {
    await setNativeApps('ios');
    await asPerson(page);
    await loginAs(page, USER);

    const sheet = page.getByRole('dialog', { name: 'Open in the TimeHuddle app' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('link', { name: 'Open in App' })).toHaveAttribute(
      'href',
      /^timehuddle:\/\/open\/app\/dashboard/,
    );
  });
});

test.describe('App prompt on an Android phone', () => {
  test.use({ userAgent: ANDROID.userAgent, viewport: ANDROID.viewport, hasTouch: true });

  test('asks someone without the Android app to install it, even with the iOS app', async ({
    page,
  }) => {
    await setNativeApps('ios');
    await asPerson(page);
    await loginAs(page, USER);

    const sheet = page.getByRole('dialog', { name: 'Get TimeHuddle for Android' });
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText('Google Play');
    // Opens the app when it's installed after all, Google Play when it isn't.
    await expect(sheet.getByRole('link', { name: 'Get the App' })).toHaveAttribute(
      'href',
      /^intent:\/\/open\/app\/dashboard.*package=com\.mieweb\.timehuddle;S\.browser_fallback_url=https%3A%2F%2Fplay\.google\.com/,
    );

    await sheet.getByRole('button', { name: 'Not Now' }).click();
    await expect(sheet).toBeHidden();
  });

  test('offers someone with the app to open this page in it', async ({ page }) => {
    await setNativeApps('android');
    await asPerson(page);
    await loginAs(page, USER);

    const sheet = page.getByRole('dialog', { name: 'Open in the TimeHuddle app' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('link', { name: 'Open in App' })).toHaveAttribute(
      'href',
      /^intent:\/\/open\/app\/dashboard.*scheme=timehuddle;package=com\.mieweb\.timehuddle;/,
    );
  });
});

test('an automated browser never sees the prompt', async ({ page }) => {
  await setNativeApps();
  await loginAs(page, USER);

  await expect(page.getByRole('dialog', { name: QR_TITLE })).toHaveCount(0);
});
