/**
 * Shared ticket helpers for E2E tests — ticket CRUD via the UI, and attaching
 * a real Pulse video to a ticket (see ../fixtures/pulse.ts).
 */
import { expect, type Page } from '@playwright/test';
import { getSessionToken, sendPulseVideo } from '../fixtures/pulse';

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
 * real test-video.mp4 fixture the way Pulse does after a QR scan, then waits
 * for it in the ticket's attachments (AttachmentsPanel). Returns its videoid.
 */
export async function uploadVideoToTicket(page: Page, ticketTitle: string): Promise<string> {
  const ticketId = await openTicket(page, ticketTitle);
  const token = await getSessionToken(page);
  const { videoid, status } = await sendPulseVideo(page.request, token, {
    kind: 'ticket',
    id: ticketId,
  });
  expect(status.state).toBe('done');

  // Sent behind the page's back (no Pulse button pressed), so reload for it.
  await page.reload();
  const linksList = page.locator('ul[aria-label="Attachments"]');
  await expect(linksList.locator(`a[href*="/pulsevault/artifacts/${videoid}"]`)).toBeVisible({
    timeout: 30000,
  });
  return videoid;
}

/** Open a ticket from the list (must already be on /app/tickets); returns its id. */
export async function openTicket(page: Page, ticketTitle: string): Promise<string> {
  await page.getByRole('button', { name: ticketTitle, exact: true }).first().click();
  await page.waitForURL(/\/app\/tickets\/[^/]+$/);
  await page.getByText('Links and videos').waitFor({ state: 'visible' });
  return new URL(page.url()).pathname.split('/').pop()!;
}
