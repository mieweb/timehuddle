/**
 * Notification Deep-Link E2E
 *
 * Verifies that push notification payloads contain the correct deep-link URLs
 * and that navigating to those URLs lands on the expected page/tab:
 *
 *  1. clock-in admin notification  → url is /app/profile/:memberId?tab=work
 *  2. clock-out admin notification → url is /app/profile/:memberId?tab=work
 *  3. clock-out-self notification  → url is /app/profile/:userId?tab=work
 *  4. Navigating to /app/profile/:userId?tab=work opens the Work tab, not Feed
 *  5. Navigating to /app/profile/:userId (no tab param) opens the Feed tab (default)
 *
 * Setup: Alice (admin) + Bob (member) in a shared team.
 * Bob performs clock actions; Alice's notifications are asserted after each.
 */

import { expect, test, type Page } from '@playwright/test';

const BOB_EMAIL = 'bob@example.com';
const BOB_PASSWORD = 'Password1!';
const ALICE_EMAIL = 'alice@example.com';
const ALICE_PASSWORD = 'Password1!';
// Bob's userId is stable — seeded once and never changes (matches shift-reminder.spec.ts)
const BOB_USER_ID = '69f4f84156731a5f77a8a8a4';
const API_BASE = 'http://localhost:4000/v1';

type Notification = {
  id: string;
  title: string;
  body: string;
  read: boolean;
  data?: Record<string, unknown>;
};

// ─── Auth helpers ──────────────────────────────────────────────────────────────

async function loginAs(page: Page, email: string, password: string) {
  const res = await page.request.post(`http://localhost:4000/api/auth/sign-in/email`, {
    data: { email, password },
  });
  if (!res.ok()) {
    throw new Error(`Login failed for ${email}: ${res.status()} ${await res.text()}`);
  }
}

// ─── Notification helpers ──────────────────────────────────────────────────────

async function getNotifications(page: Page): Promise<Notification[]> {
  const res = await page.request.get(`${API_BASE}/notifications`);
  if (!res.ok()) throw new Error(`getNotifications failed: ${res.status()}`);
  const body = (await res.json()) as { notifications: Notification[] };
  return body.notifications ?? [];
}

async function clearNotifications(page: Page): Promise<void> {
  const notifications = await getNotifications(page);
  if (!notifications.length) return;
  await page.request.delete(`${API_BASE}/notifications`, {
    data: { ids: notifications.map((n) => n.id) },
  });
}

/** Wait up to 10 s for a notification matching the predicate to appear. */
async function waitForNotification(
  page: Page,
  predicate: (n: Notification) => boolean,
  timeoutMs = 10000,
): Promise<Notification> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const notifications = await getNotifications(page);
    const match = notifications.find(predicate);
    if (match) return match;
    await page.waitForTimeout(500);
  }
  throw new Error('waitForNotification: timed out');
}

// ─── Team helpers ──────────────────────────────────────────────────────────────

async function setupTestTeam(
  alicePage: Page,
  bobPage: Page,
): Promise<{ teamId: string; teamName: string }> {
  const teamName = `E2E DeepLink ${Date.now()}`;
  const createRes = await alicePage.request.post(`${API_BASE}/teams`, {
    data: { name: teamName },
  });
  if (!createRes.ok()) throw new Error(`Team creation failed: ${createRes.status()}`);
  const { team } = (await createRes.json()) as { team: { id: string; code: string } };

  const joinRes = await bobPage.request.post(`${API_BASE}/teams/join`, {
    data: { teamCode: team.code },
  });
  if (!joinRes.ok()) throw new Error(`Bob join failed: ${joinRes.status()}`);

  return { teamId: team.id, teamName };
}

async function teardownTestTeam(alicePage: Page, teamId: string): Promise<void> {
  await alicePage.request.delete(`${API_BASE}/teams/${teamId}`).catch(() => {});
}

// ─── Clock helpers ─────────────────────────────────────────────────────────────

async function clockIn(
  page: Page,
  teamId: string,
): Promise<{ eventId: string }> {
  const res = await page.request.post(`${API_BASE}/clock/start`, {
    data: { teamId },
  });
  if (!res.ok()) throw new Error(`Clock in failed: ${res.status()} ${await res.text()}`);
  const body = (await res.json()) as { event: { id: string } };
  return { eventId: body.event.id };
}

async function clockOut(page: Page, teamId: string): Promise<void> {
  const res = await page.request.post(`${API_BASE}/clock/stop`, {
    data: { teamId },
  });
  if (!res.ok()) throw new Error(`Clock out failed: ${res.status()} ${await res.text()}`);
}

