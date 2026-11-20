import { describe, expect, it } from 'vitest';

import { APP_STORE_URL, PLAY_STORE_URL, storeUrlForUserAgent } from './index.js';

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const IPAD =
  'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';
const MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

describe('storeUrlForUserAgent', () => {
  it('sends an iPhone or iPad to the App Store', () => {
    expect(storeUrlForUserAgent(IPHONE)).toBe(APP_STORE_URL);
    expect(storeUrlForUserAgent(IPAD)).toBe(APP_STORE_URL);
  });

  it('sends an Android phone to Google Play', () => {
    expect(storeUrlForUserAgent(ANDROID)).toBe(PLAY_STORE_URL);
  });

  it('has no store for a laptop or a missing user agent', () => {
    expect(storeUrlForUserAgent(MAC)).toBeNull();
    expect(storeUrlForUserAgent('')).toBeNull();
    expect(storeUrlForUserAgent(undefined)).toBeNull();
  });
});
