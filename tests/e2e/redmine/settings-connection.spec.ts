/**
 * Settings → Redmine: linking an account and unlinking (plan area h).
 *
 * Redmine is stubbed at the wormhole boundary — see `fixtures/redmine.ts` for
 * why, and for what that deliberately does not prove. In particular, stubbing
 * `connect` bypasses real API-key validation entirely: a green run here says
 * the card behaves correctly given a server answer, never that the key check
 * works.
 */
import { test, expect, type Page } from '@playwright/test';

import { TEST_USERS, loginAs } from '../fixtures/users';
import {
  BASE_URL,
  connectedStatus,
  stubRedmine,
  type RedmineStub,
  type StubValue,
} from '../fixtures/redmine';

const apiKeyInput = (page: Page) => page.getByLabel('Redmine API key');
const connectButton = (page: Page) => page.getByRole('button', { name: 'Connect', exact: true });

async function openSettings(
  page: Page,
  overrides: Record<string, StubValue>,
): Promise<RedmineStub> {
  const rm = await stubRedmine(page, overrides);
  await page.goto('/app/settings');
  await expect(page.getByRole('heading', { name: 'Redmine' })).toBeVisible({ timeout: 20000 });
  return rm;
}

test.describe('Settings — Redmine connection', () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USERS.owner1);
  });

  test('offers the key form while unlinked', async ({ page }) => {
    await openSettings(page, {});

    await expect(apiKeyInput(page)).toBeVisible();
    await expect(connectButton(page)).toBeDisabled();
    await expect(page.getByText('Connected', { exact: true })).toHaveCount(0);
  });

  test('links an account and shows who it belongs to', async ({ page }) => {
    let connected = false;
    const rm = await openSettings(page, {
      status: () => (connected ? connectedStatus({ login: 'priya.patel' }) : { connected: false }),
      connect: () => {
        connected = true;
        return connectedStatus({ login: 'priya.patel', redmineName: 'Priya Patel' });
      },
    });

    await apiKeyInput(page).fill('a-personal-api-key');
    await connectButton(page).click();

    await expect(page.getByText('Connected', { exact: true })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Priya Patel', { exact: true })).toBeVisible();
    await expect(page.getByText(`@priya.patel · ${BASE_URL}`)).toBeVisible();
    expect(rm.calls('connect')[0]).toEqual({ apiKey: 'a-personal-api-key' });
  });

  test('the key never survives a successful link', async ({ page }) => {
    await openSettings(page, {
      status: { connected: false },
      connect: connectedStatus(),
    });

    await apiKeyInput(page).fill('a-personal-api-key');
    await connectButton(page).click();

    await expect(page.getByText('Connected', { exact: true })).toBeVisible({ timeout: 15000 });
    // The form is replaced wholesale, so the field — and the key in it — is gone.
    await expect(apiKeyInput(page)).toHaveCount(0);
  });

  test('Enter submits the key, like the button does', async ({ page }) => {
    const rm = await openSettings(page, {
      status: { connected: false },
      connect: connectedStatus(),
    });

    await apiKeyInput(page).fill('typed-then-entered');
    await apiKeyInput(page).press('Enter');

    await expect(page.getByText('Connected', { exact: true })).toBeVisible({ timeout: 15000 });
    expect(rm.callCount('connect')).toBe(1);
  });

  test('a rejected key reports the reason and links nothing', async ({ page }) => {
    await openSettings(page, {
      status: { connected: false },
      connect: { error: 'invalid-key', reason: 'Redmine rejected that API key.' },
    });

    await apiKeyInput(page).fill('not-a-real-key');
    await connectButton(page).click();

    await expect(page.getByRole('alert')).toContainText('Redmine rejected that API key.');
    await expect(page.getByText('Connected', { exact: true })).toHaveCount(0);
    await expect(apiKeyInput(page)).toBeVisible();
  });

  test('unlinks, and the key form comes back', async ({ page }) => {
    let connected = true;
    const rm = await openSettings(page, {
      status: () => (connected ? connectedStatus() : { connected: false }),
      disconnect: () => {
        connected = false;
        return { connected: false };
      },
    });

    await page.getByRole('button', { name: 'Disconnect' }).click();

    await expect(apiKeyInput(page)).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Connected', { exact: true })).toHaveCount(0);
    expect(rm.callCount('disconnect')).toBe(1);
  });

  test.describe('custom Redmine URL (REDMINE_ALLOW_CUSTOM_URL)', () => {
    const baseUrlInput = (page: Page) => page.getByLabel('Redmine URL');
    const unlinkedWithCustomUrl = {
      connected: false,
      customUrlAllowed: true,
      defaultBaseUrl: BASE_URL,
    };

    test('stays hidden unless the server allows it', async ({ page }) => {
      await openSettings(page, { status: { connected: false, customUrlAllowed: false } });

      await expect(apiKeyInput(page)).toBeVisible();
      await expect(baseUrlInput(page)).toHaveCount(0);
    });

    test('starts from the server default and sends the URL typed', async ({ page }) => {
      const rm = await openSettings(page, {
        status: unlinkedWithCustomUrl,
        connect: connectedStatus(),
      });

      await expect(baseUrlInput(page)).toHaveValue(BASE_URL);
      await apiKeyInput(page).fill('a-test-instance-key');
      await baseUrlInput(page).fill('http://redmine-test.local:8080');
      await connectButton(page).click();

      await expect(page.getByText('Connected', { exact: true })).toBeVisible({ timeout: 15000 });
      expect(rm.calls('connect')[0]).toEqual({
        apiKey: 'a-test-instance-key',
        baseUrl: 'http://redmine-test.local:8080',
      });
    });

    test('is locked to the default while clocked in', async ({ page }) => {
      // An open shift on a team other than the selected one, so the live DDP
      // feed (which only clears the selected team's event) leaves it standing.
      await page.route('**/api/clock_activeForUser', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            result: {
              id: 'e2e-open-shift',
              userId: 'e2e',
              teamId: 'e2e-other-team',
              startTime: Date.now(),
              accumulatedTime: 0,
            },
          }),
        }),
      );
      const rm = await openSettings(page, {
        status: unlinkedWithCustomUrl,
        connect: connectedStatus(),
      });

      await expect(baseUrlInput(page)).toBeDisabled();
      await expect(baseUrlInput(page)).toHaveValue(BASE_URL);
      await expect(
        page.getByText('Clock out to connect to a different Redmine instance.'),
      ).toBeVisible();

      await apiKeyInput(page).fill('a-personal-api-key');
      await connectButton(page).click();

      await expect(page.getByText('Connected', { exact: true })).toBeVisible({ timeout: 15000 });
      // No URL sent: the server keeps its default rather than being asked to switch.
      expect(rm.calls('connect')[0]).toEqual({ apiKey: 'a-personal-api-key' });
    });
  });
});