async function ensureClockedOut(page: Page, teamId: string): Promise<void> {
  const res = await page.request.get(`${API_BASE}/clock/active`);
  const { event } = (await res.json()) as { event: { teamId: string } | null };
  if (!event) return;
  await page.request.post(`${API_BASE}/clock/stop`, { data: { teamId: event.teamId } });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe('Notification deep-links', () => {
  test.setTimeout(60000);

  let alicePage: Page;
  let bobPage: Page;
  let teamId: string;

  test.beforeAll(async ({ browser }) => {
    // Two independent browser contexts — one per user
    alicePage = await (await browser.newContext()).newPage();
    bobPage = await (await browser.newContext()).newPage();

    // Log both users in via the API (sets session cookie on request context)
    await Promise.all([
      loginAs(alicePage, ALICE_EMAIL, ALICE_PASSWORD),
      loginAs(bobPage, BOB_EMAIL, BOB_PASSWORD),
    ]);

    // Create shared team
    ({ teamId } = await setupTestTeam(alicePage, bobPage));
  });

  test.afterAll(async () => {
    await teardownTestTeam(alicePage, teamId);
    await alicePage.context().close();
    await bobPage.context().close();
  });

  test.beforeEach(async () => {
    await clearNotifications(alicePage);
    await clearNotifications(bobPage);
    await ensureClockedOut(bobPage, teamId);
  });

  // ── 1. clock-in notification URL ─────────────────────────────────────────────

  test('clock-in notification has url /app/profile/:memberId?tab=work', async () => {
    await clockIn(bobPage, teamId);

    const notif = await waitForNotification(
      alicePage,
      (n) => n.data?.type === 'clock-in' && (n.data?.userId as string) === BOB_USER_ID,
    );

    expect(notif.data?.url).toBe(`/app/profile/${BOB_USER_ID}?tab=work`);
  });

  // ── 2. clock-out notification URL ────────────────────────────────────────────

  test('clock-out admin notification has url /app/profile/:memberId?tab=work', async () => {
    await clockIn(bobPage, teamId);
    await clockOut(bobPage, teamId);

    const notif = await waitForNotification(
      alicePage,
      (n) => n.data?.type === 'clock-out' && (n.data?.userId as string) === BOB_USER_ID,
    );

    expect(notif.data?.url).toBe(`/app/profile/${BOB_USER_ID}?tab=work`);
  });

  // ── 3. clock-out-self notification URL ───────────────────────────────────────

  test('clock-out-self notification has url /app/profile/:userId?tab=work', async () => {
    await clockIn(bobPage, teamId);
    await clockOut(bobPage, teamId);

    const notif = await waitForNotification(
      bobPage,
      (n) => n.data?.type === 'clock-out-self',
    );

    expect(notif.data?.url).toBe(`/app/profile/${BOB_USER_ID}?tab=work`);
  });

  // ── 4. Navigating to ?tab=work opens Work tab ────────────────────────────────

  test('navigating to /app/profile/:userId?tab=work opens Work tab', async ({ page }) => {
    // Full UI login so the app's localStorage Bearer token is set
    await page.goto('/app');
    await page.waitForSelector('input[type="email"]', { timeout: 10000 });
    await page.fill('input[type="email"]', ALICE_EMAIL);
    await page.fill('input[type="password"]', ALICE_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL('**/dashboard', { timeout: 15000 });

    await page.goto(`/app/profile/${BOB_USER_ID}?tab=work`);

    // Work tab should be the active (selected) tab
    const workTab = page.getByRole('tab', { name: 'Work' });
    await expect(workTab).toBeVisible({ timeout: 15000 });
    await expect(workTab).toHaveAttribute('data-state', 'active');

    // Feed tab should not be active
    const feedTab = page.getByRole('tab', { name: 'Feed' });
    await expect(feedTab).toHaveAttribute('data-state', 'inactive');
  });

  // ── 5. Default (no tab param) opens Feed tab ─────────────────────────────────

  test('navigating to /app/profile/:userId without ?tab opens Feed tab by default', async ({
    page,
  }) => {
    await page.goto('/app');
    await page.waitForSelector('input[type="email"]', { timeout: 10000 });
    await page.fill('input[type="email"]', ALICE_EMAIL);
    await page.fill('input[type="password"]', ALICE_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL('**/dashboard', { timeout: 15000 });

    await page.goto(`/app/profile/${BOB_USER_ID}`);

    const feedTab = page.getByRole('tab', { name: 'Feed' });
    await expect(feedTab).toBeVisible({ timeout: 15000 });
    await expect(feedTab).toHaveAttribute('data-state', 'active');

    const workTab = page.getByRole('tab', { name: 'Work' });
    await expect(workTab).toHaveAttribute('data-state', 'inactive');
  });
});
