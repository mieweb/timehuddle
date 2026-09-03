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

/** Android package id for Pulse Cam, used to target the `intent://` launch. */
const PULSE_ANDROID_PACKAGE = 'com.mieweb.pulse';

/**
 * How far past its deadline the store-fallback timer may fire and still count as
 * "ran on time". Anything later means the OS suspended the page, i.e. Pulse Cam
 * was in the foreground.
 */
const TIMER_SUSPENSION_SLACK_MS = 500;

/** How long to wait for Pulse Cam to take over before offering the store. */
const STORE_FALLBACK_DELAY_MS = 2500;

/**
 * Longest trip away from the page that still counts as "the user dismissed
 * Safari's address-invalid alert" rather than "the user was in Pulse Cam".
 */
const ALERT_DISMISS_WINDOW_MS = 5000;

/**
 * Rewrite a `pulsecam://…` deep link as an Android `intent://` URL. Chrome
 * resolves it without any timers: it launches Pulse Cam when the package is
 * installed and follows `browser_fallback_url` to Play Store when it isn't.
 * The query string (and therefore the upload session) is carried through both
 * ways, so a fresh install can open straight into the same upload.
 */
export function buildAndroidIntentLink(deepLink: string): string {
  const query = deepLink.slice(deepLink.indexOf('://') + '://'.length);
  return (
    `intent://${query}#Intent;scheme=pulsecam;package=${PULSE_ANDROID_PACKAGE};` +
    `S.browser_fallback_url=${encodeURIComponent(PULSE_STORE_URLS.android)};end`
  );
}

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
 * **Android** resolves this itself: an `intent://` URL carrying
 * `browser_fallback_url` launches Pulse Cam when installed and goes to Play
 * Store when it isn't, in one navigation with no timer.
 *
 * **iOS** has no such mechanism, so the deep link is a *top-level* navigation
 * (a hidden iframe is silently blocked by modern WebKit, so the installed app
 * never opened and every user was dumped in the App Store) and the store is a
 * fallback. Two things then look identical from JavaScript — Pulse Cam
 * launching, and Safari's "address invalid" alert — and both merely *blur* the
 * page. A deadline alone can't separate them, and firing it mid-launch is what
 * stacked the App Store on top of an app that was already opening.
 *
 * So the deadline never decides while focus is elsewhere; it waits for the page
 * to come back and measures how long the user was away:
 *  - page hidden / unloaded → Pulse Cam took over. Stop.
 *  - timer fired late (the OS suspended the page) → Pulse Cam took over. Stop.
 *  - away, then back within {@link ALERT_DISMISS_WINDOW_MS} → that was the
 *    alert, so go to the store.
 *  - away longer than that → the user was in Pulse Cam. Stop.
 *  - never left, still visible at the deadline → nothing happened at all, so go
 *    to the store.
 *
 * @returns a cleanup function that cancels the pending store fallback.
 */
export function openPulseAppOrStore(
  deepLink: string,
  os: MobileOS,
  fallbackDelayMs = STORE_FALLBACK_DELAY_MS,
): () => void {
  if (os === 'android') {
    navigateExternal(buildAndroidIntentLink(deepLink));
    return () => {};
  }

  const startedAt = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let deadlinePassed = false;
  let leftAt: number | undefined;
  let settled = false;

  const cancel = () => {
    settled = true;
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('blur', onBlur);
    window.removeEventListener('focus', onFocus);
  };

  const openStore = () => {
    if (settled) return;
    cancel();
    navigateExternal(PULSE_STORE_URLS[os]);
  };

  function onVisibilityChange() {
    if (document.hidden) cancel();
  }

  function onPageHide() {
    cancel();
  }

  function onBlur() {
    if (leftAt === undefined) leftAt = Date.now();
  }

  function onFocus() {
    const away = leftAt === undefined ? 0 : Date.now() - leftAt;
    leftAt = undefined;
    if (!deadlinePassed || settled) return;
    if (away < ALERT_DISMISS_WINDOW_MS) openStore();
    else cancel();
  }

  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('blur', onBlur);
  window.addEventListener('focus', onFocus);

  timer = setTimeout(() => {
    deadlinePassed = true;
    timer = undefined;
    const suspended = Date.now() - startedAt > fallbackDelayMs + TIMER_SUSPENSION_SLACK_MS;
    if (suspended || document.hidden) {
      cancel();
      return;
    }
    // Focus is elsewhere: Pulse Cam may still be launching, so leave the
    // decision to onFocus rather than racing it.
    if (leftAt !== undefined) return;
    openStore();
  }, fallbackDelayMs);

  navigateExternal(deepLink);

  return cancel;
}
