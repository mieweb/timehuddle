/**
 * Shift-End Reminder E2E Tests
 *
 * Tests the full shift-end reminder flow end-to-end:
 *
 *  Setup:
 *    - Login as Carol Dev (carol@example.com)
 *    - Clock in to get an active clock event
 *    - Backdating startTime via PUT /clock/:id/times (endTime: null keeps event active)
 *      to 7h 44m 30s ago — the ClockMonitorService fires every 30s, so Check B
 *      (SEVEN_HOURS_45_MIN_SECONDS = 27900) will trigger within the next tick.
 *
 *  Tests:
 *    1. Notification appears — verifies the modal shows with correct title, body,
 *       explanatory subtext, "Continue Working" button, and "Agree to Clock Out" button.
 *    2. "Continue Working" path — modal closes, notification removed, clock still active,
 *       shiftNextReminderWorkSecs is scheduled 2h out.
 *    3. "Agree to Clock Out" path — modal closes, notification removed, clock still active
 *       (monitor will handle the eventual auto-clockout at 8h), shiftReminderResponse = agreed.
 *
 *  Polling strategy: after backdating, poll GET /v1/notifications every 5s up to 90s.
 *  The monitor runs every 30s so the notification should appear within 35-65s.
 *
 *  NOTE: Carol is an admin of the "Developers" team in seed data, which means she can
 *  edit her own clock event times and will also receive admin notifications when shift
 *  reminders are ignored.
 */

import { expect, test } from '@playwright/test';

const CAROL_EMAIL = 'carol@example.com';
const CAROL_PASSWORD = 'Password1!';
const API_BASE = 'http://localhost:4000/v1';

