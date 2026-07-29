import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getMobileOS,
  getStoreOS,
  isMobileBrowser,
  openPulseAppOrStore,
  PULSE_STORE_URLS,
} from './device';

// Capacitor is not native under jsdom, so isNativeApp() is false in these tests.

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
const MAC_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

function setUserAgent(ua: string, maxTouchPoints = 0): void {
  Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true });
  Object.defineProperty(navigator, 'maxTouchPoints', { value: maxTouchPoints, configurable: true });
}

describe('getMobileOS', () => {
  it('detects Android from the user agent', () => {
    setUserAgent(ANDROID_UA);
    expect(getMobileOS()).toBe('android');
  });

  it('detects iOS from an iPhone user agent', () => {
    setUserAgent(IPHONE_UA);
    expect(getMobileOS()).toBe('ios');
  });

  it('detects iPadOS (desktop-class UA) via touch support', () => {
    setUserAgent(MAC_UA, 5);
    expect(getMobileOS()).toBe('ios');
  });

  it('returns null for a non-touch desktop Mac', () => {
    setUserAgent(MAC_UA, 0);
    expect(getMobileOS()).toBeNull();
  });
});

describe('isMobileBrowser', () => {
  it('is true for a mobile UA in a browser context', () => {
    setUserAgent(ANDROID_UA);
    expect(isMobileBrowser()).toBe(true);
  });

  it('is false for a desktop UA', () => {
    setUserAgent(MAC_UA, 0);
    expect(isMobileBrowser()).toBe(false);
  });
});

describe('getStoreOS', () => {
  it('falls back to UA sniffing in a browser context (iOS)', () => {
    setUserAgent(IPHONE_UA);
    expect(getStoreOS()).toBe('ios');
  });

  it('falls back to UA sniffing in a browser context (Android)', () => {
    setUserAgent(ANDROID_UA);
    expect(getStoreOS()).toBe('android');
  });

  it('returns null on desktop (QR flow used instead)', () => {
    setUserAgent(MAC_UA, 0);
    expect(getStoreOS()).toBeNull();
  });
});

// openNativePulseOrStore relies on @capacitor/app's App.addListener bridging
// native iOS/Android lifecycle events — unit testing it in jsdom requires
// mocking the Capacitor bridge, which adds no signal beyond "the timer runs".
// Integration-test this on a real device instead.

describe('openPulseAppOrStore (browser)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.querySelectorAll('iframe').forEach((f) => f.remove());
  });

  it('triggers the deep link via a hidden iframe (no top-level navigation)', () => {
    const setHref = vi.fn();
    Object.defineProperty(window, 'location', {
      value: {
        set href(v: string) {
          setHref(v);
        },
      },
      configurable: true,
    });
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });

    openPulseAppOrStore('pulsecam://?v=1', 'ios', 1500);

    const iframe = document.querySelector('iframe');
    expect(iframe).not.toBeNull();
    expect(iframe?.getAttribute('src')).toBe('pulsecam://?v=1');
    // Must NOT navigate the top-level page to the scheme (that shows the alert).
    expect(setHref).not.toHaveBeenCalledWith('pulsecam://?v=1');
  });

  it('redirects to the store when the app does not open', () => {
    const setHref = vi.fn();
    Object.defineProperty(window, 'location', {
      value: {
        set href(v: string) {
          setHref(v);
        },
      },
      configurable: true,
    });
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });

    openPulseAppOrStore('pulsecam://?v=1', 'android', 1500);
    vi.advanceTimersByTime(1500);

    expect(setHref).toHaveBeenLastCalledWith(PULSE_STORE_URLS.android);
  });

  it('does not redirect to the store when the app opened (page hidden)', () => {
    const setHref = vi.fn();
    Object.defineProperty(window, 'location', {
      value: {
        set href(v: string) {
          setHref(v);
        },
      },
      configurable: true,
    });
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });

    openPulseAppOrStore('pulsecam://?v=1', 'ios', 1500);
    vi.advanceTimersByTime(1500);

    expect(setHref).not.toHaveBeenCalledWith(PULSE_STORE_URLS.ios);
  });

  it('still redirects to the store after a window blur (Safari "address invalid" alert)', () => {
    const setHref = vi.fn();
    Object.defineProperty(window, 'location', {
      value: {
        set href(v: string) {
          setHref(v);
        },
      },
      configurable: true,
    });
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });

    openPulseAppOrStore('pulsecam://?v=1', 'ios', 1500);
    // Safari shows a native alert (blurs window) but the page stays visible —
    // this must NOT cancel the fallback.
    window.dispatchEvent(new Event('blur'));
    vi.advanceTimersByTime(1500);

    expect(setHref).toHaveBeenLastCalledWith(PULSE_STORE_URLS.ios);
  });

  it('cancels the fallback when the page is truly hidden (visibilitychange)', () => {
    const setHref = vi.fn();
    Object.defineProperty(window, 'location', {
      value: {
        set href(v: string) {
          setHref(v);
        },
      },
      configurable: true,
    });
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });

    openPulseAppOrStore('pulsecam://?v=1', 'ios', 1500);
    // App opened → page backgrounds.
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(1500);

    expect(setHref).not.toHaveBeenCalledWith(PULSE_STORE_URLS.ios);
  });

  it('cancel() stops the store fallback', () => {
    const setHref = vi.fn();
    Object.defineProperty(window, 'location', {
      value: {
        set href(v: string) {
          setHref(v);
        },
      },
      configurable: true,
    });
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });

    const cancel = openPulseAppOrStore('pulsecam://?v=1', 'ios', 1500);
    cancel();
    vi.advanceTimersByTime(1500);

    expect(setHref).not.toHaveBeenCalledWith(PULSE_STORE_URLS.ios);
  });
});
