/**
 * Dashboard session timer — counts like the "Hours today" stat.
 *
 * A running shift's timer is time since clock-in minus meal breaks (20 minutes
 * or more); rest breaks stay in. A live update to the clock event used to drop
 * the break fields and make the timer count meal breaks as worked time.
 * Sessions are backdated over REST on the Personal team, where edits apply
 * directly, so no real 20-minute wait is needed.
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import { TEST_USERS, loginAs } from '../fixtures/users';
import { getSessionToken } from '../tickets/helpers';

const MINUTE = 60_000;
const TOLERANCE_SECONDS = 6;

type ClockSession = { id: string; startTime: number; isPaused?: boolean };
type Break = { startTime: number; endTime: number | null };

async function call<T>(
  request: APIRequestContext,
  token: string,
  method: string,
  data: object,
): Promise<T> {
  const res = await request.post(`/api/${method}`, {
    headers: { Authorization: `Bearer ${token}` },
    data,
  });
  expect(res.status(), `${method} failed: ${await res.text()}`).toBe(200);
  return (await res.json()).result as T;
}

/** Timesheet edits on a Personal team apply directly; on other teams they wait for an admin. */
async function personalTeamId(request: APIRequestContext, token: string): Promise<string> {
  // The app provisions the Personal team after sign-in, so it can lag the login.
  let id = '';
  await expect
    .poll(
      async () => {
        const { teams } = await call<{ teams: { id: string; isPersonal: boolean }[] }>(
          request,
          token,
          'teams_list',
          {},
        );
        id = teams.find((t) => t.isPersonal)?.id ?? '';
        return id;
      },
      { timeout: 20000 },
    )
    .not.toBe('');
  return id;
}

/** The "HH:MM:SS" value on the Dashboard's session card, in seconds. */
async function dashboardTimerSeconds(page: Page): Promise<number> {
  const card = page
    .getByText(/Session active|On break/)
    .first()
    .locator('xpath=..');
  await expect(card).toContainText(/\d{2}:\d{2}:\d{2}/);
  const text = (await card.textContent()) ?? '';
  const [h, m, s] = (text.match(/(\d{2}):(\d{2}):(\d{2})/) as RegExpMatchArray)
    .slice(1)
    .map(Number);
  return h * 3600 + m * 60 + s;
}

/** Wait until the timer reads `expectedSeconds()` give or take a few seconds. */
async function expectTimerNear(page: Page, expectedSeconds: () => number) {
  await expect
    .poll(async () => Math.abs((await dashboardTimerSeconds(page)) - expectedSeconds()), {
      timeout: 15000,
    })
    .toBeLessThanOrEqual(TOLERANCE_SECONDS);
}

