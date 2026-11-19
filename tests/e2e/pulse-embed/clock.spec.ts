/**
 * Clock out / Clock in with a Pulse video on the Clock page (PLAN §5.1 B2 and
 * B3; TH-11): the buttons show only with "Clock in and out with a Pulse
 * video" on, they are disabled offline, Send clocks at the time the server
 * records, and a kept take leaves the clock as it was, with "Clock out now".
 *
 * Runs against a `VITE_PULSE_FAKE=1` build: the scripted fake Pulse from
 * @mieweb/pulse-embed/testing stands in for the native plugin, and calls the
 * page's `confirmSend` at Send as Pulse does, which runs the real
 * `clock.stopWithVideo` / `clock.startWithPlan` on the test backend.
 *
 * Run (PR3-V2): with the test backend on :3101 and no other Vite on the e2e
 * port (a reused server may not be a fake build),
 *   VITE_PULSE_FAKE=1 npx playwright test -c tests/playwright.config.ts tests/e2e/pulse-embed/clock.spec.ts
 */
import { expect, test, type Page } from '@playwright/test';

import { selectSharedTestTeam } from '../fixtures/team';
import { TEST_USERS, loginAs } from '../fixtures/users';
import { getSessionToken } from '../tickets/helpers';

test.skip(process.env.VITE_PULSE_FAKE !== '1', 'Needs a VITE_PULSE_FAKE=1 build of the frontend');

// ─── The fake Pulse and the server's settings ─────────────────────────────────

type FakeFlow = { result: 'sent'; name?: string } | { result: 'kept' } | { result: 'discarded' };

interface OpenArgs {
  entry?: string;
  context?: { key: string; label: string; uploadType?: { id: string } };
}

interface FakeWindow {
  __PULSE_FAKE_SCRIPT__?: { flows: FakeFlow[] };
  __PULSE_FAKE__?: { calls: { method: string; args: OpenArgs }[] };
}

async function scriptFakePulse(page: Page, flows: FakeFlow[]): Promise<void> {
  await page.addInitScript((steps) => {
    (window as unknown as FakeWindow).__PULSE_FAKE_SCRIPT__ = { flows: steps };
  }, flows);
}

async function skipPrePrompt(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('timehuddle.pulse.prePromptSeen', '1');
  });
}

/** `pulseUploadTypes.list` as the server says it, with Pulse in the app on and clock videos as given. */
async function pulseSettings(page: Page, pulseClockInOut: boolean): Promise<void> {
  await page.route('**/api/pulseUploadTypes_list*', async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as {
      result?: { teams?: Record<string, unknown>; runtimePaused?: boolean };
    };
    const result = body.result ?? {};
    const teams = Object.fromEntries(
      Object.keys(result.teams ?? {}).map((id) => [
        id,
        { pulseInApp: true, pulseClockInOut, pulseSharedDevice: false },
      ]),
    );
    await route.fulfill({
      response,
      json: { ...body, result: { ...result, runtimePaused: false, teams } },
    });
  });
}

async function lastOpen(page: Page): Promise<OpenArgs> {
  const opens = () =>
    page.evaluate(() =>
      ((window as unknown as FakeWindow).__PULSE_FAKE__?.calls ?? [])
        .filter((call) => call.method === 'open')
        .map((call) => call.args),
    );
  await expect.poll(async () => (await opens()).length, { timeout: 10_000 }).toBeGreaterThan(0);
  const all = await opens();
  return all[all.length - 1];
}

