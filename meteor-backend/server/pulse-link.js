/**
 * /pulse/open — kept only as a redirect for older links.
 *
 *   GET /pulse/open?v=1&artifactId=…&server=…&token=…
 *     → 302 https://mieweb.github.io/pulse/open#v=1&artifactId=…&server=…&token=…
 *
 * Pairing links are now Pulse's own https link (PULSE_OPEN_URL, built in
 * src/features/pulse-upload/pulseLinks.ts): a Universal Link / App Link that
 * opens Pulse when it's installed, and whose page sends the person to the App
 * Store or Google Play when it isn't. TimeHuddle no longer handles either.
 * This route used to be that page; a QR code shown by an older app bundle (one
 * that hasn't taken its update yet) still points here, so it forwards the
 * pairing parameters there, in the fragment. Remove once no bundle builds it.
 *
 * It is still a public URL on TimeHuddle's domain that hands Pulse an upload
 * destination, so it forwards only what TimeHuddle itself would have made: an
 * upload to its own PulseVault, with a token that authorizes that artifact.
 */
import { WebApp } from 'meteor/webapp';
import { PULSE_OPEN_URL } from '@mieweb/pulsevault/core';

import { verifyUploadToken } from './pulsevault.js';

/** The pairing parameters (PROTOCOL.md §3); anything else is dropped. */
const PAIRING_PARAMS = ['v', 'artifactId', 'server', 'token'];
const MAX_PARAM_LENGTH = 2048;

/** The `/pulsevault` mount on a given origin — the only place a clip may go. */
function uploadServerFor(origin) {
  return `${origin.replace(/\/$/, '')}/pulsevault`;
}

/**
 * Upload targets this backend vouches for. `server` tells Pulse where to send
 * the recording; accepting any value would make this a link on TimeHuddle's
 * domain that uploads someone's video to another server. Both ROOT_URL and the
 * request's own origin count: dev serves the stack from a LAN IP that ROOT_URL
 * can lag behind, and the QR is built from the frontend's configured backend
 * URL, which is not necessarily spelled the same way as ROOT_URL.
 */
function allowedUploadServers(req) {
  const servers = new Set();
  if (process.env.ROOT_URL) servers.add(uploadServerFor(process.env.ROOT_URL));
  const host = req.headers.host;
  if (host) {
    const proto = (req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim() || 'http';
    servers.add(uploadServerFor(`${proto}://${host}`));
  }
  return servers;
}

/**
 * The pairing parameters of an old `/pulse/open?…` link, or null when it isn't
 * one TimeHuddle would have made: no artifact or token, an oversized value, or
 * an upload server other than ours.
 */
export function pairingParams(search, allowedServers) {
  const from = new URLSearchParams(search);
  const to = new URLSearchParams();
  for (const key of PAIRING_PARAMS) {
    const value = from.get(key);
    if (!value) continue;
    if (value.length > MAX_PARAM_LENGTH) return null;
    to.set(key, value);
  }
  if (!to.get('artifactId') || !to.get('token')) return null;
  const server = to.get('server');
  if (server && !allowedServers.has(server.replace(/\/$/, ''))) return null;
  return to;
}

/** Where an old link's pairing parameters go now. */
export function pulseOpenRedirect(params) {
  return `${PULSE_OPEN_URL}#${params.toString()}`;
}

function refuse(res, status, message) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(message);
}

WebApp.connectHandlers.use('/pulse/open', async (req, res) => {
  const search = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  const params = pairingParams(search, allowedUploadServers(req));
  if (!params) {
    refuse(res, 400, 'Invalid Pulse link.');
    return;
  }

  // Only a token that really authorizes this artifact: a made-up or scraped
  // pair would otherwise open Pulse ready to record, and fail only after.
  // Checked as a read of the video's status (`create` would also apply the
  // shape of a pulse, which needs the upload's kind — there is no upload here).
  try {
    await verifyUploadToken(req, {
      artifactId: params.get('artifactId'),
      kind: 'video',
      phase: 'status',
      token: params.get('token'),
    });
  } catch {
    refuse(res, 403, 'This Pulse link is invalid or has expired.');
    return;
  }

  res.writeHead(302, {
    Location: pulseOpenRedirect(params),
    // The token is in the query: don't let a cache or the next page keep it.
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
  });
  res.end();
});
