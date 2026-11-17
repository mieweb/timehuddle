/**
 * GET /get-app's response (#859): each phone is sent straight to its own
 * store; anything else gets a page with both. Which user agent counts as
 * which phone is unit tested in @timehuddle/app-links.
 */
import { describe, expect, it } from 'vitest';
import { APP_STORE_URL, PLAY_STORE_URL } from '@timehuddle/app-links';

import { getAppResponse } from '../server/get-app-core';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 7)';
const LAPTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)';

describe('getAppResponse', () => {
  it('sends an iPhone to the App Store', () => {
    const res = getAppResponse(IPHONE);
    expect(res.status).toBe(302);
    expect(res.headers).toMatchObject({ Location: APP_STORE_URL });
  });

  it('sends an Android phone to Google Play', () => {
    const res = getAppResponse(ANDROID);
    expect(res.status).toBe(302);
    expect(res.headers).toMatchObject({ Location: PLAY_STORE_URL });
  });

  it('offers a laptop both stores', () => {
    const res = getAppResponse(LAPTOP);
    expect(res.status).toBe(200);
    expect(res.body).toContain(APP_STORE_URL);
    expect(res.body).toContain(PLAY_STORE_URL);
  });

  it('sends no page body for HEAD', () => {
    expect(getAppResponse(LAPTOP, 'HEAD').body).toBeUndefined();
  });

  it('is never cached for another device', () => {
    for (const ua of [IPHONE, ANDROID, LAPTOP]) {
      const { headers } = getAppResponse(ua);
      expect(headers['Cache-Control']).toBe('no-store');
      expect(headers.Vary).toBe('User-Agent');
    }
  });
});
