/**
 * PulseVault E2E Tests
 *
 * Verifies the @mieweb/pulsevault-backed video upload path on the Meteor
 * backend (meteor-backend/server/pulsevault.js):
 *  1. API-level contract — capabilities discovery, the Wormhole-exposed
 *     methods (reserve, status, getVideo, listVideos), the full raw TUS
 *     surface (POST/PATCH/HEAD/DELETE upload, GET/DELETE artifact), and the
 *     standalone /pulsevault/docs Swagger page.
 *  2. Ticket video upload flow — QR modal + deep link (and no device-upload
 *     option: videos come from Pulse only), and what the open modal says when
 *     the video lands: added (and listed), or kept in the library.
 */
import fs from 'node:fs';
import { expect, test, type TestInfo } from '@playwright/test';
import { TEST_USERS, loginAs } from '../fixtures/users';
import { markTicketDeleted } from '../fixtures/db';
import {
  PULSE_CLIENT_HEADER,
  TEST_MP4,
  expectImageLoaded,
  getSessionToken,
  posterLocation,
  reservePulseUpload,
  uploadVideoAsPulse,
  waitForPulseOutcome,
} from '../fixtures/pulse';
import { createTicket, deleteTicket, openTicket, uploadVideoToTicket } from './helpers';

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

  test('reserve refuses a missing or unknown destination', async ({ page, request }) => {
    await loginAs(page, TEST_USERS.owner1);
    const token = await getSessionToken(page);
    for (const data of [{}, { destination: { kind: 'nowhere' } }]) {
      const res = await request.post('/api/pulsevault_reserve', {
        headers: { Authorization: `Bearer ${token}` },
        data,
      });
      expect(res.status()).toBe(500);
      expect((await res.json()).error).toBe('bad-request');
    }
  });

  test('reserve mints a videoid + capability token, and TUS create is authorized by it', async ({
    page,
    request,
  }) => {
    await loginAs(page, TEST_USERS.owner1);
    const token = await getSessionToken(page);

    const { videoid, uploadToken } = await reservePulseUpload(request, token, { kind: 'library' });
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
    const { videoid, uploadToken } = await reservePulseUpload(request, token, { kind: 'library' });

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
    const { videoid, uploadToken } = await reservePulseUpload(request, token, { kind: 'library' });

    await uploadVideoAsPulse(request, videoid, uploadToken);
    // Delivered just after the final PATCH is answered.
    expect(await waitForPulseOutcome(request, token, videoid)).toEqual({ state: 'done' });

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

  test('GET /pulsevault/artifacts/{id} serves the finished video, and DELETE is refused once it landed', async ({
    page,
    request,
  }) => {
    await loginAs(page, TEST_USERS.owner1);
    const token = await getSessionToken(page);
    const { videoid, uploadToken } = await reservePulseUpload(request, token, { kind: 'library' });
    await uploadVideoAsPulse(request, videoid, uploadToken);

    await expect
      .poll(async () => (await request.get(`/pulsevault/artifacts/${videoid}`)).status(), {
        timeout: 10000,
      })
      .toBe(200);

    const getArtifact = await request.get(`/pulsevault/artifacts/${videoid}`);
    expect(getArtifact.status()).toBe(200);
    expect(getArtifact.headers()['content-type']).toContain('video/mp4');

    // The upload's own capability token still authorizes a delete, but a
    // video that has landed is never deleted: whatever it was added to plays it.
    expect(await waitForPulseOutcome(request, token, videoid)).toEqual({ state: 'done' });
    const del = await request.delete(`/pulsevault/artifacts/${videoid}`, {
      headers: { Authorization: `Bearer ${uploadToken}` },
    });
    expect(del.status()).toBe(409);

    const getAfterDelete = await request.get(`/pulsevault/artifacts/${videoid}`);
    expect(getAfterDelete.status()).toBe(200);
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
  // Set by a test that deletes its ticket itself.
  let ticketDeleted = false;

  function buildTicketTitle(testInfo: TestInfo): string {
    const safeTitle = testInfo.title.replace(/[^a-z0-9]+/gi, '-').slice(0, 32);
    return `PulseVault E2E ${safeTitle} ${Date.now()} r${testInfo.retry}`;
  }

  test.beforeEach(async ({ page }, testInfo) => {
    ticketTitle = buildTicketTitle(testInfo);
    ticketDeleted = false;
    await loginAs(page, TEST_USERS.owner1);
    await createTicket(page, ticketTitle);
  });

  test.afterEach(async ({ page }) => {
    if (!ticketDeleted) await deleteTicket(page, ticketTitle);
  });

  test('the Pulse button opens the QR modal with a valid pulsecam deep link', async ({ page }) => {
    await openTicket(page, ticketTitle);

    await page.getByRole('button', { name: 'Add video with Pulse' }).click();

    const qrModal = page.getByRole('dialog', { name: 'Record with Pulse' });
    await expect(qrModal).toBeVisible({ timeout: 8000 });
    await expect(qrModal.getByLabel('QR code to open the Pulse upload screen')).toBeVisible();
  });

  test('pressing Pulse again while its link is live reopens it instead of minting another', async ({
    page,
  }) => {
    await openTicket(page, ticketTitle);

    let reserves = 0;
    page.on('request', (req) => {
      if (req.url().includes('/api/pulsevault_reserve')) reserves += 1;
    });
    const pulse = page.getByRole('button', { name: 'Add video with Pulse' });
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
    await openTicket(page, ticketTitle);

    await page.getByRole('button', { name: 'Add video with Pulse' }).click();

    const qrModal = page.getByRole('dialog', { name: 'Record with Pulse' });
    await expect(qrModal).toBeVisible({ timeout: 8000 });
    await expect(page.getByText('Upload from this device')).toHaveCount(0);
    await expect(page.locator('input[type="file"]')).toHaveCount(0);
  });

  test("a Pulse upload completes and plays in the ticket's attachments", async ({ page }) => {
    const { videoid, posterId } = await uploadVideoToTicket(page, ticketTitle);

    // Persisted (in Mongo), not just held in component state.
    await page.reload();
    const linksList = page.locator('ul[aria-label="Attached links"]');
    const play = linksList.getByRole('button', { name: /^Play / }).first();
    await expect(play).toBeVisible({ timeout: 8000 });
    // The poster is found by the video's id, and is the frame Pulse sent.
    expect(await posterLocation(page.request, videoid)).toContain(posterId);
    await expectImageLoaded(play.locator('img'));

    // Playing swaps the poster for an inline player on this video's artifact.
    await play.click();
    const player = linksList.locator(`video[src*="/pulsevault/artifacts/${videoid}"]`);
    await expect(player).toBeVisible();
    await expect(player).toBeFocused();
  });

  test('anyone attaching a video can’t choose its poster', async ({ page }) => {
    const { videoid } = await uploadVideoToTicket(page, ticketTitle);
    const ticketId = new URL(page.url()).pathname.split('/').pop()!;
    const before = await posterLocation(page.request, videoid);
    expect(before).not.toBeNull();

    // A client-sent thumbnail is ignored: the poster comes from PulseVault only.
    const token = await getSessionToken(page);
    const res = await page.request.post('/api/attachments_add', {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        url: `/pulsevault/artifacts/${videoid}`,
        type: 'video',
        thumbnail: '/pulsevault/artifacts/00000000-0000-4000-8000-000000000000',
        attachedTo: { kind: 'ticket', id: ticketId },
      },
    });
    if (res.ok()) expect((await res.json()).result.attachment.thumbnail).toBeNull();
    expect(await posterLocation(page.request, videoid)).toBe(before);
  });

  /** Press Pulse on the open ticket, as a person would; returns the link it handed out. */
  async function pressPulse(page: import('@playwright/test').Page) {
    const reserved = page.waitForResponse((res) => res.url().includes('/api/pulsevault_reserve'));
    await page.getByRole('button', { name: 'Add video with Pulse' }).click();
    const { result } = await (await reserved).json();
    return result as { videoid: string; uploadToken: string };
  }

  test('the open modal says when the video is added, and the list shows it', async ({ page }) => {
    await openTicket(page, ticketTitle);
    const { videoid, uploadToken } = await pressPulse(page);
    const modal = page.getByRole('dialog', { name: 'Record with Pulse' });
    await expect(modal).toBeVisible();

    await uploadVideoAsPulse(page.request, videoid, uploadToken);

    // The modal's own status check finds it — no reload.
    await expect(modal.getByText('Added', { exact: true })).toBeVisible({ timeout: 20000 });
    await expect(modal).toBeHidden({ timeout: 5000 });
    const linksList = page.locator('ul[aria-label="Attached links"]');
    await expect(linksList.getByRole('button', { name: /^Play / })).toHaveCount(1);
  });

  test('the open modal says when the video was kept instead — the ticket was deleted', async ({
    page,
  }) => {
    const ticketId = await openTicket(page, ticketTitle);
    const { videoid, uploadToken } = await pressPulse(page);
    const modal = page.getByRole('dialog', { name: 'Record with Pulse' });

    await markTicketDeleted(ticketId);
    ticketDeleted = true;
    await uploadVideoAsPulse(page.request, videoid, uploadToken);

    await expect(
      modal.getByText(
        "Couldn't add your video here. That ticket no longer exists. It's saved, not lost.",
      ),
    ).toBeVisible({ timeout: 20000 });
    // Kept, so it stays open until closed — and nothing was attached.
    await modal.getByRole('button', { name: 'Close' }).last().click();
    await expect(page.locator('ul[aria-label="Attached links"]').getByRole('button')).toHaveCount(
      0,
    );
  });
});
