/**
 * Shared setup for the Pulse specs that run against the fake Pulse
 * (`VITE_PULSE_FAKE=1`, src/features/pulse-embed/testAdapter.ts).
 */
import fs from 'node:fs';

import { expect, type Page } from '@playwright/test';

import { TEST_MP4, getSessionToken } from '../tickets/helpers';

/**
 * The browser the fake runs use: Google Chrome, not Playwright's bundled
 * Chromium, which has no H.264/AAC (the Pulse fixtures and the conformed
 * videos are MP4). An ordinary run keeps the config's browser, so CI's
 * browser-only case is unchanged.
 */
export const PULSE_FAKE_BROWSER =
  process.env.VITE_PULSE_FAKE === '1' ? ({ channel: 'chrome' } as const) : {};

/**
 * The fake's server mode: after Send it asks the page for an upload target
 * (`getUploadTarget` → the real `pulseUploads.begin`), uploads
 * tests/e2e/fixtures/test-video.mp4 over TUS to the target's `/pulsevault`
 * on the test backend, and polls the artifact's status until the server
 * records an outcome. Call after the spec's `__PULSE_FAKE_SCRIPT__` init
 * script and before the page loads.
 */
export async function uploadForReal(page: Page, { pollMs = 500 } = {}): Promise<void> {
  const fixture = fs.readFileSync(TEST_MP4).toString('base64');
  await page.addInitScript(
    ({ b64, poll }) => {
      const text = atob(b64);
      const bytes = new Uint8Array(text.length);
      for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
      const w = window as unknown as { __PULSE_FAKE_SCRIPT__?: Record<string, unknown> };
      w.__PULSE_FAKE_SCRIPT__ = {
        ...(w.__PULSE_FAKE_SCRIPT__ ?? {}),
        server: { fixture: bytes.buffer, pollMs: poll },
      };
    },
    { b64: fixture, poll: pollMs },
  );
}

/** The URLs of a ticket's attachments, as the server lists them. */
export async function ticketAttachmentUrls(page: Page, ticketId: string): Promise<string[]> {
  const token = await getSessionToken(page);
  const res = await page.request.post('/api/attachments_list', {
    headers: { Authorization: `Bearer ${token}` },
    data: { kind: 'ticket', id: ticketId },
  });
  expect(res.ok()).toBe(true);
  const { attachments } = (await res.json()).result as { attachments: { url: string }[] };
  return attachments.map((a) => a.url);
}
