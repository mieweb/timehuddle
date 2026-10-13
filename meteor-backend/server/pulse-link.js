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
 */
import { WebApp } from 'meteor/webapp';
import { PULSE_OPEN_URL } from '@mieweb/pulsevault/core';

/** The pairing parameters (PROTOCOL.md §3); anything else is dropped. */
const PAIRING_PARAMS = ['v', 'artifactId', 'server', 'token'];

/** Where an old `/pulse/open?…` link goes now. */
export function pulseOpenRedirect(search) {
  const from = new URLSearchParams(search);
  const to = new URLSearchParams();
  for (const key of PAIRING_PARAMS) {
    const value = from.get(key);
    if (value) to.set(key, value);
  }
  const fragment = to.toString();
  return fragment ? `${PULSE_OPEN_URL}#${fragment}` : PULSE_OPEN_URL;
}

WebApp.connectHandlers.use('/pulse/open', (req, res) => {
  const search = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  res.writeHead(302, {
    Location: pulseOpenRedirect(search),
    // The token is in the query: don't let a cache or the next page keep it.
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
  });
  res.end();
});
