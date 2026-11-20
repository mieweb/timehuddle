/**
 * Links to TimeHuddle's native apps — the store listings, and links that open a
 * page in the app someone already has. Shared by the account menu's store item
 * and the install / open-in-app prompt (#859). The listings themselves live in
 * @timehuddle/app-links, which the backend's /get-app redirect also reads.
 */
import {
  ANDROID_PACKAGE,
  APP_STORE_URL,
  GET_APP_PATH,
  PLAY_STORE_URL,
} from '@timehuddle/app-links';

import { METEOR_BASE_URL } from './api';
import type { MobileOS } from './device';

export { APP_STORE_URL, PLAY_STORE_URL };

/**
 * The link the laptop install QR code holds: the backend's /get-app, which
 * redirects an iPhone to the App Store and an Android phone to Google Play.
 */
export function getAppUrl(): string {
  return `${METEOR_BASE_URL.replace(/\/$/, '')}${GET_APP_PATH}`;
}

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
