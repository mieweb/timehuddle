/**
 * Pulse Cam scan interstitial.
 *
 *   GET /pulse/open?v=1&artifactId=…&server=…&token=…&uploadUnit=merged
 *
 * A phone camera scanning a raw `pulsecam://` QR code does nothing at all when
 * Pulse Cam isn't installed — most camera apps refuse to surface an unknown
 * custom scheme. So the QR encodes this https URL instead: the page rebuilds
 * the same `pulsecam://` deep link, tries to open it, and falls back to the
 * App Store / Play Store listing when the app isn't there.
 *
 * Store links must stay in sync with `PULSE_STORE_URLS` in `src/lib/device.ts`
 * (the frontend/backend barrier forbids sharing the module directly).
 */
import { WebApp } from 'meteor/webapp';

const STORE_URLS = {
  ios: 'https://apps.apple.com/us/app/pulse-cam/id6748621024',
  android: 'https://play.google.com/store/apps/details?id=com.mieweb.pulse',
};

const ANDROID_PACKAGE = 'com.mieweb.pulse';

/** Deep-link params forwarded to Pulse Cam, per @mieweb/pulsevault PROTOCOL.md. */
const ALLOWED_PARAMS = ['v', 'artifactId', 'server', 'token', 'uploadUnit'];
const MAX_PARAM_LENGTH = 2048;
// RFC 3986 unreserved + sub-delims + path/query chars — no quotes, angle
// brackets, or control characters can reach the rendered page.
const SAFE_PARAM_RE = /^[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]+$/;

