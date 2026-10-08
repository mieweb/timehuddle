/**
 * Video files from this device, next to Pulse.
 *
 * A ticket's Upload chip sends a file through the same reserved link Pulse
 * uses; the server checks it by content and conforms it to the Pulse format
 * (faststart H.264/AAC MP4) before attaching it. Needs ffmpeg on the test
 * backend's PATH for the conversion.
 */
import path from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import { TEST_USERS, loginAs } from '../fixtures/users';
import { createTicket, deleteTicket } from './helpers';

const TEST_WEBM = path.join(__dirname, '../fixtures/test-video.webm');

async function openTicket(page: Page, title: string): Promise<void> {
  await page.getByRole('button', { name: title, exact: true }).first().click();
  await page.waitForURL(/\/app\/tickets\/[0-9a-f]{24}/);
}

const uploadInput = (page: Page) =>
  page.locator('input[type="file"][aria-label="Choose a video file to upload"]');

test.describe('Ticket — upload a video file', () => {
  test.setTimeout(120000);
  const title = `Upload a recording ${Date.now()}`;

  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USERS.owner1);
    await createTicket(page, title);
    await openTicket(page, title);
  });

  test.afterEach(async ({ page }) => {
    await deleteTicket(page, title);
  });

  test('a browser WebM is attached and served as an MP4', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Upload a video file' })).toBeVisible();
    await uploadInput(page).setInputFiles(TEST_WEBM);

    const link = page.locator('ul[aria-label="Attachments"] a[href*="/pulsevault/artifacts/"]');
    await expect(link).toBeVisible({ timeout: 60000 });

    const res = await page.request.get((await link.getAttribute('href'))!);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toBe('video/mp4');
    expect((await res.body()).toString('latin1', 4, 8)).toBe('ftyp');
  });

  test("a file that isn't a video is refused with the server's reason", async ({ page }) => {
    await uploadInput(page).setInputFiles({
      name: 'renamed.mp4',
      mimeType: 'video/mp4',
      buffer: Buffer.from('this is not a video'),
    });
    await expect(page.getByText("That file isn't a video.")).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole('button', { name: 'Upload a video file' })).toBeEnabled();
  });
});
