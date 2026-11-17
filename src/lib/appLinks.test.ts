import { describe, expect, it } from 'vitest';

import {
  APP_STORE_URL,
  PLAY_STORE_URL,
  androidAppLink,
  openInAppUrl,
  storeUrlFor,
} from './appLinks';

describe('openInAppUrl', () => {
  it('opens an in-app route, query and all', () => {
    expect(openInAppUrl('/app/huddle?team=abc')).toBe('timehuddle://open/app/huddle?team=abc');
    expect(openInAppUrl('/app')).toBe('timehuddle://open/app');
    expect(openInAppUrl('/app?team=abc')).toBe('timehuddle://open/app?team=abc');
  });

  it('falls back to the app home for anything the app would refuse', () => {
    expect(openInAppUrl('/release-notes')).toBe('timehuddle://open/app');
    expect(openInAppUrl('//example.com/app')).toBe('timehuddle://open/app');
    expect(openInAppUrl('/apples')).toBe('timehuddle://open/app');
  });
});

describe('storeUrlFor', () => {
  it('sends Android to Google Play and iOS to the App Store', () => {
    expect(storeUrlFor('android')).toBe(PLAY_STORE_URL);
    expect(storeUrlFor('ios')).toBe(APP_STORE_URL);
  });
});

describe('androidAppLink', () => {
  it('opens the page in the Android app, or Google Play without it', () => {
    expect(androidAppLink('/app/huddle?team=abc')).toBe(
      'intent://open/app/huddle?team=abc#Intent;scheme=timehuddle;package=com.mieweb.timehuddle;' +
        `S.browser_fallback_url=${encodeURIComponent(PLAY_STORE_URL)};end`,
    );
  });

  it('opens the app home for routes the app would refuse', () => {
    expect(androidAppLink('/release-notes')).toMatch(/^intent:\/\/open\/app#Intent;/);
  });
});
