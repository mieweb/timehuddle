import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Capacitor } from '@capacitor/core';

// Mocked so `openNativePulseOrStore`'s dynamic `import('@capacitor/app-launcher')`
// resolves to a controllable stub instead of the real native bridge.
const canOpenUrl = vi.fn();
const openUrl = vi.fn();
vi.mock('@capacitor/app-launcher', () => ({
  AppLauncher: {
    canOpenUrl: (...args: unknown[]) => canOpenUrl(...args),
    openUrl: (...args: unknown[]) => openUrl(...args),
  },
}));

import {
  buildAndroidIntentLink,
  getMobileOS,
  getStoreOS,
  isMobileBrowser,
  openNativePulseOrStore,
  openPulseAppOrStore,
  PULSE_STORE_URLS,
} from './device';

// Capacitor is not native under jsdom, so isNativeApp() is false in these tests
// unless `Capacitor.isNativePlatform`/`getPlatform` are stubbed for a specific test.

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

  it('is authoritative from Capacitor.getPlatform() in the native shell (ios)', () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('ios');
    // UA says Android, but native platform must win.
    setUserAgent(ANDROID_UA);
    expect(getStoreOS()).toBe('ios');
  });

  it('is authoritative from Capacitor.getPlatform() in the native shell (android)', () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('android');
    setUserAgent(IPHONE_UA);
    expect(getStoreOS()).toBe('android');
  });
});

describe('openNativePulseOrStore (Capacitor native shell)', () => {
  beforeEach(() => {
    canOpenUrl.mockReset();
    openUrl.mockReset();
  });

  it('opens the pulsecam:// deep link when Pulse Cam is installed', async () => {
    canOpenUrl.mockResolvedValue({ value: true });
    openUrl.mockResolvedValue(undefined);

    await openNativePulseOrStore('pulsecam://open?ticket=123', 'ios');

    expect(canOpenUrl).toHaveBeenCalledWith({ url: 'pulsecam://' });
    expect(openUrl).toHaveBeenCalledWith({ url: 'pulsecam://open?ticket=123' });
    expect(openUrl).not.toHaveBeenCalledWith({ url: PULSE_STORE_URLS.ios });
  });

  it('opens the App Store when Pulse Cam is not installed (iOS)', async () => {
    canOpenUrl.mockResolvedValue({ value: false });
    openUrl.mockResolvedValue(undefined);

    await openNativePulseOrStore('pulsecam://open?ticket=123', 'ios');

    expect(openUrl).toHaveBeenCalledWith({ url: PULSE_STORE_URLS.ios });
    expect(openUrl).not.toHaveBeenCalledWith({ url: 'pulsecam://open?ticket=123' });
  });

  it('opens the Play Store when Pulse Cam is not installed (Android)', async () => {
    canOpenUrl.mockResolvedValue({ value: false });
    openUrl.mockResolvedValue(undefined);

    await openNativePulseOrStore('pulsecam://open?ticket=123', 'android');

    expect(openUrl).toHaveBeenCalledWith({ url: PULSE_STORE_URLS.android });
  });

  it('falls back to the store when canOpenUrl itself rejects (query scheme not declared / OS error)', async () => {
    canOpenUrl.mockRejectedValue(new Error('LSApplicationQueriesSchemes missing'));
    openUrl.mockResolvedValue(undefined);

    await openNativePulseOrStore('pulsecam://open?ticket=123', 'ios');

    expect(openUrl).toHaveBeenCalledWith({ url: PULSE_STORE_URLS.ios });
  });
});

describe('buildAndroidIntentLink', () => {
  it('carries the upload session into the intent URL and the Play Store fallback', () => {
    const link = buildAndroidIntentLink('pulsecam://?v=1&artifactId=abc&token=tok');

    expect(link.startsWith('intent://?v=1&artifactId=abc&token=tok#Intent;')).toBe(true);
    expect(link).toContain('scheme=pulsecam;');
    expect(link).toContain('package=com.mieweb.pulse;');
    expect(link).toContain(
      `S.browser_fallback_url=${encodeURIComponent(PULSE_STORE_URLS.android)};end`,
    );
  });
});

describe('openPulseAppOrStore (browser)', () => {
  beforeEach(() => {
    // Clears any Capacitor spy leaked by an earlier suite — a stale
    // isNativePlatform()=true would route navigation through window.open.
    vi.restoreAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.querySelectorAll('iframe').forEach((f) => f.remove());
  });

  it('opens the deep link with a top-level navigation so an installed app wins', () => {
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

    expect(setHref).toHaveBeenCalledWith('pulsecam://?v=1');
    // A hidden iframe is silently blocked by WebKit — it must not be used.
    expect(document.querySelector('iframe')).toBeNull();
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

    openPulseAppOrStore('pulsecam://?v=1', 'ios', 1500);
    vi.advanceTimersByTime(1500);

    expect(setHref).toHaveBeenLastCalledWith(PULSE_STORE_URLS.ios);
  });

  it('hands Android a single intent:// navigation with a Play Store fallback', () => {
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

    // Chrome resolves app-or-store itself, so there is no timed store redirect.
    expect(setHref).toHaveBeenCalledTimes(1);
    expect(setHref).toHaveBeenCalledWith(buildAndroidIntentLink('pulsecam://?v=1'));
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

  it('redirects to the store once Safari\'s "address invalid" alert is dismissed', () => {
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
    // The alert blurs the window but the page stays visible.
    window.dispatchEvent(new Event('blur'));
    vi.advanceTimersByTime(1500);
    // Nothing yet — Pulse Cam could still be launching.
    expect(setHref).not.toHaveBeenCalledWith(PULSE_STORE_URLS.ios);

    vi.advanceTimersByTime(800);
    window.dispatchEvent(new Event('focus'));

    expect(setHref).toHaveBeenLastCalledWith(PULSE_STORE_URLS.ios);
  });

  it('does not redirect when the user comes back from Pulse Cam (long trip away)', () => {
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
    // Pulse Cam launches: the page is blurred but iOS never marks it hidden.
    window.dispatchEvent(new Event('blur'));
    vi.advanceTimersByTime(1500);
    // The user records a clip, then returns.
    vi.advanceTimersByTime(20_000);
    window.dispatchEvent(new Event('focus'));

    expect(setHref).not.toHaveBeenCalledWith(PULSE_STORE_URLS.ios);
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

  it('does not open the store when the timer was suspended (Pulse Cam held the foreground)', () => {
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
    // iOS suspends a backgrounded page: the timer only runs once the user
    // returns from Pulse Cam, long past its deadline.
    vi.setSystemTime(Date.now() + 30_000);
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
