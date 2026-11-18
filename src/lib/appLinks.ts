/**
 * Links to TimeHuddle's native apps — the store listing, and links that open a
 * page in the app someone already has. Shared by the account menu's App Store
 * item and the install / open-in-app prompt (#859).
 */

/** TimeHuddle on the App Store (iPhone and iPad). */
export const APP_STORE_URL = 'https://apps.apple.com/us/app/timehuddle/id6763657217';

/**
 * A link that opens `path` (an in-app route such as `/app/huddle?team=x`) in
 * the installed native app. The app's `appUrlOpen` handler in main.tsx takes
 * `timehuddle://open/<route>` and only accepts `/app/...` routes, so anything
 * else opens the app on its home page.
 */
export function openInAppUrl(path: string): string {
  return /^\/app(\/|$|\?)/.test(path) ? `timehuddle://open${path}` : 'timehuddle://open/app';
}
