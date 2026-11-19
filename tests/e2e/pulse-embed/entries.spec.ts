/**
 * "Record with Pulse" from each place Pulse records for in the app (PLAN §5.1
 * flows A, B1 and P; TH-7): a ticket's row, the ticket page's Videos card, a
 * clock session's videos, and the Huddle composer.
 *
 * Runs against a `VITE_PULSE_FAKE=1` build: the scripted fake Pulse from
 * @mieweb/pulse-embed/testing stands in for the native plugin
 * (src/features/pulse-embed/testAdapter.ts), so the record buttons work in
 * desktop Chrome as they do in the app. The server's Pulse settings are read
 * through, with "Pulse in the app" turned on for the person's teams.
 *
 * Run (PR3-V2): with the test backend on :3101 and no other Vite on the e2e
 * port (a reused server may not be a fake build),
 *   VITE_PULSE_FAKE=1 npx playwright test -c tests/playwright.config.ts tests/e2e/pulse-embed
 */
import { expect, test, type Page } from '@playwright/test';

import { selectSharedTestTeam } from '../fixtures/team';
import { TEST_USERS, loginAs } from '../fixtures/users';
import {
  createTicket,
  deleteTicket,
  getSessionToken,
  goToTickets,
  ticketRow,
} from '../tickets/helpers';

test.skip(process.env.VITE_PULSE_FAKE !== '1', 'Needs a VITE_PULSE_FAKE=1 build of the frontend');

// ─── The fake Pulse and the server's settings ─────────────────────────────────

type FakeFlow = { result: 'sent'; name?: string } | { result: 'kept' } | { result: 'discarded' };

interface OpenArgs {
  entry?: string;
  draftId?: string;
  context?: { key: string; label: string; uploadType?: { id: string } };
}

interface FakeWindow {
  __PULSE_FAKE_SCRIPT__?: { flows: FakeFlow[] };
  __PULSE_FAKE__?: { calls: { method: string; args: OpenArgs }[] };
}

/** What the fake Pulse does on each open, set before the page loads. */
async function scriptFakePulse(page: Page, flows: FakeFlow[]): Promise<void> {
  await page.addInitScript((steps) => {
    (window as unknown as FakeWindow).__PULSE_FAKE_SCRIPT__ = { flows: steps };
  }, flows);
}

/** The pre-prompt was read on this "phone" before: record buttons open Pulse at once. */
async function skipPrePrompt(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('timehuddle.pulse.prePromptSeen', '1');
  });
}

/** `pulseUploadTypes.list` as the server says it, with Pulse in the app on for every team. */
async function pulseInAppOn(page: Page): Promise<void> {
  await page.route('**/api/pulseUploadTypes_list*', async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as {
      result?: { teams?: Record<string, unknown>; runtimePaused?: boolean };
    };
    const result = body.result ?? {};
    const teams = Object.fromEntries(
      Object.keys(result.teams ?? {}).map((id) => [
        id,
        { pulseInApp: true, pulseClockInOut: false, pulseSharedDevice: false },
      ]),
    );
    await route.fulfill({
      response,
      json: { ...body, result: { ...result, runtimePaused: false, teams } },
    });
  });
}

/** The newest `open` the page sent the fake Pulse. */
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

// ─── Tickets (flow A) ─────────────────────────────────────────────────────────

