/**
 * Pulse uploads for E2E tests, done exactly the way the Pulse app does them
 * after scanning a QR code: reserve a destination, then a TUS upload carrying
 * `Pulse-Client`. The camera scan is the one step that isn't automatable, and
 * the web app has no upload of its own (videos come from Pulse only).
 */
import fs from 'node:fs';
import path from 'node:path';
import { expect, type APIRequestContext, type Page } from '@playwright/test';

export const TEST_MP4 = path.join(__dirname, 'test-video.mp4');

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
 * Full TUS create + single-chunk PATCH of the real test-video.mp4 fixture, as
 * the Pulse app sends it (`Pulse-Client` header included). Returns once the
 * upload is complete (Upload-Offset === file size); the server delivers it
 * just after — see {@link waitForPulseOutcome}.
 */
export async function uploadVideoAsPulse(
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

/** Reserve, upload as Pulse, and wait for the outcome: one Pulse video, start to end. */
export async function sendPulseVideo(
  request: APIRequestContext,
  token: string,
  destination: PulseDestination,
): Promise<{ videoid: string; status: PulseStatus }> {
  const { videoid, uploadToken } = await reservePulseUpload(request, token, destination);
  await uploadVideoAsPulse(request, videoid, uploadToken);
  return { videoid, status: await waitForPulseOutcome(request, token, videoid) };
}