/** Escapes a value for embedding inside a <script> block. */
function jsLiteral(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

/**
 * Chrome resolves an `intent://` URL itself — it launches Pulse Cam when the
 * package is installed and follows `browser_fallback_url` to Play Store when it
 * isn't, carrying the upload query string either way.
 */
function androidIntentLink(deepLink) {
  const query = deepLink.slice(deepLink.indexOf('://') + '://'.length);
  return (
    `intent://${query}#Intent;scheme=pulsecam;package=${ANDROID_PACKAGE};` +
    `S.browser_fallback_url=${encodeURIComponent(STORE_URLS.android)};end`
  );
}

function buildDeepLink(searchParams) {
  const params = new URLSearchParams();
  for (const key of ALLOWED_PARAMS) {
    const value = searchParams.get(key);
    if (value === null) continue;
    if (value.length > MAX_PARAM_LENGTH || !SAFE_PARAM_RE.test(value)) return null;
    params.set(key, value);
  }
  if (!params.get('artifactId') || !params.get('token')) return null;

  // `server` tells Pulse Cam where to upload — only ever an http(s) origin.
  const server = params.get('server');
  if (server && !/^https?:\/\//i.test(server)) return null;

  return { deepLink: `pulsecam://?${params.toString()}`, artifactId: params.get('artifactId') };
}

function page(deepLink, artifactId) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Open Pulse Cam</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
         font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
         background: #0f172a; color: #f8fafc; padding: 24px; }
  .pulse-open-card { max-width: 22rem; text-align: center; }
  h1 { font-size: 1.25rem; margin: 0 0 .5rem; }
  p { font-size: .9375rem; line-height: 1.5; color: #cbd5e1; margin: 0 0 1.25rem; }
  a.pulse-open-action { display: block; padding: .75rem 1rem; border-radius: .5rem; font-weight: 600;
      text-decoration: none; margin-bottom: .75rem; background: #6366f1; color: #fff; }
  a.pulse-open-store { background: transparent; color: #c7d2fe; border: 1px solid #475569; }
</style>
</head>
<body>
  <main class="pulse-open-card">
    <h1>Opening Pulse Cam…</h1>
    <p id="pulse-open-status" role="status" aria-live="polite">
      If nothing happens, Pulse Cam may not be installed on this device.
    </p>
    <a class="pulse-open-action" id="pulse-open-app" href="#">Open Pulse Cam</a>
    <a class="pulse-open-action pulse-open-store" id="pulse-open-store" href="#" hidden>Get Pulse Cam</a>
  </main>
<script>
(function () {
  var deepLink = ${jsLiteral(deepLink)};
  var androidLink = ${jsLiteral(androidIntentLink(deepLink))};
  var storeUrls = ${jsLiteral(STORE_URLS)};
  var openLink = document.getElementById('pulse-open-app');
  var storeLink = document.getElementById('pulse-open-store');
  var statusEl = document.getElementById('pulse-open-status');

  // How long to wait for Pulse Cam to take over, how late the timer may fire and
  // still count as "ran on time" (any later means iOS suspended the page while
  // Pulse Cam held the foreground), and the longest trip away that still reads
  // as "dismissed Safari's alert" rather than "was in Pulse Cam".
  var FALLBACK_MS = 2500;
  var SUSPENDED_MS = 3000;
  var ALERT_DISMISS_MS = 5000;

  openLink.href = deepLink;

  var ua = navigator.userAgent || '';
  var isIpadOS = /macintosh/i.test(ua) && navigator.maxTouchPoints > 1;
  var os = /android/i.test(ua) ? 'android'
    : (/iphone|ipad|ipod/i.test(ua) || isIpadOS) ? 'ios' : null;

  if (!os) {
    statusEl.textContent = 'Open this link on the phone you want to record with.';
    return;
  }

  storeLink.href = storeUrls[os];
  storeLink.hidden = false;
  storeLink.textContent = os === 'ios' ? 'Get Pulse Cam on the App Store' : 'Get Pulse Cam on Google Play';

  // One auto-attempt per upload session. Coming back from the store (or from
  // Pulse Cam itself) must not bounce the user out again — this page URL still
  // carries the whole upload session, so the manual button opens it directly
  // after installing, with no trip back to TimeHuddle.
  var attemptKey = 'pulse-open-attempted:' + ${jsLiteral(artifactId)};
  function wasAttempted() {
    try { return sessionStorage.getItem(attemptKey) === '1'; } catch (err) { return false; }
  }
  function markAttempted() {
    try { sessionStorage.setItem(attemptKey, '1'); } catch (err) { /* private mode */ }
  }

  function offerManualOpen() {
    statusEl.textContent = 'Already have Pulse Cam? Tap below to open it with this upload ready to go.';
  }

  if (wasAttempted()) {
    offerManualOpen();
    return;
  }
  markAttempted();

  if (os === 'android') {
    // Chrome picks app-or-store itself, so there is nothing to time out on.
    window.location.href = androidLink;
    return;
  }

  var timer;
  var startedAt = Date.now();
  var deadlinePassed = false;
  var leftAt;
  var settled = false;

  function cancel() {
    settled = true;
    if (timer) { clearTimeout(timer); timer = undefined; }
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('pagehide', cancel);
    window.removeEventListener('blur', onBlur);
    window.removeEventListener('focus', onFocus);
  }
  function onVisibilityChange() { if (document.hidden) cancel(); }
  function onBlur() { if (leftAt === undefined) leftAt = Date.now(); }
  function onFocus() {
    var away = leftAt === undefined ? 0 : Date.now() - leftAt;
    leftAt = undefined;
    if (!deadlinePassed || settled) return;
    // Back this quickly, with the page never hidden, means the user dismissed
    // Safari's "address invalid" alert — Pulse Cam isn't installed.
    if (away < ALERT_DISMISS_MS) goToStore();
    else { cancel(); offerManualOpen(); }
  }
  function goToStore() {
    if (settled) return;
    cancel();
    statusEl.textContent = 'Pulse Cam isn\\u2019t installed \\u2014 taking you to the App Store\\u2026';
    window.location.href = storeUrls.ios;
  }

  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('pagehide', cancel);
  window.addEventListener('blur', onBlur);
  window.addEventListener('focus', onFocus);

  // The page is restored (bfcache) when the user backs out of the App Store —
  // show the open button instead of re-running the store redirect.
  window.addEventListener('pageshow', function (event) {
    if (event.persisted) { cancel(); offerManualOpen(); }
  });

  timer = setTimeout(function () {
    deadlinePassed = true;
    timer = undefined;
    // A timer that fires late was suspended by iOS while Pulse Cam held the
    // foreground, so the app did open — never stack the App Store on top of it.
    if (document.hidden || Date.now() - startedAt > SUSPENDED_MS) {
      cancel();
      offerManualOpen();
      return;
    }
    // Focus is elsewhere: Pulse Cam may still be launching, so let onFocus
    // decide rather than racing it.
    if (leftAt !== undefined) return;
    goToStore();
  }, FALLBACK_MS);

  // Top-level navigation, not a hidden iframe: modern WebKit silently blocks
  // iframe navigation to a custom scheme, so an installed Pulse Cam never
  // opened and everyone was sent to the App Store instead.
  window.location.href = deepLink;
})();
</script>
</body>
</html>`;
}

WebApp.connectHandlers.use('/pulse/open', (req, res) => {
  const searchParams = new URL(req.url, 'http://placeholder').searchParams;
  const link = buildDeepLink(searchParams);

  if (!link) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end('Invalid Pulse Cam link.');
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  res.end(page(link.deepLink, link.artifactId));
});