test.describe('Record with Pulse: tickets', () => {
  test.setTimeout(90_000);
  let ticketTitle: string;

  test.beforeEach(async ({ page }) => {
    ticketTitle = `Pulse entry ${Date.now()}`;
    await pulseInAppOn(page);
  });

  test.afterEach(async ({ page }) => {
    await deleteTicket(page, ticketTitle);
  });

  test("a ticket's row explains once, then records for that ticket", async ({ page }) => {
    await scriptFakePulse(page, [{ result: 'kept' }]);
    await loginAs(page, TEST_USERS.owner1);
    await createTicket(page, ticketTitle);
    await goToTickets(page);

    const row = ticketRow(page, ticketTitle).first();
    const glyph = row.getByRole('button', { name: 'Record with Pulse' });
    await expect(glyph).toBeVisible({ timeout: 20_000 });
    // Today's link chip is gone from the row.
    await expect(row.getByRole('button', { name: /^Record a video for / })).toHaveCount(0);

    await glyph.click();
    const prePrompt = page.getByRole('dialog');
    await expect(prePrompt.getByText(/tickets and clock sessions/)).toBeVisible();
    await prePrompt.getByRole('button', { name: 'Continue' }).click();

    const open = await lastOpen(page);
    expect(open.entry).toBe('record');
    expect(open.context?.key).toMatch(/^ticket:[0-9a-f]{24}$/);
    expect(open.context?.label).toBe(ticketTitle);
    expect(open.context?.uploadType?.id).toBe('ticket.video');

    // Kept: said in the toast region, focus back on the row's button, the row
    // still on the list (it never opened its ticket).
    await expect(page.getByText('Saved to Unsent videos').first()).toBeVisible();
    await expect(glyph).toBeFocused();
    await expect(page).toHaveURL(/\/app\/tickets(\?|$)/);

    // Once read, the explanation isn't shown again.
    await glyph.click();
    await expect.poll(async () => (await page.getByRole('dialog').count()) === 0).toBe(true);
  });

  test("the ticket page's Videos card: its unsent video, On this phone, and Open", async ({
    page,
  }) => {
    await skipPrePrompt(page);
    await scriptFakePulse(page, [{ result: 'kept' }, { result: 'kept' }]);
    await loginAs(page, TEST_USERS.owner1);
    await createTicket(page, ticketTitle);
    await goToTickets(page);
    await page.getByRole('button', { name: ticketTitle, exact: true }).first().click();

    const card = page.locator('.ticket-attachments-section');
    const record = card.getByRole('button', { name: 'Record with Pulse' });
    await expect(record).toBeVisible({ timeout: 20_000 });
    await expect(card.getByRole('button', { name: 'Add a video with Pulse' })).toHaveCount(0);

    await record.click();
    const recorded = await lastOpen(page);
    expect(recorded.entry).toBe('record');
    expect(recorded.context?.label).toBe(ticketTitle);

    // The kept take: one row on this phone, and the link beside the button.
    await expect(card.getByRole('heading', { name: 'On this phone' })).toBeVisible();
    await expect(card.getByRole('list', { name: 'Videos on this phone' })).toBeVisible();
    const unsent = card.getByRole('button', { name: '1 unsent video here · Open' });
    await expect(unsent).toBeVisible();

    // Open goes to Pulse's editor on that take.
    await unsent.click();
    const edited = await lastOpen(page);
    expect(edited.entry).toBe('edit');
    expect(typeof edited.draftId).toBe('string');
  });
});

// ─── A clock session's videos (flow B1) ───────────────────────────────────────

test.describe('Record with Pulse: session videos', () => {
  test.setTimeout(90_000);

  test("the open session's videos record a session video for it", async ({ page }) => {
    await pulseInAppOn(page);
    await skipPrePrompt(page);
    await scriptFakePulse(page, [{ result: 'sent', name: 'Session take' }]);
    await loginAs(page, TEST_USERS.owner1);
    const teamId = await selectSharedTestTeam(page);
    const token = await getSessionToken(page);
    const api = (method: string, data: Record<string, unknown>) =>
      page.request.post(`/api/${method}`, {
        headers: { Authorization: `Bearer ${token}` },
        data,
      });
    const started = await api('clock_start', { teamId });
    expect(started.ok()).toBe(true);
    try {
      await page.goto('/app/dashboard');
      await page.getByRole('button', { name: 'Videos for this session' }).first().click();
      const dialog = page.getByRole('dialog');
      const record = dialog.getByRole('button', { name: 'Record with Pulse' });
      await expect(record).toBeVisible({ timeout: 20_000 });
      await record.click();

      const open = await lastOpen(page);
      expect(open.entry).toBe('record');
      expect(open.context?.key).toMatch(/^clock:[0-9a-f]{24}$/);
      // A session video, never its wrap-up.
      expect(open.context?.uploadType?.id).toBe('clock.session');
      await expect(page.getByText(/^Sending to /).first()).toBeVisible();
    } finally {
      await api('clock_stop', { teamId });
    }
  });
});

// ─── The Huddle composer (flow P) ─────────────────────────────────────────────

test.describe('Record with Pulse: the composer', () => {
  test.setTimeout(90_000);

  test('the message box records a new post for its team', async ({ page }) => {
    await pulseInAppOn(page);
    await skipPrePrompt(page);
    await scriptFakePulse(page, [{ result: 'sent', name: 'Post take' }]);
    await loginAs(page, TEST_USERS.owner1);
    const teamId = await selectSharedTestTeam(page);
    await page.goto('/app/huddle');

    const composer = page.locator('.huddle-composer-pulse');
    const record = composer.getByRole('button', { name: 'Record with Pulse' });
    await expect(record).toBeVisible({ timeout: 20_000 });
    await expect(composer.getByRole('button', { name: 'Post a video with Pulse' })).toHaveCount(0);
    await record.click();

    const open = await lastOpen(page);
    expect(open.entry).toBe('record');
    expect(open.context?.key).toBe(`huddle:${teamId.toLowerCase()}`);
    expect(open.context?.uploadType?.id).toBe('huddle.post');
    await expect(page.getByText(`Sending to ${open.context?.label}`).first()).toBeVisible();
    await expect(record).toBeFocused();
  });
});
