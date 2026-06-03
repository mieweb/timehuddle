/**
 * Shift Reminder E2E Tests
 *
 * Verifies the Agenda-based shift reminder behaviour for Jane Doe:
 *
 *  Scenario A — "Agree to Clock Out":
 *    1. Seed Jane's clock event to 7h44m30s ago → shift-end modal fires in ~30s
 *    2. Jane clicks "Agree to Clock Out" → API sets autoClockoutAgreed=true
 *    3. Seed the Agenda job to fire in 5s → Jane is auto-clocked out
 *    4. Verify Jane has no active clock session
 *
 *  Scenario B — "Continue Working":
 *    1. Seed Jane's clock event to 7h44m30s ago → shift-end modal fires in ~30s
 *    2. Jane clicks "Continue Working" → modal closes, no flag set
 *    3. Advance DB time past 8h mark, verify no auto-clockout job was scheduled
 *    4. Verify Jane is still clocked in
 */

import { MongoClient, ObjectId } from 'mongodb';
import { expect, test } from '@playwright/test';

const TEST_EMAIL = 'bob@example.com';
const TEST_PASSWORD = 'Password1!';
// Bob's userId is stable — seeded once and never changes
const TEST_USER_ID = '69f4f84156731a5f77a8a8a4';
const API_BASE = 'http://localhost:4000/v1';
const MONGO_URI = 'mongodb://127.0.0.1:27017/timehuddle';

// ─── DB helpers ───────────────────────────────────────────────────────────────

async function withDb<T>(
  fn: (db: ReturnType<MongoClient['db']>, client: MongoClient) => Promise<T>,
): Promise<T> {
  const client = await MongoClient.connect(MONGO_URI);
  try {
    return await fn(client.db(), client);
  } finally {
    await client.close();
  }
}

/** Close any active Bob session and wipe his pending Agenda jobs. */
async function resetUser(userId: string) {
  await withDb(async (db) => {
    await db
      .collection('clockevents')
      .updateMany({ userId, endTime: null }, { $set: { endTime: Date.now(), accumulatedTime: 0 } });
    await db.collection('agendajobs').deleteMany({ 'data.userId': userId });
  });
}

/**
 * Adjust an existing clock event's startTime so the shift-end-reminder Agenda
 * job fires in ~fireInMs ms, inserting the job directly into MongoDB.
 * eventId and teamId come from the API clock-in response.
 */
async function seedShiftEndReminder(
  eventId: string,
  userId: string,
  teamId: string,
  fireInMs = 0,
): Promise<void> {
  await withDb(async (db) => {
    const shiftEndMs = 7 * 3600_000 + 45 * 60_000;
    // Set nextRunAt slightly in the past so Agenda picks it up on its very next poll
    const fireAt = new Date(Date.now() + fireInMs);
    const startTime = fireAt.getTime() - shiftEndMs;

    await db
      .collection('clockevents')
      .updateOne({ _id: new ObjectId(eventId) }, { $set: { startTime } });

    // Cancel any stale Agenda jobs for this event, then insert the new one
    await db.collection('agendajobs').deleteMany({ 'data.clockEventId': eventId });
    await db.collection('agendajobs').insertOne({
      name: 'shift-end-reminder',
      data: { clockEventId: eventId, userId, teamId },
      // Past-due by 1s — Agenda picks it up on the very next poll
      nextRunAt: new Date(Date.now() - 1000),
      priority: 0,
      lockedAt: null,
      lastRunAt: null,
      lastFinishedAt: null,
      disabled: false,
    });
  });
}

/**
 * Schedule the auto-clockout Agenda job to fire in fireInMs ms for an existing event.
 * NOTE: autoClockoutAgreed is set server-side when Jane clicks "Agree to Clock Out"
 * via the API. This helper only inserts the raw Agenda job for timing control.
 */
