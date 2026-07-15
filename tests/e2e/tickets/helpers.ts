/**
 * Shared ticket helpers for E2E tests — ticket CRUD via the UI, and attaching
 * a real Pulse video to a ticket via PulseUploadButton's "Upload from this
 * device" fallback (the same TUS mechanics a real Pulse Cam app uses after
 * scanning the QR code, minus the literal camera scan — see
 * tests/e2e/tickets/pulsevault.spec.ts for why that's the accepted boundary
 * of what's automatable here).
 */
import path from 'node:path';
import { expect, type Page } from '@playwright/test';

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
 * Opens the given ticket (must already be on /app/tickets) and attaches the
 * real test-video.mp4 fixture via PulseUploadButton's "Upload from this
 * device" fallback. Waits for the resulting link to appear in the ticket's
 * "Links" list (AttachmentsPanel, src/features/clock/AttachmentsPanel.tsx).
 */
export async function uploadVideoToTicket(page: Page, ticketTitle: string): Promise<void> {
  await page.getByRole('button', { name: ticketTitle, exact: true }).first().click();
  await page.waitForTimeout(600);

  await page.getByRole('button', { name: /upload video/i }).click();

  const qrModal = page.locator('[aria-label="Upload video with the Pulse app"]');
  await expect(qrModal).toBeVisible({ timeout: 8000 });

  // Closes the QR modal itself and opens the hidden file input.
  await page.locator('button', { hasText: 'Upload from this device' }).click();

  const fileInput = page.locator('input[type="file"][accept=".mp4,video/mp4"]');
  await fileInput.setInputFiles(TEST_MP4);

  const linksList = page.locator('ul[aria-label="Attached links"]');
  await expect(linksList.locator('a[href*="/pulsevault/artifacts/"]').first()).toBeVisible({
    timeout: 30000,
  });
}
