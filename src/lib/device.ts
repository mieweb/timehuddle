import { Capacitor } from '@capacitor/core';

/** Detected mobile operating system for a web browser context. */
export type MobileOS = 'ios' | 'android';

/**
 * Public App Store / Play Store listings for the Pulse Cam app
 * (bundle / package id `com.mieweb.pulse`). Used as the install fallback when a
 * `pulsecam://` deep link fails to open because Pulse Cam isn't installed.
 */
export const PULSE_STORE_URLS: Record<MobileOS, string> = {
  ios: 'https://apps.apple.com/us/app/pulse-cam/id6748621024',
  android: 'https://play.google.com/store/apps/details?id=com.mieweb.pulse',
};

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
 * Resolve the store OS to use for a Pulse Cam install fallback across *both*
 * the native app and mobile browsers. Returns `null` on desktop (where the QR
 * flow is used instead).
 *
 * In the native shell `Capacitor.getPlatform()` is authoritative (`'ios'` /
 * `'android'`); in a browser we fall back to UA sniffing via {@link getMobileOS}.
 */
export function getStoreOS(): MobileOS | null {
  if (isNativeApp()) {
    const platform = Capacitor.getPlatform();
    return platform === 'ios' || platform === 'android' ? platform : null;
  }
  return getMobileOS();
}

/**
 * Open a URL the right way for the current runtime: in the native shell a
 * custom scheme / external link must go through `window.open(url, '_system')`
 * (WKWebView won't navigate to `pulsecam://` or an App Store link itself);
 * in a browser a normal `location.href` assignment is correct.
 */
function navigateExternal(url: string): void {
  if (isNativeApp()) {
    window.open(url, '_system');
  } else {
    window.location.href = url;
  }
}

/**
 * Attempt to open a `pulsecam://` deep link, falling back to the platform app
 * store if Pulse Cam isn't installed. Works in both the native app and a mobile
 * browser.
 *
 * Detection is heuristic: opening a registered custom scheme backgrounds the
 * page (the OS switches to the app), which fires `visibilitychange` /
 * `pagehide` / `blur`. If the page is still visible after {@link fallbackDelayMs},
 * the app almost certainly didn't open, so we send the user to the store.
 *
 * @returns a cleanup function that cancels the pending store-fallback timer.
 */
export function openPulseAppOrStore(
  deepLink: string,
  os: MobileOS,
  fallbackDelayMs = 1500,
): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const cancel = () => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    document.removeEventListener('visibilitychange', onHide);
    window.removeEventListener('pagehide', onHide);
    window.removeEventListener('blur', onHide);
  };

  function onHide() {
    // The app opened (page backgrounded) — don't send the user to the store.
    cancel();
  }

  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', onHide);
  window.addEventListener('blur', onHide);

  timer = setTimeout(() => {
    cancel();
    if (!document.hidden) {
      navigateExternal(PULSE_STORE_URLS[os]);
    }
  }, fallbackDelayMs);

  // Trigger the deep link. If Pulse Cam is installed the OS switches to it and
  // the listeners above cancel the fallback.
  navigateExternal(deepLink);

  return cancel;
}
