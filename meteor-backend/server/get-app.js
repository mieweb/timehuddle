/**
 * GET /get-app — the one link the web app's laptop install QR code holds
 * (#859). A phone that scans it is redirected straight to its own store, so a
 * single code serves iPhone and Android with no page in between.
 *
 * Anything that isn't a phone (a laptop that opens the link, an iPad that
 * reports itself as a Mac) gets a small page with both store links.
 */
import { WebApp } from 'meteor/webapp';
import {
  APP_STORE_URL,
  GET_APP_PATH,
  PLAY_STORE_URL,
  storeUrlForUserAgent,
} from '@timehuddle/app-links';

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

WebApp.connectHandlers.use(GET_APP_PATH, (req, res, next) => {
  // `use` also matches deeper paths; only the link itself is ours.
  const rest = (req.url || '/').split('?')[0];
  if (rest !== '/' || (req.method !== 'GET' && req.method !== 'HEAD')) return next();

  // The answer depends on the device, so no cache may reuse it for another.
  const headers = { 'Cache-Control': 'no-store', Vary: 'User-Agent' };
  const storeUrl = storeUrlForUserAgent(req.headers['user-agent']);
  if (storeUrl) {
    res.writeHead(302, { ...headers, Location: storeUrl });
    res.end();
    return;
  }
  res.writeHead(200, { ...headers, 'Content-Type': 'text/html; charset=utf-8' });
  res.end(req.method === 'HEAD' ? undefined : CHOOSE_STORE_PAGE);
});
