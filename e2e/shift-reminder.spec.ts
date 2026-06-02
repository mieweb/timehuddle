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
// Alice is a co-admin of Carol's "Developers" team in seed data
const ALICE_EMAIL = 'alice@example.com';
const ALICE_PASSWORD = 'Password1!';
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
  if (!token) throw new Error('Expected timecore_session_token in localStorage after login');
  return token;
}

function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}` };
}

/**
 * Login via the better-auth API directly using native fetch (NOT page.request).
 *
 * IMPORTANT: Do NOT use page.request here. page.request shares the browser's
 * cookie jar, so signing in as Alice would set Alice's session cookie in the
 * browser. That contaminated cookie would then override Carol's Bearer-token
 * auth on subsequent requests made by the app (e.g. /v1/me on page load),
 * causing useSession() to return null and breaking the ShiftReminderContext WS.
 *
 * Using the Node.js global fetch keeps the HTTP request completely isolated
 * from the browser's storage state.
 */
async function loginViaApi(
  _page: import('@playwright/test').Page,
  email: string,
  password: string,
): Promise<string> {
  const res = await fetch('http://localhost:4000/api/auth/sign-in/email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // better-auth's CSRF protection requires a trusted Origin header.
      // Browser requests include this automatically; Node.js fetch does not.
      Origin: 'http://localhost:3000',
    },
    body: JSON.stringify({ email, password }),
  });
  const body = (await res.json()) as { token?: string };
  if (!res.ok || !body.token) throw new Error(`loginViaApi failed for ${email}: ${res.status}`);
  return body.token;
}

async function ensureClockedOut(page: import('@playwright/test').Page, token: string) {
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

/** Delete leftover shift-end-reminder and auto-clock-out notifications from prior runs. */
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
    .filter((n) => n.data?.type === 'shift-end-reminder' || n.data?.type === 'auto-clock-out')
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
  teamId?: string,
): Promise<{ eventId: string; teamId: string }> {
  if (!teamId) {
    const teamsRes = await page.request.get(`${API_BASE}/teams`, {
      headers: authHeaders(token),
    });
    const { teams } = (await teamsRes.json()) as { teams: { id: string }[] };
    teamId = teams[0].id;
  }
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
    await expect(dialog.getByText('You have worked 7 hours 45 minutes')).toBeVisible();

    // Explanatory sub-text
    await expect(
      dialog.getByText(/Agreeing will automatically clock you out when you reach 8 hours/),
    ).toBeVisible();
    await expect(dialog.getByText(/another reminder in 2 hours/)).toBeVisible();

    // Both action buttons (scoped to dialog to avoid matching notification row text)
    await expect(dialog.getByRole('button', { name: /Continue Working/i })).toBeVisible();
    await expect(dialog.getByRole('button', { name: /Agree to.*clock out/i })).toBeVisible();

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
    await page
      .getByRole('button', { name: /Shift End Reminder/ })
      .first()
      .click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Click "Continue Working"
    await dialog.getByRole('button', { name: /Continue Working/i }).click();

    // Modal should close
    await expect(dialog).not.toBeVisible({ timeout: 8000 });

    // Notification removed from list
    await expect(page.getByRole('button', { name: /Shift End Reminder/ })).not.toBeVisible({
      timeout: 5000,
    });

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
    await page
      .getByRole('button', { name: /Shift End Reminder/ })
      .first()
      .click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Click "Agree to Clock Out"
    await dialog.getByRole('button', { name: /Agree to.*clock out/i }).click();

    // Modal should close
    await expect(dialog).not.toBeVisible({ timeout: 8000 });

    // Notification removed from list
    await expect(page.getByRole('button', { name: /Shift End Reminder/ })).not.toBeVisible({
      timeout: 5000,
    });

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

  // ── Test 4: agree → monitor auto-clocks out + sends "Auto Clocked Out" notification ───

  test('"Agree to Clock Out" triggers auto-clockout at 8h and sends Auto Clocked Out notification', async ({
    page,
  }) => {
    test.setTimeout(240_000);

    // Clock in and backdate to just before 7h 45m to trigger reminder
    const { eventId } = await clockIn(page, authToken);
    await backdateEvent(page, authToken, eventId, BACKDATE_SECS);

    await page.goto('/app/notifications');
    const found = await waitForShiftReminder(page, authToken);
    expect(found, 'shift-end-reminder notification should appear within 90s').toBe(true);

    await page.reload();

    // Open modal and agree
    await page
      .getByRole('button', { name: /Shift End Reminder/ })
      .first()
      .click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await dialog.getByRole('button', { name: /Agree to.*clock out/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 8000 });

    // Verify agreed state
    const clockRes1 = await page.request.get(`${API_BASE}/clock/active`, {
      headers: authHeaders(authToken),
    });
    const { event: agreedEvent } = (await clockRes1.json()) as {
      event: {
        id: string;
        shiftReminderResponse?: string;
        shiftAutoClockoutWorkSecs?: number | null;
      } | null;
    };
    expect(agreedEvent, 'event should still be active after agreeing').not.toBeNull();
    expect(agreedEvent!.shiftReminderResponse).toBe('agreed');
    expect(agreedEvent!.shiftAutoClockoutWorkSecs).toBe(28800);

    // Backdate to 8h 01m so monitor fires Check C (workSeconds ≥ shiftAutoClockoutWorkSecs)
    await backdateEvent(page, authToken, eventId, 8 * 3600 + 60);

    // Poll up to 60s for the auto-clockout + "Auto Clocked Out" notification
    let autoClockedOut = false;
    let autoNotifBody = '';
    for (let i = 0; i < 12; i++) {
      await page.waitForTimeout(5000);

      const [clockPollRes, notifPollRes] = await Promise.all([
        page.request.get(`${API_BASE}/clock/active`, { headers: authHeaders(authToken) }),
        page.request.get(`${API_BASE}/notifications`, { headers: authHeaders(authToken) }),
      ]);
      const { event: pollEvent } = (await clockPollRes.json()) as {
        event: { id: string } | null;
      };
      const { notifications } = (await notifPollRes.json()) as {
        notifications: Array<{
          id: string;
          title: string;
          body: string;
          data?: Record<string, unknown>;
        }>;
      };

      const autoNotif = notifications.find((n) => n.data?.type === 'auto-clock-out');
      if (!pollEvent && autoNotif) {
        autoClockedOut = true;
        autoNotifBody = autoNotif.body;
        break;
      }
    }

    expect(autoClockedOut, 'monitor should auto-clock-out and send notification within 60s').toBe(
      true,
    );

    // Notification body should acknowledge the user agreed
    expect(autoNotifBody).toContain('automatically clocked out as you agreed');

    // ── Verify in UI ───────────────────────────────────────────────────────
    await page.reload();

    const autoNotifRow = page.getByRole('button', { name: /Auto Clocked Out/ }).first();
    await expect(autoNotifRow).toBeVisible({ timeout: 5000 });
    await expect(autoNotifRow).toContainText('automatically clocked out as you agreed');

    // No lingering shift-end-reminder in the list
    await expect(page.getByRole('button', { name: /Shift End Reminder/ })).not.toBeVisible({
      timeout: 3000,
    });
  });

  // ── Test 5: global modal — appears on dashboard (not just notifications page) ──

  test('shift-end reminder modal pops up automatically on dashboard via global WebSocket', async ({
    page,
  }) => {
    const { eventId } = await clockIn(page, authToken);
    await backdateEvent(page, authToken, eventId, BACKDATE_SECS);

    // Navigate to the dashboard — NOT the notifications page.
    // The global ShiftReminderProvider opens a WebSocket stream that auto-opens
    // the modal on any page when a shift-end-reminder arrives.
    await page.goto('/app/dashboard');

    // The modal should pop up automatically within 90s (monitor fires every 30s)
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 90_000 });

    // Verify it is the shift reminder modal
    await expect(dialog.getByRole('heading', { name: 'Shift End Reminder' })).toBeVisible();
    await expect(dialog.getByText(/You have worked 7 hours 45 minutes/)).toBeVisible();
    await expect(dialog.getByText(/Agreeing will automatically clock you out/)).toBeVisible();
    await expect(dialog.getByRole('button', { name: /Continue Working/i })).toBeVisible();
    await expect(dialog.getByRole('button', { name: /Agree to.*clock out/i })).toBeVisible();

    // Dismiss via "Continue Working" — we never navigated to notifications
    await dialog.getByRole('button', { name: /Continue Working/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 8000 });

    // Confirm the user remained on the dashboard throughout
    expect(page.url()).toContain('/app/dashboard');
  });

  // ── Test 6: "Continue Working" DISARMS auto-clockout — stays active past 8h ──

  test('"Continue Working" disarms auto-clockout — session stays active past 8 hours', async ({
    page,
  }) => {
    test.setTimeout(240_000);

    const { eventId } = await clockIn(page, authToken);
    await backdateEvent(page, authToken, eventId, BACKDATE_SECS);

    await page.goto('/app/notifications');
    const found = await waitForShiftReminder(page, authToken);
    expect(found, 'shift-end-reminder notification should appear within 90s').toBe(true);

    await page.reload();

    // Open modal and choose Continue Working
    await page
      .getByRole('button', { name: /Shift End Reminder/ })
      .first()
      .click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await dialog.getByRole('button', { name: /Continue Working/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 8000 });

    // Verify auto-clockout is disarmed
    const clockRes1 = await page.request.get(`${API_BASE}/clock/active`, {
      headers: authHeaders(authToken),
    });
    const { event: disagreedEvent } = (await clockRes1.json()) as {
      event: {
        id: string;
        shiftReminderResponse?: string;
        shiftAutoClockoutWorkSecs?: number | null;
        shiftNextReminderWorkSecs?: number | null;
      } | null;
    };
    expect(disagreedEvent, 'session should still be active').not.toBeNull();
    expect(disagreedEvent!.shiftReminderResponse).toBe('disagreed');
    expect(disagreedEvent!.shiftAutoClockoutWorkSecs).toBeNull(); // disarmed
    expect(disagreedEvent!.shiftNextReminderWorkSecs).toBeGreaterThan(0); // 2h repeat armed

    // Backdate past 8h — the monitor should NOT clock out
    await backdateEvent(page, authToken, eventId, 8 * 3600 + 60);

    // Poll for 45s — if the monitor fires, it must NOT clock out
    let clockedOutUnexpectedly = false;
    for (let i = 0; i < 9; i++) {
      await page.waitForTimeout(5000);
      const pollRes = await page.request.get(`${API_BASE}/clock/active`, {
        headers: authHeaders(authToken),
      });
      const { event: pollEvent } = (await pollRes.json()) as { event: { id: string } | null };
      if (!pollEvent) {
        clockedOutUnexpectedly = true;
        break;
      }
    }

    expect(
      clockedOutUnexpectedly,
      '"Continue Working" should NOT trigger auto-clockout at 8h — auto-clockout was disarmed',
    ).toBe(false);

    // Final confirmation: session is still running
    const finalRes = await page.request.get(`${API_BASE}/clock/active`, {
      headers: authHeaders(authToken),
    });
    const { event: finalEvent } = (await finalRes.json()) as {
      event: { workSeconds: number; shiftAutoClockoutWorkSecs: number | null } | null;
    };
    expect(
      finalEvent,
      'session must still be active past 8h after Continue Working',
    ).not.toBeNull();
    expect(finalEvent!.shiftAutoClockoutWorkSecs).toBeNull();
    expect(finalEvent!.workSeconds).toBeGreaterThan(28800); // past 8h
  });

  // ── Test 7: admin receives notification when user agrees and is auto-clocked out ──

  test('admin receives auto-clock-out notification when user agrees and is clocked out at 8h', async ({
    page,
  }) => {
    test.setTimeout(240_000);

    // ── Cleanup: delete any leftover test teams from prior failed runs ───────
    const carolTeamsRes = await page.request.get(`${API_BASE}/teams`, {
      headers: authHeaders(authToken),
    });
    const { teams: carolTeams } = (await carolTeamsRes.json()) as {
      teams: { id: string; name: string }[];
    };
    for (const t of carolTeams) {
      if (t.name === 'e2e-admin-notif-test') {
        await page.request.delete(`${API_BASE}/teams/${t.id}`, {
          headers: authHeaders(authToken),
        });
      }
    }

    // ── Setup: create a shared team with Alice as co-admin ──────────────────
    const createTeamRes = await page.request.post(`${API_BASE}/teams`, {
      headers: authHeaders(authToken),
      data: { name: 'e2e-admin-notif-test' },
    });
    expect(createTeamRes.ok(), 'create shared team failed').toBe(true);
    const { team: sharedTeam } = (await createTeamRes.json()) as { team: { id: string } };
    const sharedTeamId = sharedTeam.id;

    // Invite Alice directly (adds her as a member)
    const inviteRes = await page.request.post(`${API_BASE}/teams/${sharedTeamId}/invite`, {
      headers: authHeaders(authToken),
      data: { email: ALICE_EMAIL },
    });
    expect(inviteRes.ok(), 'invite Alice failed').toBe(true);

    // Find Alice's userId from the members list
    const membersRes = await page.request.get(`${API_BASE}/teams/${sharedTeamId}/members`, {
      headers: authHeaders(authToken),
    });
    const { members } = (await membersRes.json()) as {
      members: Array<{ id: string; email: string }>;
    };
    const aliceMember = members.find((m) => m.email === ALICE_EMAIL);
    expect(aliceMember, 'Alice should appear in team members').toBeTruthy();

    // Promote Alice to admin
    const roleRes = await page.request.put(
      `${API_BASE}/teams/${sharedTeamId}/members/${aliceMember!.id}/role`,
      { headers: authHeaders(authToken), data: { role: 'admin' } },
    );
    expect(roleRes.ok(), 'promote Alice to admin failed').toBe(true);

    // Clear any stale auto-clock-out-admin notifications from Alice's inbox
    const aliceToken = await loginViaApi(page, ALICE_EMAIL, ALICE_PASSWORD);
    const aliceStaleRes = await page.request.get(`${API_BASE}/notifications`, {
      headers: authHeaders(aliceToken),
    });
    const { notifications: aliceStale } = (await aliceStaleRes.json()) as {
      notifications: Array<{ id: string; data?: Record<string, unknown> }>;
    };
    const staleIds = aliceStale
      .filter((n) => n.data?.type === 'auto-clock-out-admin')
      .map((n) => n.id);
    if (staleIds.length > 0) {
      await page.request.delete(`${API_BASE}/notifications`, {
        headers: authHeaders(aliceToken),
        data: { ids: staleIds },
      });
    }

    // Clock Carol into the shared team (not her default Personal team)
    const { eventId } = await clockIn(page, authToken, sharedTeamId);
    await backdateEvent(page, authToken, eventId, BACKDATE_SECS);

    // ── Navigate to dashboard and wait for the global modal ─────────────────
    // ShiftReminderProvider opens a WebSocket on any page and auto-opens the
    // modal when a shift-end-reminder arrives — no need to click a list button.
    await page.goto('/app/dashboard');

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 90_000 });
    await expect(dialog.getByRole('heading', { name: 'Shift End Reminder' })).toBeVisible();

    // Agree to clock out via the global modal
    await dialog.getByRole('button', { name: /Agree to.*clock out/i }).click();
    await expect(dialog).not.toBeVisible({ timeout: 8000 });

    // Backdate past 8h so monitor triggers auto-clockout
    await backdateEvent(page, authToken, eventId, 8 * 3600 + 60);

    // Poll until Carol is clocked out (confirms Check C ran)
    let autoClockedOut = false;
    for (let i = 0; i < 12; i++) {
      await page.waitForTimeout(5000);
      const res = await page.request.get(`${API_BASE}/clock/active`, {
        headers: authHeaders(authToken),
      });
      const { event } = (await res.json()) as { event: unknown | null };
      if (!event) {
        autoClockedOut = true;
        break;
      }
    }
    expect(autoClockedOut, 'Carol should be auto-clocked out within 60s').toBe(true);

    // ── Verify Alice (co-admin) received an admin notification ─────────────
    // (aliceToken already obtained above for stale-notification cleanup)

    // Give the notification a moment to persist
    await page.waitForTimeout(2000);

    const aliceNotifRes = await page.request.get(`${API_BASE}/notifications`, {
      headers: authHeaders(aliceToken),
    });
    const { notifications: aliceNotifs } = (await aliceNotifRes.json()) as {
      notifications: Array<{ title: string; body: string; data?: Record<string, unknown> }>;
    };

    const adminNotif = aliceNotifs.find((n) => n.data?.type === 'auto-clock-out-admin');

    expect(
      adminNotif,
      'Alice (co-admin) should receive an auto-clock-out-admin notification',
    ).toBeTruthy();
    expect(adminNotif!.title).toBe('Auto Clocked Out');
    // Body should mention Carol agreed — NOT the "no response" wording
    expect(adminNotif!.body).toContain('Carol Dev');
    expect(adminNotif!.body).toContain('after agreeing to the shift-end reminder');
    expect(adminNotif!.body).not.toContain('no response');

    // ── Cleanup: delete the shared team ─────────────────────────────────────
    await page.request.delete(`${API_BASE}/teams/${sharedTeamId}`, {
      headers: authHeaders(authToken),
    });
  });
});
