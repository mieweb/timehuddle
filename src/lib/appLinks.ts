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
