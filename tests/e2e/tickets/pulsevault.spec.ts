/**
 * PulseVault E2E Tests
 *
 * Verifies the @mieweb/pulsevault-backed video upload path on the Meteor
 * backend (meteor-backend/server/pulsevault.js):
 *  1. API-level contract — capabilities discovery, the Wormhole-exposed
 *     methods (reserve, getVideo, listVideos), the full
 *     raw TUS surface (POST/PATCH/HEAD/DELETE upload, GET/DELETE artifact),
 *     and the standalone /pulsevault/docs Swagger page.
 *  2. Ticket video upload flow — the Pulse chip's QR modal, and a video sent
 *     through a ticket's link landing in its Attachments list.
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { MongoClient, ObjectId } from 'mongodb';
import { expect, test, type APIRequestContext, type TestInfo } from '@playwright/test';
import { getTeamIdByCode } from '../fixtures/team';
import { TEST_USERS, loginAs } from '../fixtures/users';
import {
  createTicket,
  deleteTicket,
  getSessionToken,
  reservePulseUpload,
  uploadRealVideoViaApi,
  uploadVideoToTicket,
  TEST_MP4,
} from './helpers';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const reserveLibraryUpload = (request: APIRequestContext, token: string) =>
  reservePulseUpload(request, token, { kind: 'library' });

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
const MONGO_URL =
  process.env.MONGO_URL ?? 'mongodb://127.0.0.1:27017/timehuddle_test?replicaSet=rs0';
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

  test('the Pulse chip opens the QR modal with a valid pulsecam deep link', async ({ page }) => {
    await page.getByRole('button', { name: ticketTitle, exact: true }).first().click();
    await page.waitForTimeout(600);

    await page.getByRole('button', { name: 'Add a video with Pulse' }).click();

    const qrModal = page.locator('[aria-label="Record a video with Pulse"]');
    await expect(qrModal).toBeVisible({ timeout: 8000 });

    const qr = qrModal.locator('[aria-label="QR code to open the Pulse upload screen"]');
    await expect(qr).toBeVisible();
  });

  test("a video sent through the ticket's link lands in its Attachments", async ({ page }) => {
    await uploadVideoToTicket(page, ticketTitle);
  });
});

// ─── A pulse's related files (thumbnail, beat manifest, captions) ─────────────

test.describe('PulseVault — delivery to a destination', () => {
  test('a ticket deleted while its video uploads is kept, not attached', async ({
    page,
    request,
  }) => {
    await loginAs(page, TEST_USERS.owner1);
    const auth = { Authorization: `Bearer ${await getSessionToken(page)}` };
    const created = await request.post('/api/tickets_create', {
      headers: auth,
      data: {
        teamId: await getTeamIdByCode('TEST01'),
        title: `Pulse kept ${randomUUID().slice(0, 8)}`,
      },
    });
    expect(created.status()).toBe(200);
    const ticketId: string = (await created.json()).result.id;

    const reserved = await request.post('/api/pulsevault_reserve', {
      headers: auth,
      data: { destination: { kind: 'ticket', id: ticketId } },
    });
    expect(reserved.status()).toBe(200);
    const { videoid, uploadToken } = (await reserved.json()).result;

    // The destination goes away between the link and the last byte.
    const deleted = await request.post('/api/tickets_delete', {
      headers: auth,
      data: { ticketId },
    });
    expect(deleted.status()).toBe(200);
    await uploadRealVideoViaApi(request, videoid, uploadToken);

    // The backend records why instead of attaching to a ticket that is gone.
    await expect
      .poll(
        async () => {
          const res = await request.get(`/pulsevault/artifacts/${videoid}/status`, {
            headers: { Authorization: `Bearer ${uploadToken}` },
          });
          return res.ok() ? ((await res.json()).outcome ?? null) : null;
        },
        { timeout: 20000 },
      )
      .toMatchObject({ state: 'kept', reason: expect.stringContaining('Ticket not found') });
    const list = await request.post('/api/attachments_list', {
      headers: auth,
      data: { kind: 'ticket', id: ticketId },
    });
    expect((await list.json()).result.attachments).toEqual([]);
  });
});

test.describe('PulseVault — delivery to a clock session', () => {
  test.setTimeout(90000);

  /** Clock in to the shared team over REST: the open session's id. */
  async function clockIn(request: APIRequestContext, auth: Record<string, string>) {
    const teamId = await getTeamIdByCode('TEST01');
    const res = await request.post('/api/clock_start', { headers: auth, data: { teamId } });
    expect(res.status()).toBe(200);
    return { teamId, sessionId: (await res.json()).result.id as string };
  }

  test("a video for your own session is attached to it; another person's session is refused, unread", async ({
    browser,
  }) => {
    const owner = await (await browser.newContext()).newPage();
    await loginAs(owner, TEST_USERS.owner1);
    const auth = { Authorization: `Bearer ${await getSessionToken(owner)}` };
    const { teamId, sessionId } = await clockIn(owner.request, auth);

    try {
      // The uploader's own session: reserved, uploaded, attached.
      const { videoid, uploadToken } = await reservePulseUpload(
        owner.request,
        auth.Authorization.slice(7),
        {
          kind: 'clock',
          id: sessionId,
        },
      );
      await uploadRealVideoViaApi(owner.request, videoid, uploadToken);
      await expect
        .poll(
          async () => {
            const res = await owner.request.post('/api/attachments_list', {
              headers: auth,
              data: { kind: 'clock', id: sessionId },
            });
            const { attachments } = (await res.json()).result as { attachments: { url: string }[] };
            return attachments.some((a) => a.url.includes(videoid));
          },
          { timeout: 30000 },
        )
        .toBe(true);

      // Someone else's session: no link is minted for it, and its attachments
      // can't be read either.
      const other = await (await browser.newContext()).newPage();
      await loginAs(other, TEST_USERS.member1);
      const otherAuth = { Authorization: `Bearer ${await getSessionToken(other)}` };
      const refused = await other.request.post('/api/pulsevault_reserve', {
        headers: otherAuth,
        data: { destination: { kind: 'clock', id: sessionId } },
      });
      expect(refused.status()).toBe(500);
      expect((await refused.json()).error).toBe('forbidden');
      const hidden = await other.request.post('/api/attachments_list', {
        headers: otherAuth,
        data: { kind: 'clock', id: sessionId },
      });
      expect(hidden.status()).toBe(500);
      expect((await hidden.json()).error).toBe('forbidden');
    } finally {
      await owner.request.post('/api/clock_stop', { headers: auth, data: { teamId } });
    }
  });

  test('a session deleted while its video uploads is kept, not attached', async ({
    page,
    request,
  }) => {
    await loginAs(page, TEST_USERS.owner1);
    const token = await getSessionToken(page);
    const auth = { Authorization: `Bearer ${token}` };
    const { sessionId } = await clockIn(request, auth);
    const { videoid, uploadToken } = await reservePulseUpload(request, token, {
      kind: 'clock',
      id: sessionId,
    });

    // The session goes away between the link and the last byte.
    const client = await MongoClient.connect(MONGO_URL);
    try {
      await client
        .db()
        .collection('clockevents')
        .deleteOne({ _id: new ObjectId(sessionId) });
    } finally {
      await client.close();
    }
    await uploadRealVideoViaApi(request, videoid, uploadToken);

    await expect
      .poll(
        async () => {
          const res = await request.get(`/pulsevault/artifacts/${videoid}/status`, {
            headers: { Authorization: `Bearer ${uploadToken}` },
          });
          return res.ok() ? ((await res.json()).outcome ?? null) : null;
        },
        { timeout: 20000 },
      )
      .toMatchObject({ state: 'kept', reason: expect.stringContaining('Clock session not found') });
    // Nothing was attached to a session that no longer exists (its listing
    // is refused now, so look at the record itself).
    const db = await MongoClient.connect(MONGO_URL);
    try {
      expect(
        await db.db().collection('attachments').countDocuments({ 'attachedTo.id': sessionId }),
      ).toBe(0);
    } finally {
      await db.close();
    }
  });
});

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
