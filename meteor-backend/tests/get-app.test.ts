/**
 * GET /get-app — the laptop install QR code's link (#859). Each phone is sent
 * straight to its own store; anything else gets a page with both. Which user
 * agent counts as which phone is unit tested in @timehuddle/app-links.
 */
import { describe, expect, it } from 'vitest';
import { APP_STORE_URL, PLAY_STORE_URL } from '@timehuddle/app-links';

import { METEOR_URL } from './setup';

const getApp = (userAgent: string) =>
  fetch(`${METEOR_URL}/get-app`, { headers: { 'User-Agent': userAgent }, redirect: 'manual' });

describe('GET /get-app', () => {
  it('sends an iPhone to the App Store', async () => {
    const res = await getApp('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(APP_STORE_URL);
  });

  it('sends an Android phone to Google Play', async () => {
    const res = await getApp('Mozilla/5.0 (Linux; Android 14; Pixel 7)');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(PLAY_STORE_URL);
  });

  it('offers a laptop both stores', async () => {
    const res = await getApp('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)');
    expect(res.status).toBe(200);
    const page = await res.text();
    expect(page).toContain(APP_STORE_URL);
    expect(page).toContain(PLAY_STORE_URL);
  });

  it('is never cached for another device', async () => {
    const res = await getApp('Mozilla/5.0 (Linux; Android 14; Pixel 7)');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('vary')).toMatch(/User-Agent/i);
  });
});
