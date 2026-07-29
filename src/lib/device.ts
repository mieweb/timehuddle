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
 * **Native-only.** Open a `pulsecam://` deep link, falling back to the platform
 * store if Pulse Cam isn't installed — deterministically, with no timers.
 *
 * Uses `@capacitor/app-launcher`:
 *  - `canOpenUrl({ url: 'pulsecam://' })` asks the OS whether *any* installed
 *    app handles the scheme. On iOS this requires `pulsecam` to be listed in
 *    `LSApplicationQueriesSchemes` (Info.plist); on Android it requires a
 *    matching `<queries>` entry (AndroidManifest.xml).
 *  - If it can be opened → `openUrl(deepLink)` launches Pulse Cam.
 *  - Otherwise → `openUrl(storeUrl)` opens the App Store / Play Store (an
 *    `https://` store link is always openable via `UIApplication.open` /
 *    Android intents, so it launches the store app directly).
 *
 * `window.open(url, '_system')` is NOT used: Capacitor's WebView doesn't
 * implement Cordova's `_system` target, so custom schemes and even store URLs
 * fail with "address invalid" / `LSApplicationWorkspaceErrorDomain Code=115`.
 */
export async function openNativePulseOrStore(deepLink: string, os: MobileOS): Promise<void> {
  const { AppLauncher } = await import('@capacitor/app-launcher');

  // The scheme (no query) is what iOS/Android check against the query allow-list.
  const scheme = 'pulsecam://';
  let canOpen = false;
  try {
    canOpen = (await AppLauncher.canOpenUrl({ url: scheme })).value;
  } catch {
    canOpen = false;
  }

  if (canOpen) {
    await AppLauncher.openUrl({ url: deepLink });
  } else {
    // Pulse Cam is not installed — send the user to the store.
    await AppLauncher.openUrl({ url: PULSE_STORE_URLS[os] });
  }
}

/**
 * **Browser-only.** Attempt to open a `pulsecam://` deep link in a mobile
 * browser, falling back to the platform app store if Pulse Cam isn't installed.
 *
 * The deep link is triggered via a **hidden iframe**, not a top-level
 * `location.href` assignment. Assigning `location.href` to an unhandled custom
 * scheme makes mobile Safari show a "Cannot open — address invalid" alert
 * *before* we can redirect; an iframe navigation to the same scheme fails
 * silently (no alert), so the user only ever sees the App Store. If Pulse Cam
 * is installed the OS still switches to it from the iframe navigation.
 *
 * Success is detected via a real background transition (`visibilitychange` with
 * `document.hidden === true`, or `pagehide`). `blur` is intentionally NOT used —
 * a native alert blurs the window without hiding the page and would wrongly
 * cancel the fallback. If the page is still visible after {@link fallbackDelayMs},
 * we do a top-level navigation to the store (which correctly opens the store app).
 *
 * @returns a cleanup function that cancels the pending store-fallback timer.
 */
export function openPulseAppOrStore(
  deepLink: string,
  os: MobileOS,
  fallbackDelayMs = 1500,
): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let iframe: HTMLIFrameElement | undefined;

  const removeIframe = () => {
    if (iframe?.parentNode) iframe.parentNode.removeChild(iframe);
    iframe = undefined;
  };

  const cancel = () => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('pagehide', onPageHide);
    removeIframe();
  };

  function onVisibilityChange() {
    // Only a real background transition (hidden) means the app opened.
    if (document.hidden) cancel();
  }

  function onPageHide() {
    cancel();
  }

  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('pagehide', onPageHide);

  timer = setTimeout(() => {
    cancel();
    if (!document.hidden) {
      // Top-level navigation to the https store URL opens the store app.
      navigateExternal(PULSE_STORE_URLS[os]);
    }
  }, fallbackDelayMs);

  // Trigger the deep link via a hidden iframe to avoid Safari's error alert.
  iframe = document.createElement('iframe');
  iframe.style.display = 'none';
  iframe.src = deepLink;
  document.body.appendChild(iframe);

  return cancel;
}
