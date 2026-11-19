/**
 * Send, for real (PLAN §6; huddle-server §3–§7): the fake Pulse in server
 * mode asks the page for an upload target, which runs the real
 * `pulseUploads.begin` on the test backend, uploads a real MP4 over TUS to
 * its `/pulsevault`, and polls the artifact's status until the server
 * records where the video went. The ticket then has the video.
 *
 * Runs against a `VITE_PULSE_FAKE=1` build with the test backend on :3101:
 *   VITE_PULSE_FAKE=1 npx playwright test -c tests/playwright.config.ts tests/e2e/pulse-embed/server.spec.ts
 */
import { expect, test, type Page } from '@playwright/test';

import { TEST_USERS, loginAs } from '../fixtures/users';
import { createTicket, deleteTicket, goToTickets, ticketRow } from '../tickets/helpers';
import { PULSE_FAKE_BROWSER, ticketAttachmentUrls, uploadForReal } from './fake';

test.skip(process.env.VITE_PULSE_FAKE !== '1', 'Needs a VITE_PULSE_FAKE=1 build of the frontend');
test.use(PULSE_FAKE_BROWSER);

interface FakeDraft {
  id: string;
  name: string;
  state: string;
  upload?: { artifactId?: string; error?: { code: string; message: string } };
  sent?: { outcome: string; artifactId: string; uploadId: string };
}

interface FakeWindow {
  __PULSE_FAKE_SCRIPT__?: Record<string, unknown>;
  __PULSE_FAKE__?: {
    drafts(): FakeDraft[];
    hostRequests: { method: string; args: Record<string, unknown> }[];
  };
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

const fakeDrafts = (page: Page) =>
  page.evaluate(() => (window as unknown as FakeWindow).__PULSE_FAKE__?.drafts() ?? []);

const hostRequests = (page: Page) =>
  page.evaluate(() =>
    ((window as unknown as FakeWindow).__PULSE_FAKE__?.hostRequests ?? []).map((r) => r.method),
  );

test.describe('Send uploads to the server', () => {
  test.setTimeout(120_000);
  let ticketTitle: string;

  test.beforeEach(() => {
    ticketTitle = `Pulse send ${Date.now()}`;
  });
  test.afterEach(async ({ page }) => {
    await deleteTicket(page, ticketTitle);
  });

  test("a ticket's Record with Pulse: Send begins, uploads to PulseVault and attaches the video", async ({
    page,
  }) => {
    await pulseInAppOn(page);
    await page.addInitScript(() => {
      localStorage.setItem('timehuddle.pulse.prePromptSeen', '1');
      (window as unknown as FakeWindow).__PULSE_FAKE_SCRIPT__ = {
        flows: [{ result: 'sent', name: 'Real take' }],
      };
    });
    await uploadForReal(page);
    await loginAs(page, TEST_USERS.owner1);
    await createTicket(page, ticketTitle);
    await goToTickets(page);
    const ticketId = await ticketRow(page, ticketTitle).first().getAttribute('data-ticket-id');
    expect(ticketId).toMatch(/^[0-9a-f]{24}$/);
    expect(await ticketAttachmentUrls(page, ticketId!)).toEqual([]);

    const glyph = ticketRow(page, ticketTitle)
      .first()
      .getByRole('button', { name: 'Record with Pulse' });
    await expect(glyph).toBeVisible({ timeout: 20_000 });
    await glyph.click();
    await expect(page.getByText(`Sending to ${ticketTitle}`).first()).toBeVisible();

    // The fake asked the page for a target: the real begin answered it.
    await expect.poll(() => hostRequests(page)).toContain('getUploadTarget');

    // Uploaded, conformed and attached: the server's outcome retires the
    // draft into a receipt.
    await expect
      .poll(
        async () => {
          const [draft] = await fakeDrafts(page);
          return draft?.upload?.error?.message ?? draft?.state;
        },
        { timeout: 90_000 },
      )
      .toBe('sent');
    const [sent] = await fakeDrafts(page);
    expect(sent.sent?.outcome).toBe('done');
    expect(sent.sent?.artifactId).toBeTruthy();

    // The ticket has that video.
    const urls = await ticketAttachmentUrls(page, ticketId!);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain(sent.sent!.artifactId);
  });
});
