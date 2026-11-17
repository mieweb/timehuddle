/**
 * Links to TimeHuddle's native apps — the store listings, and links that open a
 * page in the app someone already has. Shared by the account menu's store item
 * and the install / open-in-app prompt (#859).
 */
import type { MobileOS } from './device';

/** TimeHuddle on the App Store (iPhone and iPad). */
export const APP_STORE_URL = 'https://apps.apple.com/us/app/timehuddle/id6763657217';

/** TimeHuddle on Google Play (Android). */
export const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.mieweb.timehuddle';

/**
 * TimeHuddle's own "get the app" page: a phone that opens it goes straight to
 * its store, anything else is offered both (main.tsx, GetAppPage). One link —
 * and one QR code — for every phone.
 */
export const GET_APP_PATH = '/get-app';

/** The absolute get-the-app link on the site the person is using. */
export function getAppUrl(origin: string = window.location.origin): string {
  return `${origin}${GET_APP_PATH}`;
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
