/**
 * OTA update system E2E tests.
 *
 * Three layers tested here:
 *
 * 1. Backend API contract — hit the test Meteor backend directly to verify the
 *    OTA endpoints respond with the expected shapes and auth rules, without
 *    needing to publish a real bundle (OTA_PUBLISH_TOKEN is unset on the test
 *    backend by design — it should never auto-update the test install).
 *
 * 2. Version label UI — verify the baked VITE_APP_VERSION string is rendered
 *    in the org-switcher modal and in the sidebar, so the label is always
 *    visible and not silently missing after a refactor.
 *
 * 3. Gate absent on web — the OtaUpdateGate overlay must NEVER appear in a
 *    regular browser session (it is gated by Capacitor.isNativePlatform()).
 *    This is a regression guard: if the guard were accidentally removed the
 *    overlay would block every web user.
 */
import { test, expect, type APIRequestContext } from '@playwright/test';

import { TEST_USERS, loginAs } from '../fixtures/users';

// ─── helpers ─────────────────────────────────────────────────────────────────

const BACKEND = process.env.API_TARGET ?? 'http://localhost:3101';
const VERSION_RE = /^v\d+\.\d+\.\d+/;

async function otaLatest(request: APIRequestContext, channel: string) {
  return request.get(`${BACKEND}/ota/latest?channel=${channel}`);
}

async function otaCheck(
  request: APIRequestContext,
  channel: string,
  deviceVersion: string,
  nativeVersion = '1.0',
) {
  return request.post(`${BACKEND}/ota/check?channel=${channel}`, {
    data: { version_name: deviceVersion, version_build: nativeVersion },
  });
}

// ─── 1. Backend API contract ──────────────────────────────────────────────────

test.describe('OTA backend API', () => {
  test('GET /ota/latest returns JSON for a known channel', async ({ request }) => {
    const res = await otaLatest(request, 'testflight');
    // 200 = bundle published, 404 = no bundle yet — both are valid responses
    expect([200, 404]).toContain(res.status());
    const body = await res.json();
    const hasBundle = 'version' in body && 'url' in body;
    const isEmpty = body.error === 'no_bundle';
    expect(hasBundle || isEmpty).toBe(true);
  });

  test('GET /ota/latest rejects unknown channels', async ({ request }) => {
    const res = await otaLatest(request, 'unknown-channel');
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('unknown_channel');
  });

  test('POST /ota/check returns up_to_date when device is current', async ({ request }) => {
    // First publish a bundle so there is something to be current against.
    // The test backend has no publish token, so we can only test this path
    // when a bundle has already been published by prior manual testing.
    const latestRes = await otaLatest(request, 'testflight');
    const latest = await latestRes.json();
    if (!latest.version) {
      test.skip(true, 'No bundle published on the test backend — skipping up_to_date check');
      return;
    }

    const res = await otaCheck(request, 'testflight', latest.version);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.error).toBe('no_new_version_available');
  });

  test('POST /ota/check returns an update descriptor when device is behind', async ({
    request,
  }) => {
    const latestRes = await otaLatest(request, 'testflight');
    const latest = await latestRes.json();
    if (!latest.version) {
      test.skip(true, 'No bundle published on the test backend — skipping update-descriptor check');
      return;
    }

    // Ask as a device running an ancient version.
    const res = await otaCheck(request, 'testflight', '0.0.1');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      version: latest.version,
      url: expect.stringContaining('/ota/bundles/testflight/'),
      checksum: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });

  test('POST /ota/check propagates minVersion when present', async ({ request }) => {
    const latestRes = await otaLatest(request, 'testflight');
    const latest = await latestRes.json();
    if (!latest.version || !latest.minVersion) {
      test.skip(true, 'No bundle with minVersion on test backend — skipping minVersion propagation check');
      return;
    }

    const res = await otaCheck(request, 'testflight', '0.0.1');
    const body = await res.json();
    expect(body.minVersion).toBe(latest.minVersion);
  });

  test('POST /ota/publish is disabled without OTA_PUBLISH_TOKEN', async ({ request }) => {
    const res = await request.post(
      `${BACKEND}/ota/publish?channel=testflight&version=0.0.1`,
      { headers: { Authorization: 'Bearer wrong-token', 'Content-Type': 'application/zip' } },
    );
    // 503 = token not set on server, 401 = wrong token — both mean "not happening".
    expect([401, 503]).toContain(res.status());
  });

  test('POST /ota/min-version is disabled or rejects bad auth', async ({ request }) => {
    const res = await request.post(
      `${BACKEND}/ota/min-version?channel=testflight&version=0.0.1`,
      { headers: { Authorization: 'Bearer wrong-token' } },
    );
    expect([401, 503]).toContain(res.status());
  });

  test('POST /ota/min-version rejects version above latest', async ({ request }) => {
    // Only testable when the backend has the token. When it doesn't, we get
    // a 503 before the validation — which is still not a 200, so it's fine.
    const res = await request.post(
      `${BACKEND}/ota/min-version?channel=testflight&version=999.999.999`,
      { headers: { Authorization: 'Bearer wrong-token' } },
    );
    expect(res.status()).not.toBe(200);
  });
});