// 7h 44m 30s — next monitor tick (≤30s) pushes workSeconds past 7h 45m = 27900s
const BACKDATE_SECS = 7 * 3600 + 44 * 60 + 30;
const POLL_INTERVAL_MS = 5000;
const POLL_MAX_ATTEMPTS = 18; // 18 × 5s = 90s timeout

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Login and return the session Bearer token from localStorage. */
async function login(page: import('@playwright/test').Page): Promise<string> {
  await page.goto('/app');
  await page.waitForSelector('input[type="email"]', { timeout: 10000 });
  await page.fill('input[type="email"]', CAROL_EMAIL);
  await page.fill('input[type="password"]', CAROL_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/dashboard', { timeout: 15000 });
  // The frontend stores the better-auth Bearer token in localStorage
  const token = await page.evaluate(() => localStorage.getItem('timecore_session_token'));
  return token ?? '';
}

function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function ensureClockedOut(
  page: import('@playwright/test').Page,
  token: string,
) {
  const res = await page.request.get(`${API_BASE}/clock/active`, {
    headers: authHeaders(token),
  });
  const body = (await res.json()) as { event: { teamId: string } | null };
  if (!body.event) return;
  await page.request.post(`${API_BASE}/clock/stop`, {
    headers: authHeaders(token),
    data: { teamId: body.event.teamId },
  });
}

/** Delete any leftover shift-end-reminder notifications from prior test runs. */
async function clearShiftReminderNotifications(
  page: import('@playwright/test').Page,
  token: string,
) {
  const res = await page.request.get(`${API_BASE}/notifications`, {
    headers: authHeaders(token),
  });
  const { notifications } = (await res.json()) as {
    notifications: Array<{ id: string; data?: Record<string, unknown> }>;
  };
  const ids = notifications
    .filter((n) => n.data?.type === 'shift-end-reminder')
    .map((n) => n.id);
  if (ids.length === 0) return;
  await page.request.delete(`${API_BASE}/notifications`, {
    headers: authHeaders(token),
    data: { ids },
  });
}

async function clockIn(
  page: import('@playwright/test').Page,
  token: string,
): Promise<{ eventId: string; teamId: string }> {
  const teamsRes = await page.request.get(`${API_BASE}/teams`, {
    headers: authHeaders(token),
  });
  const { teams } = (await teamsRes.json()) as { teams: { id: string }[] };
  const teamId = teams[0].id;
  const startRes = await page.request.post(`${API_BASE}/clock/start`, {
    headers: authHeaders(token),
    data: { teamId },
  });
  const { event } = (await startRes.json()) as { event: { id: string } };
  return { eventId: event.id, teamId };
}

/** Backdate the clock event's startTime while keeping it active (endTime: null). */
async function backdateEvent(
  page: import('@playwright/test').Page,
  token: string,
  eventId: string,
  backdateSecs: number,
) {
  const res = await page.request.put(`${API_BASE}/clock/${eventId}/times`, {
    headers: authHeaders(token),
    data: {
      startTime: Date.now() - backdateSecs * 1000,
      endTime: null,
    },
  });
  expect(res.ok(), `backdateEvent failed: ${await res.text()}`).toBe(true);
}

/** Poll notifications until a shift-end-reminder appears or timeout. */
async function waitForShiftReminder(
  page: import('@playwright/test').Page,
  token: string,
): Promise<boolean> {
  for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
    await page.waitForTimeout(POLL_INTERVAL_MS);
    const res = await page.request.get(`${API_BASE}/notifications`, {
      headers: authHeaders(token),
    });
    const { notifications } = (await res.json()) as {
      notifications: Array<{ data?: Record<string, unknown> }>;
    };
    if (notifications.some((n) => n.data?.type === 'shift-end-reminder')) return true;
  }
  return false;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe('Shift-End Reminder', () => {
  test.describe.configure({ mode: 'serial' });

  // 3 min: up to 90s polling + UI interaction + buffer
  test.setTimeout(180_000);

  let authToken = '';

  test.beforeEach(async ({ page }) => {
    authToken = await login(page);
    await ensureClockedOut(page, authToken);
    await clearShiftReminderNotifications(page, authToken);
  });

  test.afterEach(async ({ page }) => {
    await ensureClockedOut(page, authToken);
  });

  // ── Test 1: notification appears + modal content ───────────────────────────

  test('shift-end reminder notification appears within 90s of reaching 7h 45m', async ({
    page,
  }) => {
    // Clock in and backdate to just before the 7h 45m threshold
    const { eventId } = await clockIn(page, authToken);
    await backdateEvent(page, authToken, eventId, BACKDATE_SECS);

    // Navigate to notifications page while we poll
    await page.goto('/app/notifications');

    // Wait for the monitor to fire
    const found = await waitForShiftReminder(page, authToken);
    expect(found, 'shift-end-reminder notification should appear within 90s').toBe(true);

    // Reload to pick up the new notification
    await page.reload();

    // ── Notification row ───────────────────────────────────────────────────
    const notifRow = page.getByRole('button', { name: /Shift End Reminder/ }).first();
    await expect(notifRow).toBeVisible({ timeout: 10000 });
    await expect(notifRow).toContainText('You have worked 7 hours 45 minutes');

    // ── Click to open modal ────────────────────────────────────────────────
    await notifRow.click();

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Title
    await expect(dialog.getByRole('heading', { name: 'Shift End Reminder' })).toBeVisible();

    // Body — the notification message
    await expect(
      dialog.getByText('You have worked 7 hours 45 minutes'),
    ).toBeVisible();

    // Explanatory sub-text
    await expect(
      dialog.getByText(/Agreeing will automatically clock you out when you reach 8 hours/),
    ).toBeVisible();
    await expect(dialog.getByText(/another reminder in 2 hours/)).toBeVisible();

    // Both action buttons (scoped to dialog to avoid matching notification row text)
    await expect(
      dialog.getByRole('button', { name: /Continue Working/i }),
    ).toBeVisible();
    await expect(
      dialog.getByRole('button', { name: /Agree to.*clock out/i }),
    ).toBeVisible();

    // Close button in modal header
    await expect(dialog.getByRole('button', { name: /close/i })).toBeVisible();
  });

  // ── Test 2: "Continue Working" (disagree) path ────────────────────────────

  test('"Continue Working" closes modal, removes notification, schedules 2h reminder', async ({
    page,
  }) => {
    const { eventId } = await clockIn(page, authToken);
    await backdateEvent(page, authToken, eventId, BACKDATE_SECS);

    await page.goto('/app/notifications');
    const found = await waitForShiftReminder(page, authToken);
    expect(found, 'shift-end-reminder notification should appear within 90s').toBe(true);

    await page.reload();

    // Open modal
    await page.getByRole('button', { name: /Shift End Reminder/ }).first().click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Click "Continue Working"
    await dialog.getByRole('button', { name: /Continue Working/i }).click();

    // Modal should close
    await expect(dialog).not.toBeVisible({ timeout: 8000 });

    // Notification removed from list
    await expect(
      page.getByRole('button', { name: /Shift End Reminder/ }),
    ).not.toBeVisible({ timeout: 5000 });

    // ── Verify backend state ───────────────────────────────────────────────
    const clockRes = await page.request.get(`${API_BASE}/clock/active`, {
      headers: authHeaders(authToken),
    });
    const { event } = (await clockRes.json()) as {
      event: {
        id: string;
        workSeconds: number;
        shiftReminderResponse?: string;
        shiftNextReminderWorkSecs?: number | null;
        shiftAutoClockoutWorkSecs?: number | null;
      } | null;
    };

    // Clock session still active (not clocked out)
    expect(event, 'clock session should still be active after Continue Working').not.toBeNull();
    expect(event!.id).toBe(eventId);

    // Response recorded as disagreed
    expect(event!.shiftReminderResponse).toBe('disagreed');

    // Auto-clockout threshold cleared
    expect(event!.shiftAutoClockoutWorkSecs).toBeNull();

    // Next reminder scheduled ~2h out from current work time
    expect(event!.shiftNextReminderWorkSecs).toBeGreaterThan(0);
    // Should be roughly currentWorkSecs + 2h (7200s); we know work is ~7h45m = 27900s
    const expectedMin = 27900 + 7200 - 120; // slight tolerance
    expect(event!.shiftNextReminderWorkSecs).toBeGreaterThan(expectedMin);
  });

  // ── Test 3: "Agree to Clock Out" path ────────────────────────────────────

  test('"Agree to Clock Out" closes modal, removes notification, records agreed response', async ({
    page,
  }) => {
    const { eventId } = await clockIn(page, authToken);
    await backdateEvent(page, authToken, eventId, BACKDATE_SECS);

    await page.goto('/app/notifications');
    const found = await waitForShiftReminder(page, authToken);
    expect(found, 'shift-end-reminder notification should appear within 90s').toBe(true);

    await page.reload();

    // Open modal
    await page.getByRole('button', { name: /Shift End Reminder/ }).first().click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Click "Agree to Clock Out"
    await dialog.getByRole('button', { name: /Agree to.*clock out/i }).click();

    // Modal should close
    await expect(dialog).not.toBeVisible({ timeout: 8000 });

    // Notification removed from list
    await expect(
      page.getByRole('button', { name: /Shift End Reminder/ }),
    ).not.toBeVisible({ timeout: 5000 });

    // ── Verify backend state ───────────────────────────────────────────────
    const clockRes = await page.request.get(`${API_BASE}/clock/active`, {
      headers: authHeaders(authToken),
    });
    const { event } = (await clockRes.json()) as {
      event: {
        id: string;
        shiftReminderResponse?: string;
        shiftAutoClockoutWorkSecs?: number | null;
      } | null;
    };

    // Session still active — monitor handles the eventual clockout at 8h
    expect(event, 'clock session should still be active — monitor clocks out at 8h').not.toBeNull();
    expect(event!.id).toBe(eventId);

    // Response recorded as agreed
    expect(event!.shiftReminderResponse).toBe('agreed');

    // Auto-clockout threshold still armed at 28800 (8h)
    expect(event!.shiftAutoClockoutWorkSecs).toBe(28800);
  });
});
