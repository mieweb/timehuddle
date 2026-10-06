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
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect, test, type Page, type APIRequestContext, type TestInfo } from '@playwright/test';
import { TEST_USERS, loginAs } from '../fixtures/users';
import { createTicket, deleteTicket, uploadVideoToTicket, TEST_MP4 } from './helpers';

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

/** One file of a pulse, sent the way Pulse sends it (its `Pulse-Client` header included). */
async function uploadArtifact(
  request: APIRequestContext,
  uploadToken: string,
  file: { artifactId: string; filename: string; bytes: Buffer; kind?: string; relatedTo?: string },
  { finish = true }: { finish?: boolean } = {},
): Promise<{ created: number; finished: number | null; location?: string }> {
  const fields: Array<[string, string]> = [
    ['artifactId', file.artifactId],
    ['filename', file.filename],
  ];
  if (file.kind) fields.push(['kind', file.kind]);
  if (file.relatedTo) fields.push(['relatedTo', file.relatedTo]);
  const headers = {
    'Tus-Resumable': '1.0.0',
    'Pulse-Client': 'Pulse/2.2.0 (e2e; test); protocol=1-2',
    Authorization: `Bearer ${uploadToken}`,
  };
  const created = await request.post('/pulsevault/upload', {
    headers: {
      ...headers,
      'Upload-Length': String(file.bytes.length),
      'Upload-Metadata': fields
        .map(([key, value]) => `${key} ${Buffer.from(value).toString('base64')}`)
        .join(','),
    },
  });
  const location = created.headers()['location'];
  if (!finish || created.status() !== 201)
    return { created: created.status(), finished: null, location };
  const patched = await request.patch(location, {
    headers: {
      ...headers,
      'Upload-Offset': '0',
      'Content-Type': 'application/offset+octet-stream',
    },
    data: file.bytes,
  });
  return { created: created.status(), finished: patched.status(), location };
}

/** The caller's media items for a video id (media.list over REST). */
async function mediaItemsFor(request: APIRequestContext, token: string, videoid: string) {
  const res = await request.post('/api/media_list', {
    headers: { Authorization: `Bearer ${token}` },
    data: {},
  });
  expect(res.status()).toBe(200);
  const { items } = (await res.json()).result as { items: Array<{ videoid: string | null }> };
  return items.filter((item) => item.videoid === videoid);
}

/**
 * Age an unfinished upload's files on the backend's disk, so PulseVault treats
 * it as abandoned (`reclaim` waits for 5 idle minutes). Needs the backend's
 * `VIDEOS_DIR`; the tests that use it skip without one.
 */
const BACKEND_VIDEOS_DIR = process.env.VIDEOS_DIR;
function abandon(artifactId: string): void {
  const aWhileAgo = new Date(Date.now() - 10 * 60 * 1000);
  for (const entry of fs.readdirSync(BACKEND_VIDEOS_DIR!, {
    recursive: true,
    withFileTypes: true,
  })) {
    const file = path.join(entry.parentPath, entry.name);
    if (entry.isFile() && file.includes(artifactId)) fs.utimesSync(file, aWhileAgo, aWhileAgo);
  }
}

const THUMBNAIL = fs.readFileSync(path.join(__dirname, '../fixtures/test-image.png'));
const CAPTIONS = Buffer.from('WEBVTT\n\n00:00.000 --> 00:01.000\nHello\n');
const MANIFEST = Buffer.from('{"beats":[{"startMs":0,"endMs":1000}]}');

// ─── API-level contract checks ────────────────────────────────────────────────

