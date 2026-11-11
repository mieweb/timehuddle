/**
 * Which native TimeHuddle apps a person uses — the rules behind the web app's
 * install / open-in-app prompt (#859).
 *
 * A web page cannot see what is installed on a phone, so the native app tells
 * the server each time it starts (`users.markNativeAppSeen`), and the web app
 * reads the result back with the current user. Kept free of Meteor and Mongo
 * so the rules are unit tested without a server (tests/native-app-core.test.ts).
 */

/** The platforms the native app ships on. */
export const NATIVE_APP_PLATFORMS = ['ios', 'android'];

/**
 * How long one use of the app counts as "has the app". There is no uninstall
 * signal, so someone who deletes the app is asked to install it again once
 * this has passed.
 */
export const NATIVE_APP_RECENT_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** True for a platform the native app ships on. */
export function isNativeAppPlatform(platform) {
  return NATIVE_APP_PLATFORMS.includes(platform);
}

/**
 * True when the app on `platform` was used within NATIVE_APP_RECENT_DAYS of
 * `now`. `lastSeen` is the user's `nativeAppLastSeenAt` map; a missing map, a
 * missing platform or a date in the future all read as "no".
 */
export function usesNativeApp(lastSeen, platform, now = new Date()) {
  const seenAt = lastSeen?.[platform];
  if (!seenAt) return false;
  const age = now.getTime() - new Date(seenAt).getTime();
  return age >= 0 && age <= NATIVE_APP_RECENT_DAYS * DAY_MS;
}
