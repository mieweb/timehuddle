/**
 * A test build's Pulse (`VITE_PULSE_FAKE=1`, Playwright and local dev): the
 * scripted in-memory Pulse from @mieweb/pulse-embed/testing stands in for the
 * native plugin, so the pages run unchanged in a browser. It is installed as
 * `window.__PULSE_ADAPTER__` before the page's first `getPulse()`, which is
 * the adapter the client then picks (native-bridge.md §7.3).
 *
 * A Playwright spec scripts it before the page loads, through
 * `window.__PULSE_FAKE_SCRIPT__` (a FakeScript: flows, seeded drafts, info),
 * and drives it afterwards through `window.__PULSE_FAKE__` (setOnline,
 * transition, drafts(), hostRequests). The spec must not touch
 * `__PULSE_FAKE__.client`: it would become a second subscriber.
 *
 * In any other build the flag is unset and this loads nothing.
 */
import type { FakePulseHandle, FakeScript } from '@mieweb/pulse-embed/testing';

declare global {
  interface Window {
    /** Set by a Playwright init script: how the fake behaves. */
    __PULSE_FAKE_SCRIPT__?: FakeScript;
    /** The installed fake, for a spec to drive. */
    __PULSE_FAKE__?: FakePulseHandle;
  }
}

/** Whether this build runs Pulse against the fake. */
export function pulseFakeEnabled(): boolean {
  return import.meta.env.VITE_PULSE_FAKE === '1';
}

let installing: Promise<boolean> | null = null;

/**
 * Installs the fake as the page's Pulse adapter, once, in a fake build.
 * Resolves true when the fake is (now) the adapter; false in any other build.
 */
export function installTestAdapter(): Promise<boolean> {
  if (!pulseFakeEnabled() || typeof window === 'undefined') return Promise.resolve(false);
  installing ??= (async () => {
    if (window.__PULSE_ADAPTER__) return true;
    const { createFakePulse } = await import('@mieweb/pulse-embed/testing');
    const fake = createFakePulse(window.__PULSE_FAKE_SCRIPT__ ?? { flows: [{ result: 'sent' }] });
    window.__PULSE_ADAPTER__ = fake.adapter;
    window.__PULSE_FAKE__ = fake;
    return true;
  })().catch((error) => {
    console.error('[pulse-embed] installing the test Pulse failed:', error);
    installing = null;
    return false;
  });
  return installing;
}
