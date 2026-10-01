/**
 * Pulse uploads for E2E tests, done exactly the way the Pulse app does them
 * after scanning a QR code: reserve a destination, then a TUS upload carrying
 * `Pulse-Client`. The camera scan is the one step that isn't automatable, and
 * the web app has no upload of its own (videos come from Pulse only).
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';

export const TEST_MP4 = path.join(__dirname, 'test-video.mp4');
/** Stands in for the poster frame Pulse uploads with every video. */
export const TEST_POSTER = path.join(__dirname, 'test-image.png');

/**
 * What Pulse 2.1+ sends on every request (PROTOCOL.md §7.2). The backend only
 * lets a new upload in when it's there — see `authorize` in pulsevault.js.
 */
export const PULSE_CLIENT_HEADER = { 'Pulse-Client': 'Pulse/2.2.0 (e2e; test); protocol=1-2' };

/** Where a Pulse upload goes — see meteor-backend/server/pulse-destinations.js. */
export type PulseDestination = { kind: string } & Record<string, string>;

export interface PulseStatus {
  state: 'waiting' | 'done' | 'kept' | 'expired';
  reason?: string;
  note?: string;
}

/** The signed-in page's Meteor resume token, once its DDP session is up. */
export async function getSessionToken(page: Page): Promise<string> {
  // `meteor_resume_token` is the real Meteor-auth key getAccessToken() reads
  // (src/lib/api.ts). It lands in localStorage once the app's DDP client
  // finishes resuming its session, slightly after loginAs()'s redirect — poll
  // briefly instead of racing it.
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('meteor_resume_token')), {
      timeout: 10000,
    })
    .toBeTruthy();
  return (await page.evaluate(() => localStorage.getItem('meteor_resume_token'))) as string;
}

/** Call a Meteor method over the REST bridge, returning its result. */
async function callMethod<T>(
  request: APIRequestContext,
  token: string,
  method: string,
  data: object,
): Promise<T> {
  const res = await request.post(`/api/${method}`, {
    headers: { Authorization: `Bearer ${token}` },
    data,
  });
  expect(res.status(), await res.text()).toBe(200);
  // Wormhole's REST bridge wraps every method's return value as { result }.
  return (await res.json()).result;
}

/** Reserve a Pulse upload for `destination`, the way the app's Pulse buttons do. */
export function reservePulseUpload(
  request: APIRequestContext,
  token: string,
  destination: PulseDestination,
): Promise<{ videoid: string; uploadToken: string }> {
  return callMethod(request, token, 'pulsevault_reserve', { destination });
}

/** Where a Pulse upload stands, as the Pulse popup asks for it. */
export function pulseStatus(
  request: APIRequestContext,
  token: string,
  videoid: string,
): Promise<PulseStatus> {
  return callMethod(request, token, 'pulsevault_status', { videoid });
}

/**
 * Full TUS create + single-chunk PATCH of `file`, as the Pulse app sends it
 * (`Pulse-Client` header included). `kind` and `relatedTo` mark a companion
 * artifact (a thumbnail, say) of the video the token was minted for. Returns
 * once the upload is complete (Upload-Offset === file size).
 */
export async function uploadAsPulse(
  request: APIRequestContext,
  {
    artifactId,
    uploadToken,
    file,
    kind,
    relatedTo,
  }: { artifactId: string; uploadToken: string; file: string; kind?: string; relatedTo?: string },
): Promise<void> {
  const bytes = fs.readFileSync(file);
  const fields: Record<string, string | undefined> = {
    artifactId,
    filename: path.basename(file),
    kind,
    relatedTo,
  };
  const metadata = Object.entries(fields)
    .filter(([, value]) => value)
    .map(([key, value]) => `${key} ${Buffer.from(value!).toString('base64')}`)
    .join(',');

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
  expect(location).toBeTruthy();

  const patched = await request.patch(location, {
    headers: {
      ...PULSE_CLIENT_HEADER,
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

/**
 * Upload the real test-video.mp4 fixture as the reserved Pulse video. The
 * server delivers it just after — see {@link waitForPulseOutcome}.
 */
export function uploadVideoAsPulse(
  request: APIRequestContext,
  videoid: string,
  uploadToken: string,
): Promise<void> {
  return uploadAsPulse(request, { artifactId: videoid, uploadToken, file: TEST_MP4 });
}

/** Upload a poster frame for a reserved video, as Pulse does; returns its id. */
export async function uploadPosterAsPulse(
  request: APIRequestContext,
  videoid: string,
  uploadToken: string,
): Promise<string> {
  const posterId = randomUUID();
  await uploadAsPulse(request, {
    artifactId: posterId,
    uploadToken,
    file: TEST_POSTER,
    kind: 'thumbnail',
    relatedTo: videoid,
  });
  return posterId;
}

/** Where `GET /pulsevault/posters/:videoid` sends the browser, or null on 404. */
export async function posterLocation(
  request: APIRequestContext,
  videoid: string,
): Promise<string | null> {
  const res = await request.get(`/pulsevault/posters/${videoid}`, { maxRedirects: 0 });
  if (res.status() === 404) return null;
  expect(res.status()).toBe(302);
  return res.headers()['location'] ?? null;
}

/** Wait until an `<img>` has actually loaded (a poster, not the fallback box). */
export async function expectImageLoaded(img: Locator): Promise<void> {
  await expect
    .poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0), {
      timeout: 10000,
    })
    .toBe(true);
}

/** Wait until the server has delivered (or kept) an upload; returns where it went. */
export async function waitForPulseOutcome(
  request: APIRequestContext,
  token: string,
  videoid: string,
): Promise<PulseStatus> {
  let status: PulseStatus = { state: 'waiting' };
  await expect
    .poll(
      async () => {
        status = await pulseStatus(request, token, videoid);
        return status.state;
      },
      { timeout: 20000 },
    )
    .not.toBe('waiting');
  return status;
}

/**
 * Reserve, upload as Pulse — its poster frame first, as Pulse sends it — and
 * wait for the outcome: one Pulse video, start to end.
 */
export async function sendPulseVideo(
  request: APIRequestContext,
  token: string,
  destination: PulseDestination,
): Promise<{ videoid: string; posterId: string; status: PulseStatus }> {
  const { videoid, uploadToken } = await reservePulseUpload(request, token, destination);
  const posterId = await uploadPosterAsPulse(request, videoid, uploadToken);
  await uploadVideoAsPulse(request, videoid, uploadToken);
  return { videoid, posterId, status: await waitForPulseOutcome(request, token, videoid) };
}
