import { Capacitor } from '@capacitor/core';

/** Detected mobile operating system for a web browser context. */
export type MobileOS = 'ios' | 'android';

/** True when running inside the Capacitor native shell (not a browser). */
export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform();
}

/**
 * Best-effort detection of the mobile OS for a *web browser* context. Returns
 * `null` on desktop or when the platform can't be determined.
 *
 * iPadOS reports a desktop-class `MacIntel` user agent, so it's detected via
 * touch support (`maxTouchPoints > 1`) rather than the UA string.
 */
export function getMobileOS(): MobileOS | null {
  if (typeof navigator === 'undefined') return null;

  const ua = navigator.userAgent || '';

  if (/android/i.test(ua)) return 'android';

  // Classic iPhone/iPad/iPod UA.
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios';

  // iPadOS 13+ masquerades as macOS Safari — disambiguate via touch support.
  const isTouchMac = /macintosh/i.test(ua) && navigator.maxTouchPoints > 1;
  if (isTouchMac) return 'ios';

  return null;
}

/**
 * True when running in a *mobile web browser* (Safari/Chrome on a phone or
 * tablet) — i.e. a mobile OS is detected and we're not inside the native app.
 */
export function isMobileBrowser(): boolean {
  return !isNativeApp() && getMobileOS() !== null;
}

/**
 * Open an external `https://` link outside the app. In the native shell it goes
 * through `AppLauncher.openUrl`, which hands it to the OS: an App Store link
 * opens the App Store, and a Universal Link / App Link (Pulse's pairing link)
 * opens the app that claims it — WKWebView's `window.open` can do neither. In a
 * browser it opens in a new tab.
 *
 * `signal`: the caller may move on while the launcher loads (another ticket);
 * once it's aborted, nothing opens.
 */
export async function openExternalUrl(url: string, signal?: AbortSignal): Promise<void> {
  if (isNativeApp()) {
    const { AppLauncher } = await import('@capacitor/app-launcher');
    if (signal?.aborted) return;
    await AppLauncher.openUrl({ url });
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}
