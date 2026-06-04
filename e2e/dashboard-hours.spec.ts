/**
 * Dashboard Hours Alignment E2E
 *
 * Verifies that the dashboard "Today" and "This Week" stat cards show the same
 * work hours as the Timesheet page — i.e. break time is excluded.
 *
 * Strategy:
 *   1. Use the API to inject a completed session with a 30-minute meal break
 *      (meal breaks are deducted from accumulatedTime).
 *   2. Read the dashboard stat cards and capture their displayed values.
 *   3. Navigate to Timesheet → "Today" preset and capture "Total Hours".
 *   4. Assert dashboard Today == Timesheet Total Hours (same formatted string).
 *   5. Assert dashboard This Week == Timesheet Total Hours (same formatted string).
 *
 * Uses bob@example.com to avoid clashing with alice-based tests.
 */
import { expect, test } from '@playwright/test';

const TEST_EMAIL = 'bob@example.com';
const TEST_PASSWORD = 'Password1!';
const API_BASE = 'http://localhost:4000/v1';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function login(page: import('@playwright/test').Page) {
  await page.goto('/app');
  await page.waitForSelector('input[type="email"]', { timeout: 10000 });
  await page.fill('input[type="email"]', TEST_EMAIL);
  await page.fill('input[type="password"]', TEST_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/dashboard', { timeout: 15000 });
}

async function authHeaders(page: import('@playwright/test').Page): Promise<Record<string, string>> {
  const token = await page.evaluate(() => localStorage.getItem('timecore_session_token'));
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function ensureClockedOut(page: import('@playwright/test').Page) {
  const headers = await authHeaders(page);
  const res = await page.request.get(`${API_BASE}/clock/active`, { headers });
  const { event } = (await res.json()) as { event: { teamId: string } | null };
  if (!event) return;
  await page.request.post(`${API_BASE}/clock/stop`, {
    headers,
    data: { teamId: event.teamId },
  });
}

/** Clock in, immediately clock out, then set exact times with a break via updateTimes. */
async function injectSessionWithBreak(
  page: import('@playwright/test').Page,
  opts: {
    shiftStart: number;
    shiftEnd: number;
    breakStart: number;
    breakEnd: number;
  },
): Promise<string> {
  const headers = await authHeaders(page);

  const teamsRes = await page.request.get(`${API_BASE}/teams`, { headers });
  const { teams } = (await teamsRes.json()) as { teams: { id: string }[] };
  const teamId = teams[0].id;

  const startRes = await page.request.post(`${API_BASE}/clock/start`, {
    headers,
    data: { teamId },
  });
  const { event } = (await startRes.json()) as { event: { id: string } };
  const eventId = event.id;

  await page.request.post(`${API_BASE}/clock/stop`, { headers, data: { teamId } });

  await page.request.put(`${API_BASE}/clock/${eventId}/times`, {
    headers,
    data: {
      startTime: opts.shiftStart,
      endTime: opts.shiftEnd,
      breaks: [{ startTime: opts.breakStart, endTime: opts.breakEnd }],
    },
  });

  return eventId;
}

async function deleteSession(page: import('@playwright/test').Page, eventId: string) {
  const headers = await authHeaders(page);
  await page.request.delete(`${API_BASE}/clock/${eventId}`, { headers });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe('Dashboard hours exclude break time', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(60000);

  let injectedEventId: string;

  test.beforeEach(async ({ page }) => {
    await login(page);
    await ensureClockedOut(page);
  });

  test.afterEach(async ({ page }) => {
    await ensureClockedOut(page);
    if (injectedEventId) {
      await deleteSession(page, injectedEventId);
      injectedEventId = '';
    }
  });

  test('dashboard Today matches timesheet Total Hours (break excluded)', async ({ page }) => {
    // Inject a 2-hour shift with a 30-minute meal break today → 1h 30m work
    const now = Date.now();
    const shiftStart = now - 2 * 60 * 60 * 1000; // 2h ago
    const shiftEnd = now - 1; // just ended
    const breakStart = shiftStart + 30 * 60 * 1000; // 30 min into shift
    const breakEnd = breakStart + 30 * 60 * 1000; // 30-min break → meal, deducted

    injectedEventId = await injectSessionWithBreak(page, {
      shiftStart,
      shiftEnd,
      breakStart,
      breakEnd,
    });

    // ── Dashboard ──
    await page.goto('/app/dashboard');
    await page.waitForSelector('[data-testid="stat-today"]', { timeout: 15000 });

    const dashboardToday = await page
      .locator('[data-testid="stat-today"]')
      .textContent()
      .then((t) => t?.trim() ?? '');

    const dashboardWeek = await page
      .locator('[data-testid="stat-week"]')
      .textContent()
      .then((t) => t?.trim() ?? '');

    // ── Timesheet (Today preset) ──
    await page.goto('/app/timesheet');
    await page.waitForSelector('button:has-text("Today")', { timeout: 10000 });
    await page.getByRole('button', { name: 'Today' }).click();
    await page.waitForTimeout(1000);

    const timesheetTotal = await page
      .locator('[data-testid="stat-total-hours"]')
      .textContent()
      .then((t) => t?.trim() ?? '');

    expect(dashboardToday).toBe(timesheetTotal);
    expect(dashboardWeek).toBe(timesheetTotal);

    // Sanity: neither should show the raw 2h (which would include the break)
    expect(dashboardToday).not.toBe('2h');
    expect(dashboardToday).not.toBe('2h 0m');
  });

  test('dashboard Today shows 0m when only completed sessions have full break coverage', async ({
    page,
  }) => {
    // Inject a session where the break covers almost the entire shift (edge case)
    const now = Date.now();
    const shiftStart = now - 60 * 60 * 1000; // 1h ago
    const shiftEnd = now - 1;
    const breakStart = shiftStart + 5 * 60 * 1000; // 5 min of work then...
    const breakEnd = shiftEnd - 5 * 60 * 1000; // ...50-min meal break, leaving 5+5 = 10m work

    injectedEventId = await injectSessionWithBreak(page, {
      shiftStart,
      shiftEnd,
      breakStart,
      breakEnd,
    });

    await page.goto('/app/dashboard');
    await page.waitForSelector('[data-testid="stat-today"]', { timeout: 15000 });

    const dashboardToday = await page
      .locator('[data-testid="stat-today"]')
      .textContent()
      .then((t) => t?.trim() ?? '');

    // Should NOT show 1h (the full span including break)
    expect(dashboardToday).not.toBe('1h');
    expect(dashboardToday).not.toBe('1h 0m');
    // Should show ~10m (the actual work: 5m before + 5m after)
    expect(dashboardToday).toMatch(/10m|9m|11m/);
  });
});