async function seedAutoClockout(clockEventId: string, userId: string, teamId: string) {
  await withDb(async (db) => {
    await db.collection('agendajobs').updateOne(
      { name: 'shift-auto-clockout', 'data.clockEventId': clockEventId },
      {
        $set: {
          name: 'shift-auto-clockout',
          data: { clockEventId, userId, teamId },
          // Past-due by 1s — Agenda picks it up on the very next poll
          nextRunAt: new Date(Date.now() - 1000),
          priority: 0,
          lockedAt: null,
          lastRunAt: null,
          lastFinishedAt: null,
          disabled: false,
        },
      },
      { upsert: true },
    );
  });
}

/** Returns true if the user has an active (endTime=null) clock session. */
async function isClockedIn(userId: string): Promise<boolean> {
  return withDb(async (db) => {
    const ev = await db.collection('clockevents').findOne({
      userId,
      endTime: null,
    });
    return ev !== null;
  });
}

// ─── Login ────────────────────────────────────────────────────────────────────

async function login(page: import('@playwright/test').Page) {
  await page.goto('/app');
  await page.waitForSelector('input[type="email"]', { timeout: 10000 });
  await page.fill('input[type="email"]', TEST_EMAIL);
  await page.fill('input[type="password"]', TEST_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/dashboard', { timeout: 15000 });
}

/**
 * Return the Authorization header map for direct API calls.
 * The frontend stores the bearer token in localStorage after sign-in.
 */
async function authHeaders(page: import('@playwright/test').Page): Promise<Record<string, string>> {
  const token = await page.evaluate(() => localStorage.getItem('timecore_session_token'));
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Clock in using the API and return { eventId, teamId }. */
async function clockIn(
  page: import('@playwright/test').Page,
): Promise<{ eventId: string; teamId: string }> {
  const headers = await authHeaders(page);
  const teamsRes = await page.request.get(`${API_BASE}/teams`, { headers });
  const { teams } = (await teamsRes.json()) as { teams: { id: string }[] };
  const teamId = teams[0].id;

  const startRes = await page.request.post(`${API_BASE}/clock/start`, {
    headers,
    data: { teamId },
  });
  const { event } = (await startRes.json()) as { event: { id: string } };
  return { eventId: event.id, teamId };
}

/** Stop any active clock session so each test starts clean. */
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

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe('Shift Reminder', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(120_000);

  test.beforeEach(async () => {
    // Clean up any leftover DB state from a previous test run
    await resetUser(TEST_USER_ID);
  });

  test.afterEach(async () => {
    await resetUser(TEST_USER_ID);
  });

  // ── Scenario A ────────────────────────────────────────────────────────────

  test('Agree to Clock Out → auto-clocks out at 8h', async ({ page }) => {
    await login(page);
    await ensureClockedOut(page);
    const { eventId, teamId } = await clockIn(page);

    // Seed the reminder job as past-due — Agenda picks it on its very next poll
    await seedShiftEndReminder(eventId, TEST_USER_ID, teamId);

    // Wait for the SSE push to reach the UI and open the modal (≤45s for Agenda)
    await expect(page.getByRole('dialog', { name: 'Shift End Reminder' })).toBeVisible({
      timeout: 45000,
    });

    // Click "Agree to Clock Out" — POSTs /clock/events/:id/agree-clockout
    await page.getByRole('button', { name: /agree to.*clock out/i }).click();

    // Modal should close
    await expect(page.getByRole('dialog', { name: 'Shift End Reminder' })).not.toBeVisible({
      timeout: 5000,
    });

    // Advance startTime to exactly 8h ago so the auto-clockout fires at the 8h mark.
    // (The reminder seeded it at 7h45m ago; production would wait for the remaining 15m.)
    const eightHoursAgo = Date.now() - 8 * 3600_000;
    await withDb(async (db) => {
      await db
        .collection('clockevents')
        .updateOne({ _id: new ObjectId(eventId) }, { $set: { startTime: eightHoursAgo } });
    });

    // Override the scheduled auto-clockout job to be past-due so Agenda picks it immediately
    await seedAutoClockout(eventId, TEST_USER_ID, teamId);

    // Agenda processes every 30s — give it up to 45s to fire the clockout
    await expect
      .poll(async () => isClockedIn(TEST_USER_ID), { timeout: 45000, intervals: [1000] })
      .toBe(false);

    // Verify the ended session lasted ≥8h:
    //  - endTime − startTime (ms) ≥ 8h  → confirms startTime was advanced correctly
    //  - accumulatedTime (seconds)  ≥ 8h → confirms clockService.stop() computed the right span
    const { durationMs, accumulatedTime } = await withDb(async (db) => {
      const ev = await db.collection('clockevents').findOne({ _id: new ObjectId(eventId) });
      return {
        durationMs: ev && ev.endTime != null ? ev.endTime - ev.startTime : 0,
        accumulatedTime: ev?.accumulatedTime ?? 0,
      };
    });
    expect(durationMs).toBeGreaterThanOrEqual(8 * 3600_000); // ms
    expect(accumulatedTime).toBeGreaterThanOrEqual(8 * 3600); // seconds

    // Confirm the API also reports no active session
    const headers = await authHeaders(page);
    const res = await page.request.get(`${API_BASE}/clock/active`, { headers });
    const { event } = (await res.json()) as { event: unknown };
    expect(event).toBeNull();

    // ── UI verification ──────────────────────────────────────────────────────
    // Navigate to the clock page and confirm it shows the clocked-out state
    await page.goto('/app/clock');
    await expect(page.getByRole('button', { name: 'Clock in' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Ready to work')).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('button', { name: 'Clock out' })).not.toBeVisible();
  });

  // ── Scenario B ────────────────────────────────────────────────────────────

  test('Continue Working → stays clocked in past 8h', async ({ page }) => {
    await login(page);
    await ensureClockedOut(page);
    const { eventId, teamId } = await clockIn(page);

    // Seed the reminder job as past-due — Agenda picks it on its very next poll
    await seedShiftEndReminder(eventId, TEST_USER_ID, teamId);

    // Wait for the modal to appear
    await expect(page.getByRole('dialog', { name: 'Shift End Reminder' })).toBeVisible({
      timeout: 45000,
    });

    // Click "Continue Working" — purely local, no API call, no flag set
    await page.getByRole('button', { name: /continue working/i }).click();

    // Modal should close
    await expect(page.getByRole('dialog', { name: 'Shift End Reminder' })).not.toBeVisible({
      timeout: 5000,
    });

    // Verify autoClockoutAgreed was NOT set on the event
    const agreed = await withDb(async (db) => {
      const ev = await db.collection('clockevents').findOne({
        _id: new ObjectId(eventId),
      });
      return ev?.autoClockoutAgreed ?? false;
    });
    expect(agreed).toBeFalsy();

    // Verify NO auto-clockout Agenda job was scheduled
    const jobCount = await withDb(async (db) =>
      db.collection('agendajobs').countDocuments({
        name: 'shift-auto-clockout',
        'data.clockEventId': eventId,
      }),
    );
    expect(jobCount).toBe(0);

    // Move startTime 8h+ into the past — if any stale job existed it would now fire
    await withDb(async (db) => {
      await db
        .collection('clockevents')
        .updateOne(
          { _id: new ObjectId(eventId) },
          { $set: { startTime: Date.now() - 8 * 3600_000 - 60_000 } },
        );
    });

    // Give Agenda one full poll cycle to confirm no job fires
    await page.waitForTimeout(35000);

    // User should still be clocked in (DB check)
    expect(await isClockedIn(TEST_USER_ID)).toBe(true);

    // ── UI verification — timer still running past 8h ───────────────────────
    // Navigate to the clock page; the frontend fetches the fresh startTime
    // (8h+60s ago) and renders the elapsed counter.
    await page.goto('/app/clock');
    await expect(page.getByRole('button', { name: 'Clock out' })).toBeVisible({ timeout: 10000 });

    // "Session active — 08:01:XX" — confirms elapsed time is 8+ hours
    await expect(page.getByText(/Session active — 0?8:/)).toBeVisible({ timeout: 5000 });

    // Page title also carries the elapsed time: "08:01:XX · Clock In/Out …"
    await expect.poll(() => page.title(), { timeout: 5000 }).toMatch(/^0?8:/);

    await expect(page.getByRole('button', { name: 'Clock in' })).not.toBeVisible();
  });
});
