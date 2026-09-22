/**
 * Reject oversized /api bodies before the wormhole REST bridge reads them.
 *
 * The bridge already caps JSON bodies at 1 MB and answers 413 — but it calls
 * `req.destroy()` first, tearing the socket down before that response is
 * flushed. The browser is left with a socket error on a cross-origin request
 * and reports it as a CORS failure ("No 'Access-Control-Allow-Origin' header"),
 * so an over-limit call surfaces as an unexplained `TypeError: Failed to fetch`
 * instead of "that post is too large".
 *
 * Answering here — from Content-Length, before a byte of the body is read —
 * keeps the socket intact, and the global CORS handler in `main.js` has already
 * set its headers on `res` by this point, so they ride along. The client gets a
 * real 413 with a message it can show.
 *
 * This is a guard, not a ceiling to grow: a huddle post is text plus a handful
 * of attachment references. Anything approaching 1 MB means media is being
 * inlined into the document rather than uploaded, which is a bug in the caller.
 */

/** Must match MAX_BODY_SIZE in the wormhole REST bridge. */
const MAX_API_BODY_SIZE = 1024 * 1024;

export function apiBodyLimitMiddleware(req, res, next) {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > MAX_API_BODY_SIZE) {
    res.writeHead(413, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        error: 'payload-too-large',
        message:
          `Request body is ${(declared / 1048576).toFixed(1)} MB, over the ` +
          `${MAX_API_BODY_SIZE / 1048576} MB limit.`,
      }),
    );
    return;
  }
  next();
}