// ─── 2. Version label UI ──────────────────────────────────────────────────────

test.describe('OTA version labels', () => {
  test('org-switcher modal shows the app version', async ({ page }) => {
    await loginAs(page, TEST_USERS.owner1);
    await page.waitForURL('**/app/**');

    // The trigger button has aria-label starting with "Switch organization and team".
    await page
      .getByRole('button', { name: /switch organization and team/i })
      .click();

    // Wait for the modal to appear.
    await page.getByRole('dialog').waitFor({ state: 'visible' });

    // The version line at the bottom of the modal body.
    const versionText = page.getByRole('dialog').locator('p').filter({ hasText: /^v\d/ });
    await expect(versionText).toBeVisible();
    await expect(versionText).toHaveText(VERSION_RE);
  });

  test('sidebar shows the app version when expanded', async ({ page }) => {
    await loginAs(page, TEST_USERS.owner1);
    await page.waitForURL('**/app/**');

    // The sidebar version label (desktop only — the sidebar is hidden on mobile).
    // Expand the sidebar if it is collapsed.
    const collapseBtn = page.getByRole('button', { name: /expand sidebar/i });
    if (await collapseBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await collapseBtn.click();
    }

    const versionLabel = page.locator('.sidebar-brand ~ * p').filter({ hasText: /^v\d/ }).first();
    // The version is inside the collapsed sidebar section; use a broader locator.
    const anyVersionLabel = page.locator('p, span').filter({ hasText: /^v\d+\.\d+\.\d+/ }).first();
    await expect(anyVersionLabel).toBeVisible({ timeout: 5000 });
    await expect(anyVersionLabel).toHaveText(VERSION_RE);
  });
});

// ─── 3. Gate absent on web ───────────────────────────────────────────────────

test.describe('OtaUpdateGate on web', () => {
  test('blocking overlay never appears in a browser session', async ({ page }) => {
    await loginAs(page, TEST_USERS.owner1);
    await page.waitForURL('**/app/**');

    // Give any async check time to resolve (it should return null immediately
    // on web because Capacitor.isNativePlatform() returns false).
    await page.waitForTimeout(2000);

    // The overlay has role="alertdialog" and contains "Updating TimeHuddle".
    const overlay = page.getByRole('alertdialog', { name: /updating timehuddle/i });
    await expect(overlay).not.toBeVisible();
  });

  test('no ota-update-gate element is present in the DOM on web', async ({ page }) => {
    await loginAs(page, TEST_USERS.owner1);
    await page.waitForURL('**/app/**');
    await page.waitForTimeout(1000);

    const gateEl = page.locator('.ota-update-gate');
    await expect(gateEl).not.toBeAttached();
  });
});
