/**
 * PulseVault E2E Tests
 *
 * Verifies the @mieweb/pulsevault-backed video upload path on the Meteor
 * backend (meteor-backend/server/pulsevault.js):
 *  1. API-level contract — capabilities discovery, all 4 Wormhole-exposed
 *     methods (reserve, reserveForLibrary, getVideo, listVideos), the full
 *     raw TUS surface (POST/PATCH/HEAD/DELETE upload, GET/DELETE artifact),
 *     and the standalone /pulsevault/docs Swagger page.
 *  2. Ticket video upload flow — QR modal + deep link, device upload, the
 *     resulting attachment appearing in the ticket's "Links" list.
 */
import fs from 'node:fs';
import { expect, test, type Page, type APIRequestContext } from '@playwright/test';
import { TEST_USERS, loginAs } from '../fixtures/users';
import { createTicket, deleteTicket, uploadVideoToTicket, TEST_MP4 } from './helpers';

const TICKET_TITLE = `PulseVault E2E Upload Test ${Date.now()}`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getSessionToken(page: Page): Promise<string> {
  // `meteor_resume_token` is the real Meteor-auth key getAccessToken() reads
  // (src/lib/api.ts) — `timecore_session_token` is dead Fastify-era storage,
  // never written to since the Meteor migration. It lands in localStorage
  // once the app's DDP client finishes resuming its session, which happens
  // slightly after the dashboard redirect loginAs() waits on — poll briefly
  // instead of racing it.
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('meteor_resume_token')), {
      timeout: 10000,
    })
    .toBeTruthy();
  return (await page.evaluate(() => localStorage.getItem('meteor_resume_token'))) as string;
}

async function reserveLibraryUpload(
  request: APIRequestContext,
  token: string,
): Promise<{ videoid: string; uploadToken: string }> {
  const res = await request.post('/api/pulsevault_reserve', {
    headers: { Authorization: `Bearer ${token}` },
    data: { target: 'library' },
  });
  expect(res.status()).toBe(200);
  // Wormhole's REST bridge wraps every method's return value as { result }.
  const body = await res.json();
  return body.result;
}

/**
 * Full TUS create + single-chunk PATCH of the real test-video.mp4 fixture,
 * entirely at the API level (no browser UI). Used by tests that need a
 * genuinely completed video (passes the real MP4 sniffer, lands in
 * `mediaitems`) to exercise getVideo/listVideos/artifact-serving against.
 * Returns once the upload is complete (Upload-Offset === file size).
 */
