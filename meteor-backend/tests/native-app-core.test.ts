/**
 * Unit tests for native-app-core (server/native-app-core.js) — whether a
 * person counts as having the native app, which decides if the web app asks
 * them to install it or to open it (#859).
 *
 * Pure module, no Meteor and no database.
 */
import { describe, it, expect } from 'vitest';
import {
  NATIVE_APP_RECENT_DAYS,
  isNativeAppPlatform,
  usesNativeApp,
} from '../server/native-app-core';

const NOW = new Date('2026-11-10T12:00:00Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);

describe('isNativeAppPlatform', () => {
  it('accepts the platforms the app ships on', () => {
    expect(isNativeAppPlatform('ios')).toBe(true);
    expect(isNativeAppPlatform('android')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isNativeAppPlatform('web')).toBe(false);
    expect(isNativeAppPlatform('IOS')).toBe(false);
    expect(isNativeAppPlatform(undefined)).toBe(false);
  });
});

describe('usesNativeApp', () => {
  it('is false for someone the app has never reported', () => {
    expect(usesNativeApp(undefined, 'ios', NOW)).toBe(false);
    expect(usesNativeApp({}, 'ios', NOW)).toBe(false);
  });

  it('is true for a use within the window, up to its last day', () => {
    expect(usesNativeApp({ ios: daysAgo(0) }, 'ios', NOW)).toBe(true);
    expect(usesNativeApp({ ios: daysAgo(NATIVE_APP_RECENT_DAYS) }, 'ios', NOW)).toBe(true);
  });

  it('is false once the window has passed, so a deleted app gets asked again', () => {
    expect(usesNativeApp({ ios: daysAgo(NATIVE_APP_RECENT_DAYS + 1) }, 'ios', NOW)).toBe(false);
  });

  it('reads only the platform asked about', () => {
    expect(usesNativeApp({ android: daysAgo(1) }, 'ios', NOW)).toBe(false);
  });

  it('reads a stored date string as well as a Date', () => {
    expect(usesNativeApp({ ios: daysAgo(2).toISOString() }, 'ios', NOW)).toBe(true);
  });

  it('does not trust a date in the future', () => {
    expect(usesNativeApp({ ios: daysAgo(-1) }, 'ios', NOW)).toBe(false);
  });
});