/** Signed in on the shared team, with a REST helper and the clock as `clockedIn` says. */
async function onClockPage(page: Page, clockedIn: boolean) {
  await loginAs(page, TEST_USERS.owner1);
  const teamId = await selectSharedTestTeam(page);
  const token = await getSessionToken(page);
  const api = (method: string, data: Record<string, unknown>) =>
    page.request.post(`/api/${method}`, {
      headers: { Authorization: `Bearer ${token}` },
      data,
    });
  // Start from a known clock: out, then in when asked.
  await api('clock_stop', { teamId });
  if (clockedIn) expect((await api('clock_start', { teamId })).ok()).toBe(true);
  await page.goto('/app/clock');
  const today = await page.evaluate(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  return { teamId, api, today };
}

const clockStatus = (page: Page, text: string) =>
  page.locator('.clock-status [role="status"]').filter({ hasText: new RegExp(`^${text}$`) });

// ─── The buttons ──────────────────────────────────────────────────────────────

test.describe('Clock in and out with a Pulse video', () => {
  test.setTimeout(90_000);

  test('with the team setting off, the Clock page keeps today’s Pulse link', async ({ page }) => {
    await pulseSettings(page, false);
    await skipPrePrompt(page);
    const { teamId, api } = await onClockPage(page, false);
    try {
      await expect(
        page.getByRole('button', { name: 'Clock in with Pulse', exact: true }),
      ).toBeVisible({ timeout: 20_000 });
      await expect(page.getByRole('button', { name: 'Clock in with a Pulse video' })).toHaveCount(
        0,
      );
    } finally {
      await api('clock_stop', { teamId });
    }
  });

  test('offline, the button is disabled and says it needs a connection', async ({ page }) => {
    await pulseSettings(page, true);
    await skipPrePrompt(page);
    const { teamId, api } = await onClockPage(page, false);
    try {
      const button = page.getByRole('button', { name: 'Clock in with a Pulse video' });
      await expect(button).toBeEnabled({ timeout: 20_000 });
      await page.context().setOffline(true);
      await expect(button).toBeDisabled();
      await expect(page.getByText('Needs a connection')).toBeVisible();
      await page.context().setOffline(false);
      await expect(button).toBeEnabled();
    } finally {
      await page.context().setOffline(false);
      await api('clock_stop', { teamId });
    }
  });

  test('clock in with a plan video: Send clocks in, and says when', async ({ page }) => {
    await pulseSettings(page, true);
    await skipPrePrompt(page);
    await scriptFakePulse(page, [{ result: 'sent', name: 'Plan take' }]);
    const { teamId, api, today } = await onClockPage(page, false);
    try {
      const button = page.getByRole('button', { name: 'Clock in with a Pulse video' });
      await expect(button).toBeVisible({ timeout: 20_000 });
      await button.click();

      const open = await lastOpen(page);
      expect(open.entry).toBe('record');
      expect(open.context?.key).toBe(`clock-plan:${teamId.toLowerCase()}:${today}`);
      expect(open.context?.uploadType?.id).toBe('clock.plan');

      await expect(
        page.getByText(/^Clocked in at \d{1,2}:\d{2}\s?[AP]M · video sending$/),
      ).toBeVisible({ timeout: 15_000 });
      // The Clock page said it; the generic "Sending to …" toast stays quiet.
      await expect(page.getByText(/^Sending to /)).toHaveCount(0);
      await expect(clockStatus(page, 'Clocked in')).toBeVisible();
    } finally {
      await api('clock_stop', { teamId });
    }
  });

  test('a kept wrap-up leaves the person clocked in, with Clock out now', async ({ page }) => {
    await pulseSettings(page, true);
    await skipPrePrompt(page);
    await scriptFakePulse(page, [{ result: 'kept' }]);
    const { teamId, api } = await onClockPage(page, true);
    try {
      const button = page.getByRole('button', { name: 'Clock out with a Pulse video' });
      await expect(button).toBeVisible({ timeout: 20_000 });
      await button.click();

      const open = await lastOpen(page);
      expect(open.context?.key).toMatch(/^clock:[0-9a-z_-]+$/);
      expect(open.context?.uploadType?.id).toBe('clock.wrapup');

      await expect(page.getByText('Still clocked in', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Clock out now' })).toBeVisible();
      await expect(clockStatus(page, 'Clocked in')).toBeVisible();
      await expect(button).toBeFocused();
      // The kept take is on this phone, unsent.
      await expect(page.getByRole('button', { name: /^Unsent videos \(\d+\)$/ })).toBeVisible();
    } finally {
      await api('clock_stop', { teamId });
    }
  });
});
