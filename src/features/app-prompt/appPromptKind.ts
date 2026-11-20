/**
 * Which native-app prompt a browser shows when TimeHuddle opens (#859), if any.
 *
 * - iPhone / iPad / Android browser, no app on that platform → ask to install
 *   it from the App Store or Google Play
 * - iPhone / iPad / Android browser, has the app → offer to open the dashboard in it
 * - Laptop / desktop browser, no app on either platform → QR codes to install
 *   it on an iPhone or an Android phone
 * - Everything else → nothing: inside the native app, people who already have
 *   it on a laptop, and automated browsers such as the Playwright suite.
 */
import type { MobileOS } from '../../lib/device';

export type AppPromptKind = 'install-phone' | 'install-desktop' | 'open-in-app';

export interface AppPromptContext {
  /** Running inside the Capacitor shell. */
  isNativeApp: boolean;
  /** `navigator.webdriver` — set by Playwright and other automation. */
  automated: boolean;
  mobileOS: MobileOS | null;
  /** The account used the iOS app recently (from the server). */
  hasIosApp: boolean;
  /** The account used the Android app recently (from the server). */
  hasAndroidApp: boolean;
}

export function appPromptKind({
  isNativeApp,
  automated,
  mobileOS,
  hasIosApp,
  hasAndroidApp,
}: AppPromptContext): AppPromptKind | null {
  if (isNativeApp || automated) return null;
  if (mobileOS === 'ios') return hasIosApp ? 'open-in-app' : 'install-phone';
  if (mobileOS === 'android') return hasAndroidApp ? 'open-in-app' : 'install-phone';
  return hasIosApp || hasAndroidApp ? null : 'install-desktop';
}
