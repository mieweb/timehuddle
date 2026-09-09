/**
 * Thin fetch wrapper around the Redmine REST API.
 *
 * Redmine is a single shared instance configured via `REDMINE_BASE_URL`; the
 * per-user personal API key is injected as the `X-Redmine-API-Key` header so
 * every request is attributed to that user (no admin switch-user needed).
 *
 * Milestone 1 only needs `getCurrentUser` (key validation + identity). Issue
 * and time-entry helpers are added in their own milestones to avoid dead code.
 */

/** Server-wide Redmine base URL, trailing slash trimmed. Throws if unset. */
export function redmineBaseUrl() {
  const url = process.env.REDMINE_BASE_URL;
  if (typeof url !== 'string' || url.trim().length === 0) {
    throw new Error('REDMINE_BASE_URL is not configured');
  }
  return url.trim().replace(/\/+$/, '');
}

/**
 * Perform an authenticated Redmine request. On a non-2xx response, throws an
 * Error with `.status` set so callers can distinguish auth failures (401/403)
 * from other problems. Returns parsed JSON, or null for empty bodies (e.g. 204).
 */
async function redmineRequest(path, { apiKey, method = 'GET', body } = {}) {
  const res = await fetch(`${redmineBaseUrl()}${path}`, {
    method,
    headers: {
      'X-Redmine-API-Key': apiKey,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (!res.ok) {
    const err = new Error(`Redmine request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }

  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

/**
 * Fetch the account that owns `apiKey` via `GET /users/current.json`.
 * Works for any regular (non-admin) user and returns the caller's own record
 * (`id`, `login`, `firstname`, `lastname`, `mail`). Returns null if absent.
 */
export async function getCurrentUser(apiKey) {
  const data = await redmineRequest('/users/current.json', { apiKey });
  return data?.user ?? null;
}
