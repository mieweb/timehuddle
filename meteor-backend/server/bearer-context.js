/**
 * Per-request bearer token context using AsyncLocalStorage.
 *
 * The wormhole REST bridge (0.2.1) invokes Meteor methods via
 * Meteor.callAsync() but doesn't propagate the HTTP Authorization header.
 * This module provides the same `currentBearerToken()` API that existed
 * in the unpublished 0.3.0 build, using middleware + AsyncLocalStorage.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

const als = new AsyncLocalStorage();

/**
 * Returns the Bearer token for the current HTTP request, or null if
 * called outside an HTTP context (e.g. DDP).
 */
export function currentBearerToken() {
  const store = als.getStore();
  return store?.bearerToken ?? null;
}

/**
 * Connect/Express middleware that captures the Authorization: Bearer token
 * and makes it available via `currentBearerToken()` for the duration of
 * the request.
 *
 * Mount this BEFORE wormhole's REST bridge:
 *   WebApp.connectHandlers.use('/api', bearerContextMiddleware);
 */
export function bearerContextMiddleware(req, res, next) {
  const auth = req.headers['authorization'] || '';
  const bearerToken = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  als.run({ bearerToken }, () => next());
}
