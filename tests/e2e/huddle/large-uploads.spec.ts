/**
 * Large attachment uploads — what the media endpoint accepts, and what it stores.
 *
 * The bug that motivated this suite was invisible from the UI: a file past the
 * size cap came back `200 OK` with a green checkmark, having been silently
 * truncated to the cap and stored corrupt. So the load-bearing assertions here
 * compare *bytes stored* against *bytes sent* — a test that only checked for a
 * success response would have passed against the exact bug it replaced.
 *
 * The two image tests measure the outgoing request instead, because they're
 * about the opposite direction: a full-resolution camera photo must NOT go over
 * the wire whole.
 */
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { TEST_USERS, loginAs } from '../fixtures/users';
import { selectSharedTestTeam } from '../fixtures/team';
import { attachmentChipCount, openComposer } from './helpers';

const FIXTURES_DIR = path.join(__dirname, '../fixtures');

interface UploadResult {
  sentBytes: number;
  status: number;
  error?: string;
  item?: { id: string; size: number; url: string; mimeType: string; filename: string };
  /** Bytes actually readable back from the stored URL. */
  storedBytes?: number;
}

/**
 * POST a generated file straight at the media endpoint from inside the page,
 * then read the stored file back. Goes through `fetch` with the session's own
 * bearer token rather than the app's client module, so this measures the
 * transport with no client-side compression in the way.
 */
async function uploadGenerated(
  page: Page,
  spec: { megabytes: number; name: string; type: string },
): Promise<UploadResult> {
  return page.evaluate(async ({ megabytes, name, type }) => {
    const bytes = new Uint8Array(megabytes * 1024 * 1024);
    bytes.fill(0x5a);
    const file = new File([bytes], name, { type });

    const form = new FormData();
    form.append('file', file, name);
    const token = localStorage.getItem('meteor_resume_token');

    const res = await fetch('/api/media/upload', {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });
    const payload = (await res.json()) as {
      item?: { id: string; size: number; url: string; mimeType: string; filename: string };
      error?: string;
    };

    if (!payload.item) {
      return { sentBytes: file.size, status: res.status, error: payload.error };
    }
    const stored = await fetch(payload.item.url);
    return {
      sentBytes: file.size,
      status: res.status,
      item: payload.item,
      storedBytes: (await stored.blob()).size,
    };
  }, spec);
}

test.describe('Large attachment uploads', () => {
  // Describe level, not per test: the login in beforeEach has to cover a cold
  // dev-server page load, and a timeout set inside a test body comes too late
  // for its own hooks. The payloads here are large enough to need the headroom
  // regardless.
  test.setTimeout(240000);

  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USERS.owner1);
    await selectSharedTestTeam(page);
  });

  test('stores a 25 MB document whole', async ({ page }) => {
    await page.goto('/app/huddle');

    const result = await uploadGenerated(page, {
      megabytes: 25,
      name: 'quarterly-report.txt',
      type: 'text/plain',
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(200);
    expect(result.item?.mimeType).toBe('text/plain');
    // Byte for byte: under the old 10 MB cap both of these read 10485760 while
    // the request still returned 200.
    expect(result.item?.size).toBe(result.sentBytes);
    expect(result.storedBytes).toBe(result.sentBytes);
  });

  test('rejects a file past the cap instead of storing a truncated one', async ({ page }) => {
    await page.goto('/app/huddle');

    // One megabyte past the 100 MB default (MAX_UPLOAD_MB).
    const result = await uploadGenerated(page, {
      megabytes: 101,
      name: 'oversized.txt',
      type: 'text/plain',
    });

    expect(result.status).toBe(413);
    expect(result.error).toContain('larger than');
    expect(result.item).toBeUndefined();
  });

  test('sends a full-resolution photo downscaled, not whole', async ({ page }) => {
    const photoPath = path.join(FIXTURES_DIR, 'large-photo.jpg');
    const photo = fs.readFileSync(photoPath);
    expect(photo.length).toBeGreaterThan(300 * 1024);

    await openComposer(page);
    const uploadResponse = page.waitForResponse(
      (res) => res.url().includes('/api/media/upload') && res.status() === 200,
    );
    await page
      .locator('input[type="file"][accept="image/*"]')
      .setInputFiles({ name: 'IMG_4821.JPG', mimeType: 'image/jpeg', buffer: photo });
    await expect.poll(() => attachmentChipCount(page), { timeout: 30000 }).toBe(1);

    const res = await uploadResponse;
    const json = (await res.json()) as { item: { size: number; mimeType: string } };
    expect(json.item.size).toBeLessThan(photo.length / 2);
    expect(json.item.mimeType).toBe('image/jpeg');
  });

  test('sends a PNG screenshot as WebP so its transparency survives', async ({ page }) => {
    const screenshotPath = path.join(FIXTURES_DIR, 'large-screenshot.png');
    const screenshot = fs.readFileSync(screenshotPath);
    expect(screenshot.length).toBeGreaterThan(300 * 1024);

    await openComposer(page);
    const uploadResponse = page.waitForResponse(
      (res) => res.url().includes('/api/media/upload') && res.status() === 200,
    );
    await page
      .locator('input[type="file"][accept="image/*"]')
      .setInputFiles({ name: 'Screenshot.png', mimeType: 'image/png', buffer: screenshot });
    await expect.poll(() => attachmentChipCount(page), { timeout: 30000 }).toBe(1);

    const res = await uploadResponse;
    const json = (await res.json()) as { item: { size: number; mimeType: string } };
    expect(json.item.mimeType).toBe('image/webp');
    expect(json.item.size).toBeLessThan(screenshot.length);
  });

  test('leaves a document untouched by the image compressor', async ({ page }) => {
    await page.goto('/app/huddle');

    const result = await uploadGenerated(page, {
      megabytes: 2,
      name: 'notes.txt',
      type: 'text/plain',
    });

    expect(result.item?.size).toBe(result.sentBytes);
    expect(result.storedBytes).toBe(result.sentBytes);
    expect(result.item?.filename).toMatch(/\.txt$/);
  });
});
