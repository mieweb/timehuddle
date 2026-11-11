/**
 * Install / open-in-app prompt (#859)
 *
 * Each time TimeHuddle opens in a browser it asks people without the iOS app
 * to install it, and offers to open the app to people on an iPhone who have
 * it. Who "has it" comes from the server (`nativeAppLastSeenAt`, written by the
 * native app on launch), so these tests set that field directly.
 *
 * Playwright sets `navigator.webdriver`, which hides the prompt for the rest
 * of the suite; these tests clear it so the prompt shows as it would for a
 * person.
 *
 * 1. Laptop, no app: QR modal on every page load, not on in-app navigation
 * 2. Laptop, has the app: no prompt
 * 3. iPhone, no app: install sheet
 * 4. iPhone, has the app: open-in-app sheet that links to the current page
 * 5. Automated browser: no prompt
 */
import { test, expect, devices, type Page } from '@playwright/test';
import { MongoClient } from 'mongodb';

import { TEST_USERS, loginAs } from '../fixtures/users';

const MONGO_URL =
  process.env.MONGO_URL ?? 'mongodb://127.0.0.1:27017/timehuddle_test?replicaSet=rs0';
const USER = TEST_USERS.admin1;
const IPHONE = devices['iPhone 13'];

async function setHasIosApp(hasApp: boolean) {
  const client = await MongoClient.connect(MONGO_URL);
  try {
    const users = client.db().collection('users');
    await users.updateOne(
      { 'emails.address': USER.email },
      hasApp
        ? { $set: { 'nativeAppLastSeenAt.ios': new Date() } }
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
  await setHasIosApp(false);
});

test.describe('App prompt on a laptop', () => {
  test('asks to install on every page load, but not on in-app navigation', async ({ page }) => {
    await setHasIosApp(false);
    await asPerson(page);
    await loginAs(page, USER);

    const modal = page.getByRole('dialog', { name: 'Get TimeHuddle for iPhone' });
    await expect(modal).toBeVisible();
    await expect(modal.getByRole('img', { name: /QR code/ })).toBeVisible();
    await expect(modal.getByRole('button', { name: 'Open App Store' })).toBeVisible();

    await modal.getByRole('button', { name: 'Not Now' }).click();
    await expect(modal).toBeHidden();

    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('button', { name: 'Tickets', exact: true })
      .click();
    await expect(page).toHaveURL(/\/app\/tickets/);
    await expect(modal).toBeHidden();

    await page.reload();
    await expect(modal).toBeVisible();
  });

  test('leaves someone who has the app alone', async ({ page }) => {
    await setHasIosApp(true);
    await asPerson(page);
    await loginAs(page, USER);

    await expect(page.getByRole('dialog', { name: 'Get TimeHuddle for iPhone' })).toHaveCount(0);
  });
});

test.describe('App prompt on an iPhone', () => {
  test.use({ userAgent: IPHONE.userAgent, viewport: IPHONE.viewport, hasTouch: true });

  test('asks someone without the app to install it', async ({ page }) => {
    await setHasIosApp(false);
    await asPerson(page);
    await loginAs(page, USER);

    const sheet = page.getByRole('dialog', { name: 'Get TimeHuddle for iPhone' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Get the App' })).toBeVisible();

    await sheet.getByRole('button', { name: 'Not Now' }).click();
    await expect(sheet).toBeHidden();
  });

  test('offers someone with the app to open this page in it', async ({ page }) => {
    await setHasIosApp(true);
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

test('an automated browser never sees the prompt', async ({ page }) => {
  await setHasIosApp(false);
  await loginAs(page, USER);

  await expect(page.getByRole('dialog', { name: 'Get TimeHuddle for iPhone' })).toHaveCount(0);
});
