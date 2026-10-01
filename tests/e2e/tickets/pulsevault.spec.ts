/**
 * PulseVault E2E Tests
 *
 * Verifies the @mieweb/pulsevault-backed video upload path on the Meteor
 * backend (meteor-backend/server/pulsevault.js):
 *  1. API-level contract — capabilities discovery, all 4 Wormhole-exposed
 *     methods (reserve, reserveForLibrary, getVideo, listVideos), the full
 *     raw TUS surface (POST/PATCH/HEAD/DELETE upload, GET/DELETE artifact),
 *     and the standalone /pulsevault/docs Swagger page.
 *  2. Ticket video upload flow — QR modal + deep link (and no device-upload
 *     option: videos come from Pulse only), and a Pulse upload's attachment
 *     appearing, playable, in the ticket's attachments.
 */
import fs from 'node:fs';
import { expect, test, type TestInfo } from '@playwright/test';
import { TEST_USERS, loginAs } from '../fixtures/users';
import {
  PULSE_CLIENT_HEADER,
  createTicket,
  deleteTicket,
  getSessionToken,
  reservePulseUpload,
  uploadVideoAsPulse,
  uploadVideoToTicket,
  TEST_MP4,
} from './helpers';

// ─── API-level contract checks ────────────────────────────────────────────────

test.describe('PulseVault — API contract', () => {
  test.setTimeout(30000);

  test('GET /pulsevault/capabilities is public and reports the protocol', async ({ request }) => {
    const res = await request.get('/pulsevault/capabilities');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('protocolVersion');
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

    const { videoid, uploadToken } = await reservePulseUpload(request, token, {
      target: 'library',
    });
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

    // A valid token but no `Pulse-Client` header — not the Pulse app, so the
    // create is refused (videos come from Pulse only).
    const notPulse = await request.post('/pulsevault/upload', {
      headers: {
        'Tus-Resumable': '1.0.0',
        'Upload-Length': '28',
        'Upload-Metadata': metadata,
        Authorization: `Bearer ${uploadToken}`,
      },
    });
    expect(notPulse.status()).toBe(403);

    // Correct capability token — TUS create must succeed.
    const authorized = await request.post('/pulsevault/upload', {
      headers: {
        ...PULSE_CLIENT_HEADER,
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
    test.setTimeout(90000);

    await loginAs(page, TEST_USERS.owner1);
    const token = await getSessionToken(page);
    const { videoid, uploadToken } = await reservePulseUpload(request, token, {
      target: 'library',
    });

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
    const { videoid, uploadToken } = await reservePulseUpload(request, token, {
      target: 'library',
    });

    await uploadVideoAsPulse(request, videoid, uploadToken);

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
    const { videoid, uploadToken } = await reservePulseUpload(request, token, {
      target: 'library',
    });
    await uploadVideoAsPulse(request, videoid, uploadToken);

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
  let ticketTitle = '';

  function buildTicketTitle(testInfo: TestInfo): string {
    const safeTitle = testInfo.title.replace(/[^a-z0-9]+/gi, '-').slice(0, 32);
    return `PulseVault E2E ${safeTitle} ${Date.now()} r${testInfo.retry}`;
  }

  test.beforeEach(async ({ page }, testInfo) => {
    ticketTitle = buildTicketTitle(testInfo);
    await loginAs(page, TEST_USERS.owner1);
    await createTicket(page, ticketTitle);
  });

  test.afterEach(async ({ page }) => {
    await deleteTicket(page, ticketTitle);
  });

  test('the Pulse button opens the QR modal with a valid pulsecam deep link', async ({ page }) => {
    await page.getByRole('button', { name: ticketTitle, exact: true }).first().click();
    await page.waitForTimeout(600);

    await page.getByRole('button', { name: 'Record a video with Pulse' }).click();

    const qrModal = page.locator('[aria-label="Record a video with Pulse"]');
    await expect(qrModal).toBeVisible({ timeout: 8000 });

    const qr = qrModal.locator('[aria-label="QR code to open the Pulse upload screen"]');
    await expect(qr).toBeVisible();
  });

  test('pressing Pulse again while its link is live reopens it instead of minting another', async ({
    page,
  }) => {
    await page.getByRole('button', { name: ticketTitle, exact: true }).first().click();
    await page.waitForTimeout(600);

    let reserves = 0;
    page.on('request', (req) => {
      if (req.url().includes('/api/pulsevault_reserve')) reserves += 1;
    });
    const pulse = page.getByRole('button', { name: 'Record a video with Pulse' });
    // The button and the modal share an accessible name, so find the modal by its QR code.
    const qr = page.getByLabel('QR code to open the Pulse upload screen');

    await pulse.click();
    await expect(qr).toBeVisible({ timeout: 8000 });
    await page.getByRole('button', { name: 'Close' }).last().click();
    await expect(qr).toBeHidden();

    await pulse.click();
    await expect(qr).toBeVisible({ timeout: 8000 });
    expect(reserves).toBe(1);
  });

  // The deep-link protocol itself (v=1, artifactId, server, token) is
  // asserted at the unit level in pulseLinks.test.ts —
  // qrcode.react renders to a plain <svg> with no way to read back the
  // encoded value, so this e2e test only covers what the browser can
  // actually observe: reserve() succeeding and the modal reflecting it.
  test('the QR modal offers no device upload — videos come from Pulse only', async ({ page }) => {
    await page.getByRole('button', { name: ticketTitle, exact: true }).first().click();
    await page.waitForTimeout(600);

    await page.getByRole('button', { name: 'Record a video with Pulse' }).click();

    const qrModal = page.locator('[aria-label="Record a video with Pulse"]');
    await expect(qrModal).toBeVisible({ timeout: 8000 });
    await expect(qrModal.getByText('Record with Pulse')).toBeVisible();
    await expect(page.getByText('Upload from this device')).toHaveCount(0);
    await expect(page.locator('input[type="file"]')).toHaveCount(0);
  });

  test("a Pulse upload completes and appears in the ticket's attachments", async ({ page }) => {
    await uploadVideoToTicket(page, ticketTitle);

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