async function uploadRealVideoViaApi(
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

// ─── API-level contract checks ────────────────────────────────────────────────

test.describe('PulseVault — API contract', () => {
  test.setTimeout(30000);

  test('GET /pulsevault/capabilities is public and reports the protocol', async ({ request }) => {
    const res = await request.get('/pulsevault/capabilities');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('protocolVersion');
    expect(body).toHaveProperty('uploadUnit', 'merged');
  });

  test('POST /api/pulsevault_reserve requires auth', async ({ request }) => {
    const res = await request.post('/api/pulsevault_reserve', { data: {} });
    // Wormhole maps every thrown Meteor.Error to 500 (app-wide behavior, not
    // specific to this method — verified against tickets_list too), so an
    // unauthenticated call surfaces as 500 with a `not-authorized` error body
    // rather than a 401.
    expect(res.status()).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('not-authorized');
  });

  test('reserve mints a videoid + capability token, and TUS create is authorized by it', async ({
    page,
    request,
  }) => {
    await loginAs(page, TEST_USERS.owner1);
    const token = await getSessionToken(page);

    const { videoid, uploadToken } = await reserveLibraryUpload(request, token);
    expect(videoid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(typeof uploadToken).toBe('string');

    const metadata = [
      `artifactId ${Buffer.from(videoid).toString('base64')}`,
      `filename ${Buffer.from('test.mp4').toString('base64')}`,
    ].join(',');

    // Wrong/missing capability token — TUS create must be rejected.
    const unauthorized = await request.post('/pulsevault/upload', {
      headers: { 'Tus-Resumable': '1.0.0', 'Upload-Length': '28', 'Upload-Metadata': metadata },
    });
    expect(unauthorized.status()).toBe(401);

    // Correct capability token — TUS create must succeed.
    const authorized = await request.post('/pulsevault/upload', {
      headers: {
        'Tus-Resumable': '1.0.0',
        'Upload-Length': '28',
        'Upload-Metadata': metadata,
        Authorization: `Bearer ${uploadToken}`,
      },
    });
    expect(authorized.status()).toBe(201);
    expect(authorized.headers()['location']).toBeTruthy();
  });

  test('PATCH/HEAD/DELETE /pulsevault/upload/{id} — chunk append, offset query, cancel', async ({
    page,
    request,
  }) => {
    await loginAs(page, TEST_USERS.owner1);
    const token = await getSessionToken(page);
    const { videoid, uploadToken } = await reserveLibraryUpload(request, token);

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

    // HEAD before any bytes are sent — offset must read back 0.
    const head = await request.head(location, {
      headers: { 'Tus-Resumable': '1.0.0', Authorization: `Bearer ${uploadToken}` },
    });
    expect(head.status()).toBe(200);
    expect(head.headers()['upload-offset']).toBe('0');
    expect(head.headers()['upload-length']).toBe(String(bytes.length));

    // PATCH the first half as one chunk — offset must advance to that length.
    const half = bytes.subarray(0, Math.floor(bytes.length / 2));
    const patch1 = await request.patch(location, {
      headers: {
        'Tus-Resumable': '1.0.0',
        'Upload-Offset': '0',
        'Content-Type': 'application/offset+octet-stream',
        Authorization: `Bearer ${uploadToken}`,
      },
      data: half,
    });
    expect(patch1.status()).toBe(204);
    expect(patch1.headers()['upload-offset']).toBe(String(half.length));

    // DELETE cancels the in-flight upload.
    const del = await request.delete(location, {
      headers: { 'Tus-Resumable': '1.0.0', Authorization: `Bearer ${uploadToken}` },
    });
    expect(del.status()).toBe(204);

    // The cancelled upload no longer exists.
    const headAfterDelete = await request.head(location, {
      headers: { 'Tus-Resumable': '1.0.0', Authorization: `Bearer ${uploadToken}` },
    });
    expect(headAfterDelete.status()).toBe(404);
  });

  test('pulsevault.getVideo / pulsevault.listVideos return the completed upload', async ({
    page,
    request,
  }) => {
    await loginAs(page, TEST_USERS.owner1);
    const token = await getSessionToken(page);
    const { videoid, uploadToken } = await reserveLibraryUpload(request, token);

    await uploadRealVideoViaApi(request, videoid, uploadToken);

    // onUploadComplete writes the mediaitems doc synchronously within the
    // completing PATCH's request lifecycle, but poll briefly to absorb any
    // scheduling jitter rather than assuming exact timing.
    await expect
      .poll(
        async () => {
          const res = await request.post('/api/pulsevault_getVideo', {
            headers: { Authorization: `Bearer ${token}` },
            data: { artifactId: videoid },
          });
          return res.status();
        },
        { timeout: 10000 },
      )
      .toBe(200);

    const getRes = await request.post('/api/pulsevault_getVideo', {
      headers: { Authorization: `Bearer ${token}` },
      data: { artifactId: videoid },
    });
    const getBody = await getRes.json();
    expect(getBody.result.artifactId).toBe(videoid);
    expect(getBody.result.mimeType).toBe('video/mp4');
    expect(getBody.result.url).toContain(`/pulsevault/artifacts/${videoid}`);

    const listRes = await request.post('/api/pulsevault_listVideos', {
      headers: { Authorization: `Bearer ${token}` },
      data: {},
    });
    expect(listRes.status()).toBe(200);
    const listBody = await listRes.json();
    expect(
      listBody.result.videos.some((v: { artifactId: string }) => v.artifactId === videoid),
    ).toBe(true);
  });

  test('GET/DELETE /pulsevault/artifacts/{id} serve and remove the finished video', async ({
    page,
    request,
  }) => {
    await loginAs(page, TEST_USERS.owner1);
    const token = await getSessionToken(page);
    const { videoid, uploadToken } = await reserveLibraryUpload(request, token);
    await uploadRealVideoViaApi(request, videoid, uploadToken);

    await expect
      .poll(async () => (await request.get(`/pulsevault/artifacts/${videoid}`)).status(), {
        timeout: 10000,
      })
      .toBe(200);

    const getArtifact = await request.get(`/pulsevault/artifacts/${videoid}`);
    expect(getArtifact.status()).toBe(200);
    expect(getArtifact.headers()['content-type']).toContain('video/mp4');

    // Artifact delete is authorized by the same capability token as the
    // upload (the `authorize` hook only treats the `resolve`/GET phase as
    // public — everything else, including delete, goes through
    // verifyUploadToken against the artifact-scoped capability token, not a
    // general Meteor session token).
    const del = await request.delete(`/pulsevault/artifacts/${videoid}`, {
      headers: { Authorization: `Bearer ${uploadToken}` },
    });
    expect([200, 204]).toContain(del.status());

    const getAfterDelete = await request.get(`/pulsevault/artifacts/${videoid}`);
    expect(getAfterDelete.status()).toBe(404);
  });

  test('GET /pulsevault/docs and /pulsevault/openapi.json serve the standalone Swagger page', async ({
    request,
  }) => {
    const docsRes = await request.get('/pulsevault/docs');
    expect(docsRes.status()).toBe(200);
    expect(docsRes.headers()['content-type']).toContain('text/html');

    const specRes = await request.get('/pulsevault/openapi.json');
    expect(specRes.status()).toBe(200);
    const spec = await specRes.json();
    expect(spec.servers).toEqual([{ url: '/pulsevault' }]);
    for (const p of ['/capabilities', '/upload', '/upload/{id}', '/artifacts/{artifactId}']) {
      expect(spec.paths).toHaveProperty(p);
    }
  });
});

// ─── Ticket video upload flow ─────────────────────────────────────────────────

test.describe('PulseVault — Ticket video upload', () => {
  test.setTimeout(90000);

  test.beforeEach(async ({ page }) => {
    await loginAs(page, TEST_USERS.owner1);
    await createTicket(page, TICKET_TITLE);
  });

  test.afterEach(async ({ page }) => {
    await deleteTicket(page, TICKET_TITLE);
  });

  test('"Upload Video" button opens QR modal with a valid pulsecam deep link', async ({ page }) => {
    await page.getByRole('button', { name: TICKET_TITLE, exact: true }).first().click();
    await page.waitForTimeout(600);

    await page.getByRole('button', { name: /upload video/i }).click();

    const qrModal = page.locator('[aria-label="Upload video with the Pulse app"]');
    await expect(qrModal).toBeVisible({ timeout: 8000 });

    const qr = qrModal.locator('[aria-label="QR code to open the Pulse upload screen"]');
    await expect(qr).toBeVisible();
  });

  // The deep-link protocol itself (v=1, artifactId, server, token,
  // uploadUnit) is asserted at the unit level in PulseUploadButton.test.ts —
  // qrcode.react renders to a plain <svg> with no way to read back the
  // encoded value, so this e2e test only covers what the browser can
  // actually observe: reserve() succeeding and the modal reflecting it.
  test('device-upload fallback is offered alongside the QR code', async ({ page }) => {
    await page.getByRole('button', { name: TICKET_TITLE, exact: true }).first().click();
    await page.waitForTimeout(600);

    await page.getByRole('button', { name: /upload video/i }).click();

    const qrModal = page.locator('[aria-label="Upload video with the Pulse app"]');
    await expect(qrModal).toBeVisible({ timeout: 8000 });
    await expect(qrModal.getByText('Upload Video with Pulse')).toBeVisible();
    await expect(page.locator('button', { hasText: 'Upload from this device' })).toBeVisible();
  });

  test("direct MP4 upload from device completes and appears under the ticket's Links list", async ({
    page,
  }) => {
    await uploadVideoToTicket(page, TICKET_TITLE);

    // uploadVideoToTicket already waits for the link to appear and leaves us
    // on the ticket's own detail page (URL-based route) — re-confirm after a
    // reload that it was actually persisted (onUploadComplete wrote the
    // attachment to Mongo), not just held in transient component state.
    await page.reload();
    await page.waitForTimeout(1000);

    const linksList = page.locator('ul[aria-label="Attached links"]');
    await expect(linksList.locator('a[href*="/pulsevault/artifacts/"]').first()).toBeVisible({
      timeout: 8000,
    });
  });
});
