/**
 * Shared ticket helpers for E2E tests — ticket CRUD via the UI, and attaching
 * a real Pulse video to a ticket via PulseUploadButton's "Upload from this
 * device" fallback (the same TUS mechanics a real Pulse Cam app uses after
 * scanning the QR code, minus the literal camera scan — see
 * tests/e2e/tickets/pulsevault.spec.ts for why that's the accepted boundary
 * of what's automatable here).
 */
import fs from 'node:fs';
import path from 'node:path';
import { expect, type APIRequestContext, type Page } from '@playwright/test';

const FIXTURES_DIR = path.join(__dirname, '../fixtures');
export const TEST_MP4 = path.join(FIXTURES_DIR, 'test-video.mp4');

export async function goToTickets(page: Page): Promise<void> {
  await page.goto('/app/tickets');
  await page.getByRole('heading', { level: 1, name: 'Tickets' }).waitFor({ state: 'visible' });
}

/**
 * The table row for a ticket, by title.
 *
 * Rows are `<tr data-ticket-id>` — the unified table replaced the old `<ul>`/`<li>`
 * list, and the only `<li>` left in it is the per-source error banner. Scoped to
 * the visible tab panel because both Tickets and My Board stay mounted to keep
 * their state, so an unscoped match would also hit the hidden panel's copy of
 * the same row. Mirrors `TicketsPage.rowByTitle`.
 */
export function ticketRow(page: Page, title: string) {
  return page
    .locator('[role="tabpanel"]:visible')
    .locator('tr[data-ticket-id]')
    .filter({ hasText: title });
}

export async function createTicket(page: Page, title: string): Promise<void> {
  await goToTickets(page);
  await page.getByRole('button', { name: 'New Ticket' }).click();
  await page.getByPlaceholder('Ticket title').fill(title);
  await page.getByRole('button', { name: 'Create Ticket' }).click();
  await page.waitForTimeout(1000);
  await expect(page.getByText(title).first()).toBeVisible();
}

export async function deleteTicket(page: Page, title: string): Promise<void> {
  await goToTickets(page);
  await ticketRow(page, title).first().getByRole('button', { name: 'Ticket options' }).click();
  await page.waitForTimeout(200);
  await page.getByText('Delete Ticket', { exact: true }).click();
  await page.waitForTimeout(300);
  const confirmBtn = page.getByRole('button', { name: /confirm|delete|yes/i }).last();
  if (await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await confirmBtn.click();
  }
  await page.waitForTimeout(800);
}

/**
 * Opens the given ticket (must already be on /app/tickets) and attaches the
 * real test-video.mp4 fixture via PulseUploadButton's "Upload from this
 * device" fallback. Waits for the resulting link to appear in the ticket's
 * "Links" list (AttachmentsPanel, src/features/clock/AttachmentsPanel.tsx).
 */
/**
 * The signed-in user's Meteor session token, for Wormhole's REST bridge.
 * `meteor_resume_token` lands in localStorage once the DDP client has resumed
 * its session, slightly after the redirect loginAs() waits on — poll briefly.
 */
export async function getSessionToken(page: Page): Promise<string> {
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('meteor_resume_token')), {
      timeout: 10000,
    })
    .toBeTruthy();
  return (await page.evaluate(() => localStorage.getItem('meteor_resume_token'))) as string;
}

/** Reserve a Pulse upload for `destination` over REST: its videoid and link token. */
export async function reservePulseUpload(
  request: APIRequestContext,
  token: string,
  destination: { kind: string; id?: string },
): Promise<{ videoid: string; uploadToken: string }> {
  const res = await request.post('/api/pulsevault_reserve', {
    headers: { Authorization: `Bearer ${token}` },
    data: { destination },
  });
  expect(res.status()).toBe(200);
  // Wormhole's REST bridge wraps every method's return value as { result }.
  return (await res.json()).result;
}

/**
 * Full TUS create + single-chunk PATCH of the real test-video.mp4 fixture,
 * entirely at the API level (no browser UI) — what the Pulse app does once a
 * link is scanned. Returns once the bytes are in (Upload-Offset === file
 * size); the backend makes the video web-playable and delivers it after.
 */
export async function uploadRealVideoViaApi(
  request: APIRequestContext,
  videoid: string,
  uploadToken: string,
): Promise<void> {
  const bytes = fs.readFileSync(TEST_MP4);
  const metadata = [
    `artifactId ${Buffer.from(videoid).toString('base64')}`,
    `filename ${Buffer.from('test-video.mp4').toString('base64')}`,
  ].join(',');

  const created = await request.post('/pulsevault/upload', {
    headers: {
      'Tus-Resumable': '1.0.0',
      'Upload-Length': String(bytes.length),
      'Upload-Metadata': metadata,
      Authorization: `Bearer ${uploadToken}`,
    },
  });
  expect(created.status()).toBe(201);
  const location = created.headers()['location'];
  expect(location).toBeTruthy();

  const patched = await request.patch(location, {
    headers: {
      'Tus-Resumable': '1.0.0',
      'Upload-Offset': '0',
      'Content-Type': 'application/offset+octet-stream',
      Authorization: `Bearer ${uploadToken}`,
    },
    data: bytes,
  });
  expect(patched.status()).toBe(204);
  expect(patched.headers()['upload-offset']).toBe(String(bytes.length));
}

/**
 * Send a Pulse video to the ticket with this title, the way the Pulse app
 * does: reserve a link for the ticket, upload the fixture through it, and
 * wait for the backend to attach it. Leaves the page on the ticket, with the
 * video in its Attachments list.
 */
export async function uploadVideoToTicket(page: Page, ticketTitle: string): Promise<void> {
  await page.getByRole('button', { name: ticketTitle, exact: true }).first().click();
  await page.waitForURL(/\/app\/tickets\/[0-9a-f]{24}/);
  const ticketId = page.url().match(/\/app\/tickets\/([0-9a-f]{24})/)![1];
  const token = await getSessionToken(page);

  const { videoid, uploadToken } = await reservePulseUpload(page.request, token, {
    kind: 'ticket',
    id: ticketId,
  });
  await uploadRealVideoViaApi(page.request, videoid, uploadToken);

  // The backend makes the video web-playable before attaching it, seconds after
  // the last byte. Only the Pulse button's own link is watched for in the page,
  // so wait on the attachments themselves, then look at the list fresh.
  await expect
    .poll(
      async () => {
        const res = await page.request.post('/api/attachments_list', {
          headers: { Authorization: `Bearer ${token}` },
          data: { kind: 'ticket', id: ticketId },
        });
        const { attachments } = (await res.json()).result as { attachments: { url: string }[] };
        return attachments.some((a) => a.url.includes(videoid));
      },
      { timeout: 30000 },
    )
    .toBe(true);
  await page.reload();
  await expect(
    page.locator('ul[aria-label="Attachments"]').locator(`a[href*="${videoid}"]`),
  ).toBeVisible({ timeout: 10000 });
}
