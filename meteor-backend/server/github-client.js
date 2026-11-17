/**
 * Asking GitHub with a member's own token (#873). The token comes from Connect
 * GitHub (github-connect.js) and is stored encrypted in `github_links`, one row
 * per member, like a Redmine key.
 *
 * Only GitHub's own addresses are called, with no redirects, a time limit and a
 * size limit. OAuth-app tokens don't expire, so there is nothing to refresh;
 * one GitHub no longer accepts marks the connection rejected. Tokens and query strings are
 * never logged.
 */
import { GithubLinks } from './collections';
import { decryptStoredSecret, encryptSecret, envKey } from './redmine-crypto';

export const GITHUB_HOST = 'github.com';
const REQUEST_MS = 10_000;
const MAX_ANSWER_CHARS = 20 * 1024 * 1024;

/** Overridable for tests only: production always talks to GitHub itself. */
const overridable = (name, fallback) =>
  (process.env.NODE_ENV !== 'production' && process.env[name]) || fallback;
export const githubApiUrl = () => overridable('GITHUB_API_URL', 'https://api.github.com');
export const githubWebUrl = () => overridable('GITHUB_WEB_URL', 'https://github.com');

/** Whether this deployment can start a GitHub connection. */
export const githubConfigured = () =>
  Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);

/** The stored field for the token GitHub answered with, encrypted. */
export function tokenFields({ access_token }) {
  return { token: encryptSecret(access_token, envKey()) };
}

/** Trade an OAuth code for a token at GitHub's OAuth endpoint. */
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

const tokenOf = (link) => decryptStoredSecret(link.token).secret;

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

/** The member's token; null when not connected. */
async function currentToken(userId) {
  const link = await GithubLinks.findOneAsync({ userId });
  return link ? tokenOf(link) : null;
}

/** Whether GitHub refused for its rate limit, which it answers as a 403 or a 429. */
const isRateLimit = (res) =>
  res.status === 429 || (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0');

/** A token GitHub no longer accepts stops being sent, and Settings says so. */
const markRejected = (userId) =>
  GithubLinks.updateAsync({ userId }, { $set: { rejectedAt: new Date() } });

/**
 * GitHub's answer for `path`, as `userId`. Throws an Error with `status` on a
 * refusal (and `rateLimited` for GitHub's rate limit); a 401 marks the
 * connection rejected.
 */
export async function githubRequest(path, userId, options) {
  const token = await currentToken(userId);
  if (!token) throw Object.assign(new Error('GitHub is not connected'), { status: 401 });
  const res = await send(path, token, options);
  if (res.status === 401) await markRejected(userId);
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