test.describe('Dashboard session timer', () => {
  let token: string;
  let teamId: string;
  let session: ClockSession;

  /** Clock in, then rewrite the shift to start `startedMinutesAgo` ago with `breaks`. */
  async function startShift(page: Page, startedMinutesAgo: number, breaks: (s: number) => Break[]) {
    const started = await call<ClockSession>(page.request, token, 'clock_start', { teamId });
    const startTime = Date.now() - startedMinutesAgo * MINUTE;
    session = await call<ClockSession>(page.request, token, 'clock_updateTimes', {
      clockEventId: started.id,
      startTime,
      breaks: breaks(startTime),
    });
    await page.goto('/app/dashboard');
  }

  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USERS.member1);
    token = await getSessionToken(page);
    teamId = await personalTeamId(page.request, token);
    // The Dashboard shows the selected team's shift, so select the Personal one.
    await page.evaluate((id) => {
      Object.keys(localStorage)
        .filter((k) => k.startsWith('app:selectedTeamId'))
        .forEach((k) => localStorage.setItem(k, id));
      localStorage.setItem('app:selectedTeamId', id);
    }, teamId);
    const open = await call<ClockSession | null>(page.request, token, 'clock_active', { teamId });
    if (open) await call(page.request, token, 'clock_stop', { teamId });
  });

  test.afterEach(async ({ page }) => {
    if (!teamId) return;
    const open = await call<ClockSession | null>(page.request, token, 'clock_active', { teamId });
    if (open) await call(page.request, token, 'clock_stop', { teamId });
  });

  test('subtracts a meal break from the running time', async ({ page }) => {
    await startShift(page, 90, (s) => [{ startTime: s + 10 * MINUTE, endTime: s + 40 * MINUTE }]);

    // 90 minutes in, 30 of them a meal break.
    await expectTimerNear(page, () => (Date.now() - session.startTime) / 1000 - 30 * 60);
  });

  test('keeps a rest break (under 20 minutes) in the running time', async ({ page }) => {
    await startShift(page, 90, (s) => [{ startTime: s + 10 * MINUTE, endTime: s + 25 * MINUTE }]);

    await expectTimerNear(page, () => (Date.now() - session.startTime) / 1000);
  });

  test('subtracts only the meal break when both kinds are taken', async ({ page }) => {
    await startShift(page, 90, (s) => [
      { startTime: s + 10 * MINUTE, endTime: s + 40 * MINUTE },
      { startTime: s + 50 * MINUTE, endTime: s + 60 * MINUTE },
    ]);

    await expectTimerNear(page, () => (Date.now() - session.startTime) / 1000 - 30 * 60);
  });

  test('keeps the meal-break deduction when a live update arrives', async ({ page }) => {
    await startShift(page, 90, (s) => [{ startTime: s + 10 * MINUTE, endTime: s + 40 * MINUTE }]);
    await expectTimerNear(page, () => (Date.now() - session.startTime) / 1000 - 30 * 60);

    // Writes to the clock event itself and reaches the page as a live update.
    await call(page.request, token, 'clock_agreeAutoClockout', { clockEventId: session.id });
    await page.waitForTimeout(3000);

    await expectTimerNear(page, () => (Date.now() - session.startTime) / 1000 - 30 * 60);
  });

  test('drops the meal-break deduction when an edit removes the break', async ({ page }) => {
    await startShift(page, 90, (s) => [{ startTime: s + 10 * MINUTE, endTime: s + 40 * MINUTE }]);
    await expectTimerNear(page, () => (Date.now() - session.startTime) / 1000 - 30 * 60);

    // A timesheet edit sends the new start and the breaks together.
    const editedStart = session.startTime - 5 * MINUTE;
    await call(page.request, token, 'clock_updateTimes', {
      clockEventId: session.id,
      startTime: editedStart,
      breaks: [],
    });

    await expectTimerNear(page, () => (Date.now() - editedStart) / 1000);
  });

  test('freezes on a meal break in progress and says so', async ({ page }) => {
    await startShift(page, 60, (s) => [{ startTime: s + 35 * MINUTE, endTime: null }]);

    await expect(page.getByText('On break')).toBeVisible();
    // 60 minutes in, the last 25 of them on break: 35 minutes worked, held.
    const frozen = await dashboardTimerSeconds(page);
    expect(Math.abs(frozen - 35 * 60)).toBeLessThanOrEqual(TOLERANCE_SECONDS);
    await page.waitForTimeout(3000);
    expect(await dashboardTimerSeconds(page)).toBe(frozen);
  });

  test('stops and resumes with the Break button', async ({ page }) => {
    await startShift(page, 60, () => []);
    await expect(page.getByText('Session active')).toBeVisible();

    await page.goto('/app/clock');
    await page.getByRole('button', { name: 'Start break' }).click();
    await page.goto('/app/dashboard');
    await expect(page.getByText('On break')).toBeVisible();
    // Let the page's post-load refetch land before reading the held value.
    await page.waitForTimeout(2000);
    const held = await dashboardTimerSeconds(page);
    await page.waitForTimeout(3000);
    expect(await dashboardTimerSeconds(page)).toBe(held);

    await page.goto('/app/clock');
    await page.getByRole('button', { name: 'Resume work' }).click();
    await page.goto('/app/dashboard');
    await expect(page.getByText('Session active')).toBeVisible();
    // The few seconds on break were under 20 minutes, so they count as worked time.
    await expectTimerNear(page, () => (Date.now() - session.startTime) / 1000);
  });
});
