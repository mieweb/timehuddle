/**
 * Which native-app prompt a browser shows when TimeHuddle opens (#859), if any.
 *
 * - iPhone / iPad browser, no app → ask to install it from the App Store
 * - iPhone / iPad browser, has the app → offer to open this page in the app
 * - Laptop / desktop browser, no app → a QR code to install it on an iPhone
 * - Everything else → nothing: inside the native app, people who already have
 *   it on a laptop, Android (no Play Store listing yet, #840), and automated
 *   browsers such as the Playwright suite.
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
}

export function appPromptKind({
  isNativeApp,
  automated,
  mobileOS,
  hasIosApp,
}: AppPromptContext): AppPromptKind | null {
  if (isNativeApp || automated || mobileOS === 'android') return null;
  if (mobileOS === 'ios') return hasIosApp ? 'open-in-app' : 'install-phone';
  return hasIosApp ? null : 'install-desktop';
}
