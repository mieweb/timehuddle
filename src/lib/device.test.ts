import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Capacitor } from '@capacitor/core';

// Mocked so `openExternalUrl`'s dynamic `import('@capacitor/app-launcher')`
// resolves to a controllable stub instead of the real native bridge.
const openUrl = vi.fn();
vi.mock('@capacitor/app-launcher', () => ({
  AppLauncher: {
    openUrl: (...args: unknown[]) => openUrl(...args),
  },
}));

import { getMobileOS, isMobileBrowser, openExternalUrl } from './device';

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

describe('openExternalUrl', () => {
  const url = 'https://apps.apple.com/us/app/timehuddle/id6763657217';

  beforeEach(() => openUrl.mockReset());
  afterEach(() => vi.restoreAllMocks());

  it('hands the link to the OS in the native shell (an App Store link, or a Universal Link)', async () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    openUrl.mockResolvedValue(undefined);

    await openExternalUrl(url);

    expect(openUrl).toHaveBeenCalledWith({ url });
    expect(open).not.toHaveBeenCalled();
  });

  it('opens a new tab in a browser', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);

    await openExternalUrl(url);

    expect(open).toHaveBeenCalledWith(url, '_blank', 'noopener,noreferrer');
    expect(openUrl).not.toHaveBeenCalled();
  });
});
