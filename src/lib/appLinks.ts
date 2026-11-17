/**
 * Links to TimeHuddle's native apps — the store listings, and links that open a
 * page in the app someone already has. Shared by the account menu's store item
 * and the install / open-in-app prompt (#859).
 */
import type { MobileOS } from './device';

/** TimeHuddle on the App Store (iPhone and iPad). */
export const APP_STORE_URL = 'https://apps.apple.com/us/app/timehuddle/id6763657217';

/** The Android app's package name, as listed on Google Play. */
export const ANDROID_PACKAGE = 'com.mieweb.timehuddle';

/** TimeHuddle on Google Play (Android). */
export const PLAY_STORE_URL = `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}`;

/** The store that sells the app for `os`. */
export function storeUrlFor(os: MobileOS): string {
  return os === 'android' ? PLAY_STORE_URL : APP_STORE_URL;
}

/**
 * A link that opens `path` (an in-app route such as `/app/huddle?team=x`) in
 * the installed native app. The app's `appUrlOpen` handler in main.tsx takes
 * `timehuddle://open/<route>` and only accepts `/app/...` routes, so anything
 * else opens the app on its home page. Both apps register the scheme.
 */
export function openInAppUrl(path: string): string {
  return /^\/app(\/|$|\?)/.test(path) ? `timehuddle://open${path}` : 'timehuddle://open/app';
}

/**
 * An Android Chrome intent link to `path`: it opens the page in the installed
 * app, and goes to Google Play when the app isn't there. One tap either way —
 * the browser can't tell whether the app is installed, but Android can.
 */
export function androidAppLink(path: string): string {
  const deepLink = openInAppUrl(path).slice('timehuddle://'.length);
  const fallback = encodeURIComponent(PLAY_STORE_URL);
  return `intent://${deepLink}#Intent;scheme=timehuddle;package=${ANDROID_PACKAGE};S.browser_fallback_url=${fallback};end`;
}
