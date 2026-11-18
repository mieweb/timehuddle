/**
 * The CORS decision for every route (DDP, /api, /pulsevault playback and
 * uploads, /pulse/captions, …), with no Meteor: which origins are let in, and
 * the headers they get. main.js mounts {@link createCorsMiddleware} first on
 * `WebApp.rawConnectHandlers`, so every route answers the same way.
 *
 * Media matters here as much as the API: a `<video>` or `<track>` in the web
 * app or in a native app's WebView (Capacitor) seeks with `Range`, and a
 * captions `<track>` is always fetched in CORS mode, so playback and captions
 * need the origin let in and the range headers allowed and exposed.
 */

/**
 * Native mobile app WebView origins. These are the app's own bundled WebView
 * (not a remote site), so they are always safe to allow:
 *   • Capacitor iOS      → capacitor://localhost
 *   • Capacitor Android  → https://localhost (androidScheme: 'https')
 *   • Legacy Ionic       → ionic://localhost
 */
export const NATIVE_APP_ORIGINS = new Set(['capacitor://localhost', 'https://localhost', 'ionic://localhost']);

/**
 * Hardcoded preview base domain — all MIEWeb Proxmox previews live here.
 * This guarantees CORS works for PR previews even if env vars are not injected.
 */
export const PREVIEW_BASE_DOMAINS = ['os.mieweb.org'];

export const CORS_ALLOW_METHODS = 'GET, POST, PUT, DELETE, OPTIONS, PATCH, HEAD';

/**
 * Request headers a cross-origin caller may send. Includes the TUS
 * resumable-upload protocol headers (@mieweb/pulsevault's /pulsevault/upload
 * route) — tus-js-client sends Tus-Resumable on every request, so without it
 * the browser blocks the preflight before the upload ever reaches the handler
 * — and `Range`, which a player seeking a video sends (a multi-range or
 * open-ended one is not CORS-safelisted, so it needs a preflight).
 */
export const CORS_ALLOW_HEADERS =
  'Content-Type, Authorization, X-Requested-With, Tus-Resumable, Upload-Length, Upload-Metadata, Upload-Offset, Upload-Concat, Upload-Defer-Length, Range';

/**
 * Response headers a cross-origin caller may read: the TUS ones an upload
 * needs, and the ones a ranged read of a video or captions file answers with.
 */
export const CORS_EXPOSE_HEADERS =
  'Location, Upload-Offset, Upload-Length, Tus-Resumable, Tus-Version, Tus-Max-Size, Tus-Extension, Content-Range, Accept-Ranges, Content-Length';

/**
 * RFC1918 private-LAN hostnames — dev live-reload serves the WebView from the
 * machine's LAN IP (e.g. http://10.3.95.139:3000), which changes with
 * DHCP/network and can't be pinned in ROOT_URL or CORS_ORIGINS. Without this,
 * the base domain (derived from ROOT_URL) is a meaningless string for a dotted
 * IPv4 host, so the origin never matches and CORS headers are skipped —
 * breaking raw XHR/fetch calls from the WebView (e.g. tus-js-client video
 * uploads) while native-bridge calls (CapacitorHttp) keep working, since those
 * aren't subject to CORS.
 */
export function isPrivateLanHost(hostname) {
  return (
    hostname === 'localhost' ||
    /^127\./.test(hostname) ||
    /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
    /^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(hostname)
  );
}

/**
 * The base domain ROOT_URL's origins share: its last three host labels
 * (os.mieweb.org), not just two, so as not to allow all of mieweb.org. Empty
 * for no ROOT_URL or a one-label host.
 */
export function baseDomainOf(rootUrl) {
  let hostname = '';
  try {
    hostname = new URL(rootUrl).hostname;
  } catch {
    return '';
  }
  return hostname.includes('.') ? hostname.split('.').slice(-3).join('.') : '';
}

/**
 * Which origins are let in.
 *
 * `corsOrigins` (CORS_ORIGINS): a comma-separated list of allowed origins, or
 * '*' for all. Beyond it: the native apps' WebViews, the preview domains, any
 * origin on ROOT_URL's base domain (PR previews where env vars may not
 * propagate), and — outside production only — any private-LAN origin.
 */
export function createOriginPolicy({ corsOrigins = '', rootUrl = '', isProduction = true } = {}) {
  const raw = corsOrigins || '';
  const allowAll = raw === '*';
  const allowed = raw
    ? raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  const baseDomain = baseDomainOf(rootUrl || '');

  function isOriginAllowed(origin) {
    if (!origin) return false;
    if (allowAll) return true;
    if (allowed.includes(origin)) return true;
    if (NATIVE_APP_ORIGINS.has(origin)) return true;
    try {
      const h = new URL(origin).hostname;
      for (const base of PREVIEW_BASE_DOMAINS) {
        if (h === base || h.endsWith('.' + base)) return true;
      }
      if (baseDomain && baseDomain !== 'localhost') {
        if (h === baseDomain || h.endsWith('.' + baseDomain)) return true;
      }
      if (!isProduction && isPrivateLanHost(h)) return true;
    } catch {
      /* not a URL: not allowed */
    }
    return false;
  }

  return { isOriginAllowed, corsOrigins: raw, baseDomain };
}

/**
 * What one request gets: `skip` for a route that answers its own CORS
 * (/uploads/tus), else the headers to set (null for an origin not let in)
 * and whether it is a preflight to end here with a 204.
 */
export function corsDecision({ method, url, origin }, isOriginAllowed) {
  if (url?.startsWith('/uploads/tus')) return { skip: true, headers: null, preflight: false };
  const headers = isOriginAllowed(origin)
    ? {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Allow-Methods': CORS_ALLOW_METHODS,
        'Access-Control-Allow-Headers': CORS_ALLOW_HEADERS,
        'Access-Control-Expose-Headers': CORS_EXPOSE_HEADERS,
        'Access-Control-Max-Age': '86400',
      }
    : null;
  return { skip: false, headers, preflight: method === 'OPTIONS' };
}

/** The connect middleware for {@link corsDecision}. */
export function createCorsMiddleware(isOriginAllowed) {
  return (req, res, next) => {
    const decision = corsDecision({ method: req.method, url: req.url, origin: req.headers.origin }, isOriginAllowed);
    if (decision.skip) return next();
    for (const [name, value] of Object.entries(decision.headers ?? {})) res.setHeader(name, value);
    if (decision.preflight) {
      res.writeHead(204);
      res.end();
      return;
    }
    next();
  };
}
