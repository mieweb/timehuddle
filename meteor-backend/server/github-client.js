/**
 * Asking GitHub with a member's own token (#873). The token comes from Connect
 * GitHub (github-connect.js) and is stored encrypted in `github_links`, one row
 * per member, like a Redmine key.
 *
 * Only GitHub's own addresses are called, with no redirects, a time limit and a
 * size limit. An expiring token is refreshed here when it runs out; one GitHub
 * no longer accepts marks the connection rejected. Tokens and query strings are
 * never logged.
 */
import { GithubLinks } from './collections';
import { decryptStoredSecret, encryptSecret, envKey } from './redmine-crypto';

export const GITHUB_HOST = 'github.com';
const REQUEST_MS = 10_000;
const MAX_ANSWER_CHARS = 20 * 1024 * 1024;
const REFRESH_EARLY_MS = 60_000;

/** Overridable for tests only: production always talks to GitHub itself. */
const overridable = (name, fallback) =>
  (process.env.NODE_ENV !== 'production' && process.env[name]) || fallback;
export const githubApiUrl = () => overridable('GITHUB_API_URL', 'https://api.github.com');
export const githubWebUrl = () => overridable('GITHUB_WEB_URL', 'https://github.com');

/** Whether this deployment can start a GitHub connection. */
export const githubConfigured = () =>
  Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);

/** The stored fields for the tokens GitHub answered with, encrypted. */
export function tokenFields({ access_token, refresh_token, expires_in }) {
  const encrypted = (value) => encryptSecret(value, envKey());
  return {
    token: encrypted(access_token),
    ...(refresh_token ? { refreshToken: encrypted(refresh_token) } : {}),
    ...(expires_in ? { tokenExpiresAt: new Date(Date.now() + expires_in * 1000) } : {}),
  };
}

/** Trade a code or refresh token for tokens at GitHub's OAuth endpoint. */
export async function requestGithubToken(grant) {
  const res = await fetch(`${githubWebUrl()}/login/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(REQUEST_MS),
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      ...grant,
    }),
  });
  const data = await res.json().catch(() => ({}));
  return data?.access_token ? data : null;
}

const linkOf = (userId) => GithubLinks.findOneAsync({ userId });
const tokenOf = (link) => decryptStoredSecret(link.token).secret;

/**
 * A fresh access token for `userId`, saved, or null when GitHub won't give one.
 * Refresh tokens are single-use, so when another request refreshed first this
 * one's fails: the stored token is then the good one.
 */
async function refreshedToken(userId) {
  const link = await linkOf(userId);
  if (!link?.refreshToken) return null;
  const answer = await requestGithubToken({
    grant_type: 'refresh_token',
    refresh_token: decryptStoredSecret(link.refreshToken).secret,
  }).catch(() => null);
  if (!answer) {
    const now = await linkOf(userId);
    return now && now.token !== link.token ? tokenOf(now) : null;
  }
  await GithubLinks.updateAsync(link._id, { $set: tokenFields(answer) });
  return answer.access_token;
}

async function send(path, token, { method = 'GET', body } = {}) {
  return fetch(`${githubApiUrl()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'TimeHuddle',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    // Never followed: a renamed or moved repo answers 301, read as a refusal.
    redirect: 'manual',
    signal: AbortSignal.timeout(REQUEST_MS),
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

/** The current token, refreshed first when it's about to run out; null when not connected. */
async function currentToken(userId) {
  const link = await linkOf(userId);
  if (!link) return null;
  const expires = link.tokenExpiresAt?.getTime?.();
  if (expires && expires - Date.now() < REFRESH_EARLY_MS) {
    return (await refreshedToken(userId)) ?? tokenOf(link);
  }
  return tokenOf(link);
}

/** Whether GitHub refused for its rate limit, which it answers as a 403 or a 429. */
const isRateLimit = (res) =>
  res.status === 429 || (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0');

/** A token GitHub no longer accepts stops being sent, and Settings says so. */
const markRejected = (userId) =>
  GithubLinks.updateAsync({ userId }, { $set: { rejectedAt: new Date() } });

/**
 * GitHub's answer for `path`, as `userId`. Throws an Error with `status` on a
 * refusal (and `rateLimited` for GitHub's rate limit); a 401 is retried once
 * with a refreshed token, then marks the connection rejected.
 */
export async function githubRequest(path, userId, options) {
  const token = await currentToken(userId);
  if (!token) throw Object.assign(new Error('GitHub is not connected'), { status: 401 });
  let res = await send(path, token, options);
  if (res.status === 401) {
    const fresh = await refreshedToken(userId);
    if (fresh) res = await send(path, fresh, options);
    if (res.status === 401) await markRejected(userId);
  }
  if (!res.ok) {
    throw Object.assign(new Error(`GitHub answered ${res.status}`), {
      status: res.status,
      rateLimited: isRateLimit(res),
    });
  }
  if (res.status === 204) return null;
  const text = await res.text();
  if (text.length > MAX_ANSWER_CHARS) {
    throw Object.assign(new Error('GitHub answered too much'), { status: 502 });
  }
  return text ? JSON.parse(text) : null;
}

/** Best-effort: disconnecting shouldn't leave a working token behind at GitHub. */
export async function revokeGithubToken(link) {
  let token;
  try {
    token = link?.token ? tokenOf(link) : null;
  } catch {
    return; // Unreadable here, so unusable here too.
  }
  if (!token) return;
  const credentials = Buffer.from(
    `${process.env.GITHUB_CLIENT_ID}:${process.env.GITHUB_CLIENT_SECRET}`,
  ).toString('base64');
  await fetch(`${githubApiUrl()}/applications/${process.env.GITHUB_CLIENT_ID}/token`, {
    method: 'DELETE',
    headers: {
      Authorization: `Basic ${credentials}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'TimeHuddle',
      'Content-Type': 'application/json',
    },
    redirect: 'error',
    signal: AbortSignal.timeout(REQUEST_MS),
    body: JSON.stringify({ access_token: token }),
  }).catch(() => undefined);
}
