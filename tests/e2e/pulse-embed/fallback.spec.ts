/**
 * Where Pulse doesn't run in the app, every "Record with Pulse" place keeps
 * today's Pulse link flow, unchanged (PLAN §5.1 Fallback modes; startPulse):
 * an app build without the Pulse plugin, a team with "Pulse in the app" off,
 * Pulse paused for everyone, and the browser.
 *
 * The plugin cases need a `VITE_PULSE_FAKE=1` build (the page counts as the
 * app there); the browser case runs in any build. Run (PR3-V2): with the test
 * backend on :3101 and no other Vite on the e2e port,
 *   VITE_PULSE_FAKE=1 npx playwright test -c tests/playwright.config.ts tests/e2e/pulse-embed
 */
import { expect, test, type Page } from '@playwright/test';

import { TEST_USERS, loginAs } from '../fixtures/users';
import { createTicket, deleteTicket, goToTickets, ticketRow } from '../tickets/helpers';

const FAKE_BUILD = process.env.VITE_PULSE_FAKE === '1';

interface PulseWindow {
  __PULSE_ADAPTER__?: unknown;
}

/** An app build without the Pulse plugin: its adapter says Pulse isn't there. */
async function withoutPulsePlugin(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as PulseWindow).__PULSE_ADAPTER__ = {
      kind: 'none',
      present: async () => false,
      call: async () => ({ ok: false, error: { code: 'unavailable', message: 'No plugin' } }),
      subscribe: () => () => {},
      toWebUrl: (path: string) => path,
    };
  });
}

/** `pulseUploadTypes.list` as the server says it, with the settings given for every team. */
async function pulseSettings(
  page: Page,
  { pulseInApp, runtimePaused }: { pulseInApp: boolean; runtimePaused: boolean },
): Promise<void> {
  await page.route('**/api/pulseUploadTypes_list*', async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { result?: { teams?: Record<string, unknown> } };
    const result = body.result ?? {};
    const teams = Object.fromEntries(
      Object.keys(result.teams ?? {}).map((id) => [
        id,
        { pulseInApp, pulseClockInOut: false, pulseSharedDevice: false },
      ]),
    );
    await route.fulfill({
      response,
      json: { ...body, result: { ...result, runtimePaused, teams } },
    });
  });
}

/** The row keeps today's Pulse chip, and on a computer it opens the QR window. */
async function expectTodaysLink(page: Page, title: string): Promise<void> {
  const row = ticketRow(page, title).first();
  const chip = row.getByRole('button', { name: `Record a video for ${title} with Pulse` });
  await expect(chip).toBeVisible({ timeout: 20_000 });
  await expect(row.getByRole('button', { name: 'Record with Pulse' })).toHaveCount(0);
  await chip.click();
  const qrWindow = page.locator('[aria-label="Record a video with Pulse"]');
  await expect(qrWindow).toBeVisible({ timeout: 8_000 });
  await expect(
    qrWindow.locator('[aria-label="QR code to open the Pulse upload screen"]'),
  ).toBeVisible();
}

test.describe('Record with Pulse falls back to the Pulse link', () => {
  test.setTimeout(90_000);
  let ticketTitle: string;

  test.beforeEach(() => {
    ticketTitle = `Pulse fallback ${Date.now()}`;
  });

  test.afterEach(async ({ page }) => {
    await deleteTicket(page, ticketTitle);
  });

  test('an app build without the Pulse plugin keeps the link', async ({ page }) => {
    test.skip(!FAKE_BUILD, 'Needs a VITE_PULSE_FAKE=1 build (the page counts as the app)');
    await withoutPulsePlugin(page);
    await pulseSettings(page, { pulseInApp: true, runtimePaused: false });
    await loginAs(page, TEST_USERS.owner1);
    await createTicket(page, ticketTitle);
    await goToTickets(page);
    await expectTodaysLink(page, ticketTitle);
  });

  test('a team with Pulse in the app off keeps the link', async ({ page }) => {
    test.skip(!FAKE_BUILD, 'Needs a VITE_PULSE_FAKE=1 build (the page counts as the app)');
    await pulseSettings(page, { pulseInApp: false, runtimePaused: false });
    await loginAs(page, TEST_USERS.owner1);
    await createTicket(page, ticketTitle);
    await goToTickets(page);
    await expectTodaysLink(page, ticketTitle);
  });

  test('Pulse paused for everyone keeps the link', async ({ page }) => {
    test.skip(!FAKE_BUILD, 'Needs a VITE_PULSE_FAKE=1 build (the page counts as the app)');
    await pulseSettings(page, { pulseInApp: true, runtimePaused: true });
    await loginAs(page, TEST_USERS.owner1);
    await createTicket(page, ticketTitle);
    await goToTickets(page);
    await expectTodaysLink(page, ticketTitle);
  });

  test('a browser keeps the link (the QR window on a computer)', async ({ page }) => {
    // Not the app: in a fake build the page counts as the app, so this one
    // runs only in an ordinary build.
    test.skip(FAKE_BUILD, 'Runs in an ordinary (non-fake) build');
    await loginAs(page, TEST_USERS.owner1);
    await createTicket(page, ticketTitle);
    await goToTickets(page);
    await expectTodaysLink(page, ticketTitle);
  });
});
