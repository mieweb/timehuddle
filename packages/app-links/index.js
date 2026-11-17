/**
 * Where to get TimeHuddle's native apps — the store listings, and which one a
 * phone belongs to.
 *
 * The web app links to the stores, and the backend's `/get-app` redirect (the
 * link the laptop install QR code holds) sends each phone to its own store.
 * Both sides read the listings and the phone rule from here.
 *
 * Shipped as plain JS with hand-written types because the Meteor backend
 * consumes it directly. See packages/README.md.
 */

/** TimeHuddle on the App Store (iPhone and iPad). */
export const APP_STORE_URL = 'https://apps.apple.com/us/app/timehuddle/id6763657217';

/** The Android app's package name, as listed on Google Play. */
export const ANDROID_PACKAGE = 'com.mieweb.timehuddle';

/** TimeHuddle on Google Play (Android). */
export const PLAY_STORE_URL = `https://play.google.com/store/apps/details?id=${ANDROID_PACKAGE}`;

/** The backend path that sends a phone on to its store. */
export const GET_APP_PATH = '/get-app';

/**
 * The store listing for the phone a user agent belongs to, or null when it
 * isn't an iPhone, iPad or Android phone. Android is checked first: some
 * Android browsers mention other platforms in their user agent.
 */
export function storeUrlForUserAgent(userAgent) {
  const ua = userAgent || '';
  if (/android/i.test(ua)) return PLAY_STORE_URL;
  if (/iphone|ipad|ipod/i.test(ua)) return APP_STORE_URL;
  return null;
}
