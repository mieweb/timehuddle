/**
 * Shared ticket helpers for E2E tests — ticket CRUD via the UI, and attaching
 * a real Pulse video to a ticket by doing exactly what the Pulse app does after
 * scanning the QR code: reserve, then a TUS upload carrying `Pulse-Client`.
 * The camera scan itself is the one step that isn't automatable here, and the
 * web app has no upload of its own any more (videos come from Pulse only).
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
  const ticketRow = page.locator('li').filter({ hasText: title }).first();
  await ticketRow.getByRole('button', { name: 'Ticket options' }).click();
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
 * What Pulse 2.1+ sends on every request (PROTOCOL.md §7.2). The backend only
 * lets a new upload in when it's there — see `authorize` in pulsevault.js.
 */
export const PULSE_CLIENT_HEADER = { 'Pulse-Client': 'Pulse/2.2.0 (e2e; test); protocol=1-2' };

/** The signed-in page's Meteor resume token, once its DDP session is up. */
export async function getSessionToken(page: Page): Promise<string> {
  // `meteor_resume_token` is the real Meteor-auth key getAccessToken() reads
  // (src/lib/api.ts). It lands in localStorage once the app's DDP client
  // finishes resuming its session, slightly after loginAs()'s redirect — poll
  // briefly instead of racing it.
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('meteor_resume_token')), {
      timeout: 10000,
    })
    .toBeTruthy();
  return (await page.evaluate(() => localStorage.getItem('meteor_resume_token'))) as string;
}

/** Reserve a Pulse upload the way the app's Pulse buttons do. */
export async function reservePulseUpload(
  request: APIRequestContext,
  token: string,
  data:
    | { target: 'library' }
    | { target: 'ticket'; ticketId: string }
    | { destination: Record<string, string> },
): Promise<{ videoid: string; uploadToken: string }> {
  const res = await request.post('/api/pulsevault_reserve', {
    headers: { Authorization: `Bearer ${token}` },
    data,
  });
  expect(res.status()).toBe(200);
  // Wormhole's REST bridge wraps every method's return value as { result }.
  const body = await res.json();
  return body.result;
}

/**
 * Full TUS create + single-chunk PATCH of the real test-video.mp4 fixture, as
 * the Pulse app sends it (`Pulse-Client` header included). Returns once the
 * upload is complete (Upload-Offset === file size).
 */
export async function uploadVideoAsPulse(
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
      ...PULSE_CLIENT_HEADER,
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
      ...PULSE_CLIENT_HEADER,
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
 * Opens the given ticket (must already be on /app/tickets) and attaches the
 * real test-video.mp4 fixture the way Pulse does after a QR scan. Waits for the
 * resulting Pulse video to appear in the ticket's attachments (AttachmentsPanel,
 * src/features/clock/AttachmentsPanel.tsx).
 */
export async function uploadVideoToTicket(page: Page, ticketTitle: string): Promise<void> {
  await page.getByRole('button', { name: ticketTitle, exact: true }).first().click();
  await page.waitForURL(/\/app\/tickets\/[^/]+$/);
  const ticketId = new URL(page.url()).pathname.split('/').pop()!;

  const token = await getSessionToken(page);
  const { videoid, uploadToken } = await reservePulseUpload(page.request, token, {
    target: 'ticket',
    ticketId,
  });
  await uploadVideoAsPulse(page.request, videoid, uploadToken);

  // The ticket page only polls while its QR modal is open; reload to pick up
  // the attachment the backend created when the upload finished.
  await page.reload();
  const linksList = page.locator('ul[aria-label="Attached links"]');
  await expect(linksList.locator(`a[href*="/pulsevault/artifacts/${videoid}"]`)).toBeVisible({
    timeout: 30000,
  });
}
