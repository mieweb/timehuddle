/**
 * Settings → Redmine: linking an account, choosing the default activity, and
 * unlinking (plan area h).
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
  activityList,
  connectedStatus,
  stubRedmine,
  type RedmineStub,
  type StubValue,
} from '../fixtures/redmine';

const apiKeyInput = (page: Page) => page.getByLabel('Redmine API key');
const connectButton = (page: Page) => page.getByRole('button', { name: 'Connect', exact: true });

/**
 * The default-activity Select.
 *
 * Named "Default activity", not the `aria-label="Default Redmine activity"` the
 * component also sets: `@mieweb/ui`'s Select lets its `label` prop win over an
 * explicit `aria-label`, so the aria-label never reaches the accessibility
 * tree. Same trap as the org members table's role selects.
 */
const activitySelect = (page: Page) => page.getByRole('combobox', { name: 'Default activity' });

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
      'activities.list': () =>
        connected
          ? activityList()
          : { connected: false, activities: [], selectedId: null, selectedReason: 'none' },
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
      'activities.list': activityList(),
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
      'activities.list': activityList(),
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

  test('chooses a default activity and tells the server which', async ({ page }) => {
    const rm = await openSettings(page, {
      status: connectedStatus(),
      'activities.list': activityList({ selectedId: 9, selectedReason: 'is_default' }),
      'activities.setDefault': activityList({ selectedId: 10, selectedReason: 'chosen' }),
    });

    await activitySelect(page).click();
    await page.getByRole('option', { name: 'QA', exact: true }).click();

    await expect(activitySelect(page)).toHaveText('QA', { timeout: 15000 });
    expect(rm.calls('activities.setDefault')[0]).toEqual({ activityId: 10 });
  });

  test('says so when the instance has no activities at all', async ({ page }) => {
    await openSettings(page, {
      status: connectedStatus(),
      'activities.list': activityList({ activities: [], selectedId: null, selectedReason: 'none' }),
    });

    await expect(page.getByRole('alert')).toContainText('no time-entry activities configured');
    await expect(activitySelect(page)).toHaveCount(0);
  });

  test('renders the connection even when the activities fetch fails', async ({ page }) => {
    // The two are deliberately settled separately (SettingsPage.tsx:727) so a
    // failing activities call cannot blank the more important connection card.
    await openSettings(page, {
      status: connectedStatus({ login: 'priya.patel' }),
      'activities.list': { status: 500, reason: 'Redmine is unreachable' },
    });

    await expect(page.getByText('Connected', { exact: true })).toBeVisible();
    await expect(page.getByText('@priya.patel', { exact: false })).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('Redmine is unreachable');
  });

  test('unlinks, and the key form comes back', async ({ page }) => {
    let connected = true;
    const rm = await openSettings(page, {
      status: () => (connected ? connectedStatus() : { connected: false }),
      'activities.list': activityList(),
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
});
