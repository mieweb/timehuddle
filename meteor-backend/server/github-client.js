/**
 * Asking GitHub with a member's own token (#734 step 4). The token comes from
 * Connect GitHub (github-connect.js) and is stored like every other source key,
 * in `redmine_links`, under the host `github.com`.
 *
 * Only GitHub's own addresses are called, with no redirects, a time limit and a
 * size limit. An expiring token is refreshed here when it runs out; one GitHub
 * no longer accepts marks the account rejected, like a rejected Redmine key.
 * Tokens and query strings are never logged.
 */
import { RedmineLinks } from './collections';
import { decryptStoredSecret, encryptSecret, envKey } from './redmine-crypto';
import { keyOwnerOf } from './redmine-account';

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

/** The stored fields for the tokens GitHub answered with, encrypted for `owner`. */
export function tokenFields({ access_token, refresh_token, expires_in }, owner) {
  const encrypted = (value) => encryptSecret(value, envKey(), owner);
  return {
    apiKey: encrypted(access_token),
    ...(refresh_token ? { refreshKey: encrypted(refresh_token) } : {}),
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

const linkOf = (account) => RedmineLinks.findOneAsync(account.linkId);

/**
 * A fresh access token for `account`, saved, or null when GitHub won't give one.
 * Refresh tokens are single-use, so when another request refreshed first this
 * one's fails: the stored token is then the good one.
 */
async function refreshedToken(account) {
  const link = await linkOf(account);
  if (!link?.refreshKey) return null;
  const owner = keyOwnerOf(link);
  const answer = await requestGithubToken({
    grant_type: 'refresh_token',
    refresh_token: decryptStoredSecret(link.refreshKey, owner).secret,
  }).catch(() => null);
  if (!answer) {
    const now = await linkOf(account);
    return now && now.apiKey !== link.apiKey ? decryptStoredSecret(now.apiKey, owner).secret : null;
  }
  await RedmineLinks.updateAsync(link._id, { $set: tokenFields(answer, owner) });
  return answer.access_token;
}

async function send(path, token, { method = 'GET', body } = {}) {
  const res = await fetch(`${githubApiUrl()}${path}`, {
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
  return res;
}

/** The current token: refreshed first when it's about to run out. */
async function currentToken(account) {
  const link = await linkOf(account);
  const expires = link?.tokenExpiresAt?.getTime?.();
  if (expires && expires - Date.now() < REFRESH_EARLY_MS) {
    return (await refreshedToken(account)) ?? account.apiKey;
  }
  return link ? decryptStoredSecret(link.apiKey, keyOwnerOf(link)).secret : account.apiKey;
}

/** Whether GitHub refused for its rate limit, which it answers as a 403 or a 429. */
const isRateLimit = (res) =>
  res.status === 429 || (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0');

/**
 * GitHub's answer for `path`, as `account`. Throws an Error with `status` on a
 * refusal (and `rateLimited` for GitHub's rate limit); a 401 is retried once
 * with a refreshed token, then marks the account rejected.
 */
export async function githubRequest(path, account, options) {
  let res = await send(path, await currentToken(account), options);
  if (res.status === 401) {
    const token = await refreshedToken(account);
    if (token) res = await send(path, token, options);
    if (res.status === 401) await account.onKeyRejected?.();
  }
  if (!res.ok) {
    throw Object.assign(new Error(`GitHub answered ${res.status}`), {
      status: res.status,
      rateLimited: isRateLimit(res),
    });
  }
  if (res.status === 204) return null;
  const text = await res.text();
  if (text.length > MAX_ANSWER_CHARS) throw Object.assign(new Error('GitHub answered too much'), { status: 502 });
  return text ? JSON.parse(text) : null;
}

/** Best-effort: disconnecting shouldn't leave a working token behind at GitHub. */
export async function revokeGithubToken(token) {
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
