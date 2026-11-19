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

/** The fake's own host id and account, the namespace its seeded drafts are in. */
const FAKE_HOST_ID = 'fake.host';
const FAKE_ACCOUNT = { serverOrigin: 'https://host.fake', userId: 'fake-user' };

/**
 * Lets the page see the drafts a spec seeds through
 * `__PULSE_FAKE_SCRIPT__.drafts`.
 *
 * The fake puts seeded drafts in the namespace of its default host id and
 * account (`fake.host` + FAKE_ACCOUNT), but TimeHuddle configures its own host
 * id (`com.mieweb.timehuddle`) and binds the signed-in person, so the page
 * would read an empty namespace and never list them. Until the fake seeds into
 * the namespace the host binds, the page's `configure` and `setAccount` calls
 * are pointed at the seed namespace here. A sign-out (`setAccount` with no
 * user) passes through unchanged. Call before the page loads.
 */
export async function reachSeededDrafts(page: Page): Promise<void> {
  await page.addInitScript(
    ({ hostId, account }) => {
      type Call = (method: string, args: unknown, callId?: string) => Promise<unknown>;
      type Adapter = { call: Call } & Record<string, unknown>;
      let installed: Adapter | undefined;
      Object.defineProperty(window, '__PULSE_ADAPTER__', {
        configurable: true,
        get: () => installed,
        set(adapter: Adapter | undefined) {
          if (!adapter) {
            installed = adapter;
            return;
          }
          installed = {
            ...adapter,
            call(method, args, callId) {
              const a = (args ?? null) as Record<string, unknown> | null;
              let routed: unknown = args;
              if (method === 'configure' && a) routed = { ...a, hostId };
              if (method === 'setAccount' && a && typeof a.userId === 'string') {
                routed = { ...a, ...account };
              }
              return adapter.call(method, routed, callId);
            },
          };
        },
      });
    },
    { hostId: FAKE_HOST_ID, account: FAKE_ACCOUNT },
  );
}

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
        // The fake's default is the bare global `fetch`, which it then calls
        // as a method of its own request object; a browser refuses that
        // ("Illegal invocation"), so it gets one bound to the window.
        server: {
          fixture: bytes.buffer,
          pollMs: poll,
          fetch: (url: string, init: RequestInit) => window.fetch(url, init),
        },
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
