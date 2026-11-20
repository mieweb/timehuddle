/**
 * The response for GET /get-app, the link the web app's laptop install QR code
 * holds (#859): a phone is redirected straight to its own store, anything else
 * gets a small page with both. Kept free of Meteor so it is unit tested
 * without a server (tests/get-app-core.test.ts); get-app.js serves it.
 */
import { APP_STORE_URL, PLAY_STORE_URL, storeUrlForUserAgent } from '@timehuddle/app-links';

const CHOOSE_STORE_PAGE =
  `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">` +
  `<meta name="viewport" content="width=device-width, initial-scale=1">` +
  `<title>Get the TimeHuddle app</title></head>` +
  `<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;` +
  `text-align:center;padding:48px 24px;color:#1d1d1f;">` +
  `<h1 style="font-size:22px;">Get the TimeHuddle app</h1>` +
  `<p><a href="${APP_STORE_URL}">App Store (iPhone and iPad)</a></p>` +
  `<p><a href="${PLAY_STORE_URL}">Google Play (Android)</a></p>` +
  `</body></html>`;

/** The answer depends on the device, so no cache may reuse it for another. */
const NO_SHARED_CACHE = { 'Cache-Control': 'no-store', Vary: 'User-Agent' };

/**
 * `{ status, headers, body }` for a request from `userAgent`: a 302 to the
 * phone's store, or the both-stores page (no body for HEAD).
 */
export function getAppResponse(userAgent, method = 'GET') {
  const storeUrl = storeUrlForUserAgent(userAgent);
  if (storeUrl) {
    return { status: 302, headers: { ...NO_SHARED_CACHE, Location: storeUrl }, body: undefined };
  }
  return {
    status: 200,
    headers: { ...NO_SHARED_CACHE, 'Content-Type': 'text/html; charset=utf-8' },
    body: method === 'HEAD' ? undefined : CHOOSE_STORE_PAGE,
  };
}