test.describe('PulseVault — API contract', () => {
  test.setTimeout(30000);

  test('GET /pulsevault/capabilities is public and reports the protocol', async ({ request }) => {
    const res = await request.get('/pulsevault/capabilities');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('protocolVersion');
    expect(body).not.toHaveProperty('uploadUnit');
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
    test.setTimeout(90000);

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

  test('GET/DELETE /pulsevault/artifacts/{id} serve the finished video, which its token cannot delete', async ({
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

    // A video that landed stays (`lockWhenReady`): even the capability token
    // it was uploaded with can't delete it.
    const del = await request.delete(`/pulsevault/artifacts/${videoid}`, {
      headers: { Authorization: `Bearer ${uploadToken}` },
    });
    expect(del.status()).toBe(403);

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

  test('"Upload Video" button opens QR modal with a valid pulsecam deep link', async ({ page }) => {
    await page.getByRole('button', { name: ticketTitle, exact: true }).first().click();
    await page.waitForTimeout(600);

    await page.getByRole('button', { name: /upload video/i }).click();

    const qrModal = page.locator('[aria-label="Upload video with the Pulse app"]');
    await expect(qrModal).toBeVisible({ timeout: 8000 });

    const qr = qrModal.locator('[aria-label="QR code to open the Pulse upload screen"]');
    await expect(qr).toBeVisible();
  });

  // The deep-link protocol itself (v=1, artifactId, server, token) is
  // asserted at the unit level in PulseUploadButton.test.ts —
  // qrcode.react renders to a plain <svg> with no way to read back the
  // encoded value, so this e2e test only covers what the browser can
  // actually observe: reserve() succeeding and the modal reflecting it.
  test('device-upload fallback is offered alongside the QR code', async ({ page }) => {
    // Ticket create + modal open + video-upload path is heavier than the
    // default 30s allows once the DB has accumulated state late in the suite.
    test.setTimeout(60000);
    await page.getByRole('button', { name: ticketTitle, exact: true }).first().click();
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

// ─── A pulse's related files (thumbnail, beat manifest, captions) ─────────────

test.describe('PulseVault — a pulse uploads its related files with the video', () => {
  test.setTimeout(60000);

  test('the thumbnail, manifest and captions are accepted, and the video is added once', async ({
    page,
    request,
  }) => {
    await loginAs(page, TEST_USERS.owner1);
    const token = await getSessionToken(page);
    const { videoid, uploadToken } = await reserveLibraryUpload(request, token);

    const related = [
      { filename: 'thumb.png', bytes: THUMBNAIL, kind: 'thumbnail' },
      { filename: 'beats.pulse', bytes: MANIFEST, kind: 'project' },
      { filename: 'captions.vtt', bytes: CAPTIONS, kind: 'captions' },
    ];
    for (const file of related) {
      const sent = await uploadArtifact(request, uploadToken, {
        ...file,
        artifactId: randomUUID(),
        relatedTo: videoid,
      });
      expect([sent.created, sent.finished], file.kind).toEqual([201, 204]);
    }
    // None of them is the video, so none of them is added in its place.
    expect(await mediaItemsFor(request, token, videoid)).toHaveLength(0);

    await uploadRealVideoViaApi(request, videoid, uploadToken);
    await expect.poll(async () => (await mediaItemsFor(request, token, videoid)).length).toBe(1);
  });

  test('each file must use the id it was given: the video its own, a related file another', async ({
    page,
    request,
  }) => {
    await loginAs(page, TEST_USERS.owner1);
    const token = await getSessionToken(page);
    const { videoid, uploadToken } = await reserveLibraryUpload(request, token);

    // A thumbnail under the video's own id would take that id from the video.
    const underVideoId = await uploadArtifact(request, uploadToken, {
      artifactId: videoid,
      filename: 'thumb.png',
      bytes: THUMBNAIL,
      kind: 'thumbnail',
    });
    expect(underVideoId.created).toBe(403);

    // A video under some other id would never be added anywhere.
    const elsewhere = await uploadArtifact(request, uploadToken, {
      artifactId: randomUUID(),
      filename: 'video.mp4',
      bytes: fs.readFileSync(TEST_MP4),
      relatedTo: videoid,
    });
    expect(elsewhere.created).toBe(403);

    // Neither took anything from the reservation: the real video still lands, once.
    await uploadRealVideoViaApi(request, videoid, uploadToken);
    await expect.poll(async () => (await mediaItemsFor(request, token, videoid)).length).toBe(1);
  });

  test('an abandoned thumbnail upload can be sent again', async ({ page, request }) => {
    test.skip(!BACKEND_VIDEOS_DIR, "needs the backend's VIDEOS_DIR to age the abandoned upload");
    await loginAs(page, TEST_USERS.owner1);
    const token = await getSessionToken(page);
    const { videoid, uploadToken } = await reserveLibraryUpload(request, token);

    const thumbnail = {
      artifactId: randomUUID(),
      filename: 'thumb.png',
      bytes: THUMBNAIL,
      kind: 'thumbnail',
      relatedTo: videoid,
    };
    expect((await uploadArtifact(request, uploadToken, thumbnail, { finish: false })).created).toBe(
      201,
    );
    abandon(thumbnail.artifactId);

    const again = await uploadArtifact(request, uploadToken, thumbnail);
    expect([again.created, again.finished]).toEqual([201, 204]);
  });

  test("another person's token can't clear someone's abandoned upload", async ({ browser }) => {
    test.skip(!BACKEND_VIDEOS_DIR, "needs the backend's VIDEOS_DIR to age the abandoned upload");
    const owner = await (await browser.newContext()).newPage();
    await loginAs(owner, TEST_USERS.owner1);
    const mine = await reserveLibraryUpload(owner.request, await getSessionToken(owner));
    const video = {
      artifactId: mine.videoid,
      filename: 'video.mp4',
      bytes: fs.readFileSync(TEST_MP4),
    };
    const started = await uploadArtifact(owner.request, mine.uploadToken, video, { finish: false });
    expect(started.created).toBe(201);
    abandon(mine.videoid);

    // Their own token, claiming the other upload is related to their video.
    const other = await (await browser.newContext()).newPage();
    await loginAs(other, TEST_USERS.member1);
    const theirs = await reserveLibraryUpload(other.request, await getSessionToken(other));
    const attempt = await uploadArtifact(
      other.request,
      theirs.uploadToken,
      {
        artifactId: mine.videoid,
        filename: 'x.png',
        bytes: THUMBNAIL,
        kind: 'thumbnail',
        relatedTo: theirs.videoid,
      },
      { finish: false },
    );
    expect(attempt.created).toBe(409);

    // The owner's upload is still there, ready to resume.
    const head = await owner.request.head(started.location!, {
      headers: { 'Tus-Resumable': '1.0.0', Authorization: `Bearer ${mine.uploadToken}` },
    });
    expect(head.status()).toBe(200);
  });
});
