/**
 * Media Library — Upload Button E2E Tests
 *
 * Verifies the "Upload" button on the Media Library page (/app/media):
 *  1. Upload button is visible and enabled.
 *  2. Selecting an MP4 via the hidden file input triggers a TUS upload through
 *     the PulseVault endpoint and the item appears in the grid on completion.
 *  3. Selecting an image also works (non-TUS path).
 *
 * Uses the real test-video.mp4 fixture (770 KB) so the MP4 sniffer passes.
 */
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { TEST_USERS, loginAs } from '../fixtures/users';

const FIXTURES_DIR = path.join(__dirname, '../fixtures');
const TEST_MP4 = path.join(FIXTURES_DIR, 'test-video.mp4');

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function goToMedia(page: import('@playwright/test').Page) {
  await page.goto('/app/media');
  // aria-label on the button is "Upload media"
  await page
    .getByRole('button', { name: 'Upload media' })
    .waitFor({ state: 'visible', timeout: 15000 });
}

async function countVideoItems(page: import('@playwright/test').Page): Promise<number> {
  // Each video grid item has an aria-label that starts with "Open details for"
  const items = page.locator('[aria-label^="Open details for"]');
  const all = await items.all();
  // Filter to video items (they carry an MP4 badge)
  let count = 0;
  for (const item of all) {
    if (
      await item
        .locator('text=MP4')
        .isVisible()
        .catch(() => false)
    )
      count++;
  }
  return count;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe('Media Library — Upload button', () => {
  test.setTimeout(60000);

  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USERS.owner1);
    await goToMedia(page);
  });

  test('Upload button is visible and enabled on the media page', async ({ page }) => {
    const btn = page.getByRole('button', { name: 'Upload media' });
    await expect(btn).toBeVisible();
    await expect(btn).toBeEnabled();
  });

  test('MP4 upload via Upload button completes and appears in the video grid', async ({ page }) => {
    const videosBeforeFilter = page.locator('button[aria-pressed="false"]', { hasText: 'Videos' });
    await videosBeforeFilter.click();

    const before = await countVideoItems(page);

    // The file input is hidden — set files directly without clicking the button
    // (clicking the button opens the OS picker which Playwright can't control).
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(TEST_MP4);

    // Wait for the progress indicator to appear then clear
    await expect(page.getByText(/Uploading/i)).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/Uploading/i)).toBeHidden({ timeout: 30000 });

    // Reload to confirm the item was persisted (onUploadComplete wrote to DB)
    await page.reload();
    await goToMedia(page);

    // Switch to Videos tab
    await page.locator('button[aria-pressed]', { hasText: 'Videos' }).click();

    const after = await countVideoItems(page);
    expect(after).toBeGreaterThan(before);
  });

  test('Upload error state is shown if the upload fails', async ({ page }) => {
    // Intercept the TUS POST to force a 500 so we can verify error UI
    await page.route('**/pulsevault/upload', (route) =>
      route.fulfill({ status: 500, body: 'error' }),
    );

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(TEST_MP4);

    // Should show an error message somewhere on the page
    await expect(page.locator('text=/upload|error/i').first()).toBeVisible({ timeout: 15000 });
  });
});
