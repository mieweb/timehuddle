/**
 * Thin fetch wrapper around the Redmine REST API.
 *
 * Every helper takes the caller's Redmine `account` — `{ apiKey, baseUrl }`,
 * resolved by `findRedmineAccount` — so each request goes to the instance that
 * issued the key. That is the shared `REDMINE_BASE_URL`, unless the deployment
 * sets `REDMINE_ALLOW_CUSTOM_URL=true` and the user linked their own URL. The
 * personal API key is injected as the `X-Redmine-API-Key` header so every
 * request is attributed to that user (no admin switch-user needed).
 *
 * Helpers are added milestone by milestone to avoid dead code: `getCurrentUser`
 * (M1 key validation + identity), `listIssues` (M2 read-only issue list),
 * `getIssue`/`listIssuesByIds` (M3 existence check + title resolution for
 * source-aware ticket timers), `listTimeEntryActivities` (M4 activity
 * resolution), `createTimeEntry`/`getTimeEntry` (M5 push + read-back), and the
 * M6 issue helpers (projects, trackers, members, priorities, issue detail,
 * `createIssue`/`updateIssue`).
 *
 * **Every issue read is filtered (MVP2).** `issueQuery` is the single door to
 * `/issues.json` and refuses a query that narrows nothing, so "list the whole
 * instance" is not expressible here. Its callers are the relevant-list signals
 * (`listAssignedIssues`, `listWatchedIssues`, `listTimeEntryIssueIds`,
 * `listActivityIssueIds`), search (`listIssuesAssignedTo`, `searchIssues`) and
 * `listIssuesByIds`.
 *
 * **Writes, and only these three:** `createTimeEntry`, `createIssue` and
 * `updateIssue`. Time entries stay create-only (D1): once time is logged it is
 * permanent, and changing it is an administrative act performed in Redmine
 * itself, so no update or delete helper exists for them. Issues are never
 * deleted from TimeHuddle either (M6 scope).
 */
import { activityIssueRefs } from './redmine-atom';

/** Server-wide Redmine base URL, trailing slash trimmed. Throws if unset. */
export function redmineBaseUrl() {
  const url = process.env.REDMINE_BASE_URL;
  if (typeof url !== 'string' || url.trim().length === 0) {
    throw new Error('REDMINE_BASE_URL is not configured');
  }
  return url.trim().replace(/\/+$/, '');
}

/**
 * The configured base URL, or null when Redmine is unconfigured. Read paths use
 * this — a missing URL just means "no link to render", not a failure.
 */
export function optionalRedmineBaseUrl() {
  try {
    return redmineBaseUrl();
  } catch {
    return null;
  }
}

/**
 * Whether users may link a Redmine URL of their own (dev/test deployments).
 *
 * Off unless explicitly enabled: the server fetches whatever URL is linked, so
 * a user-supplied one lets any signed-in user aim server-side requests at an
 * arbitrary host. Never enable it in production.
 */
export function customRedmineUrlAllowed() {
  return process.env.REDMINE_ALLOW_CUSTOM_URL === 'true';
}

/**
 * A user-supplied Redmine URL in canonical form (`origin` + path, trailing
 * slash trimmed — Redmine may live under a sub-path), or null when it is not a
 * plain http(s) URL. Credentials, query strings and fragments are rejected
 * rather than silently dropped.
 */
export function normalizeRedmineUrl(raw) {
  if (typeof raw !== 'string') return null;
  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password || url.search || url.hash) return null;
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

/**
 * The instance a link talks to: the URL stored on it while custom URLs are
 * allowed, otherwise the server's. Turning the flag off therefore sends every
 * user back to `REDMINE_BASE_URL` without touching their rows.
 */
export function linkedRedmineBaseUrl(storedUrl) {
  return (customRedmineUrlAllowed() && storedUrl) || optionalRedmineBaseUrl();
}

/** Whether this process is a production deployment (what `Meteor.isProduction` reads). */
function inProduction() {
  return process.env.NODE_ENV === 'production';
}

/**
 * Hosts a production deployment may send Redmine requests to, from
 * `REDMINE_ALLOWED_HOSTS` (comma-separated `host[:port]`).
 *
 * The server's own `REDMINE_BASE_URL` is always allowed without being listed: it
 * is the deployment's own configuration, not user input, and requiring it to be
 * repeated here would break every existing install on upgrade.
 */
export function redmineAllowedHosts() {
  const configured = (process.env.REDMINE_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);

  const own = optionalRedmineBaseUrl();
  if (own) {
    try {
      configured.push(new URL(own).host.toLowerCase());
    } catch {
      /* an unparseable REDMINE_BASE_URL allows nothing extra */
    }
  }
  return configured;
}

/**
 * Why `baseUrl` may not be used, or null when it may.
 *
 * `REDMINE_ALLOW_CUSTOM_URL` lets a user store a Redmine URL of their own, and
 * the server then fetches it — which is a signed-in user choosing an address the
 * server will connect to, including internal hosts and cloud metadata endpoints.
 * The flag is meant for dev only, so this is the belt to its braces: in
 * production the host must be one the deployment named, and the scheme must be
 * `https`, whatever any stored row says.
 *
 * Development is left alone deliberately. The point of the flag there is pointing
 * at a Redmine on localhost over plain HTTP, and an allowlist would only be
 * something to switch off.
 */
export function redmineUrlRefusal(baseUrl) {
  if (!inProduction()) return null;
  if (typeof baseUrl !== 'string' || !baseUrl) return 'No Redmine base URL is configured';

  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    return 'That is not a usable Redmine URL';
  }
  if (url.protocol !== 'https:') return 'Redmine must be reached over https';
  if (!redmineAllowedHosts().includes(url.host.toLowerCase())) {
    return 'That Redmine host is not allowed by this deployment';
  }
  return null;
}

/**
 * Redmine's validation messages from a failed response body
 * (`{ errors: ["Subject cannot be blank"] }` on a 422), or an empty list.
 */
async function readErrorMessages(res) {
  try {
    const data = JSON.parse(await res.text());
    return Array.isArray(data?.errors) ? data.errors.map(String) : [];
  } catch {
    return [];
  }
}

/** How long an ordinary Redmine request may take before we give up. */
const DEFAULT_TIMEOUT_MS = 8000;

/**
 * How long the issue list may take. Listing every issue a key can see is the
 * one query that grows with the instance: on a large Redmine, visibility is
 * checked across every project the user belongs to, which can outlast the
 * default and surface as a false "unreachable".
 */
const LIST_TIMEOUT_MS = 30_000;

/** Whether `err` is our own request timeout (what `AbortSignal.timeout` throws). */
export function isRedmineTimeout(err) {
  return err?.name === 'TimeoutError';
}

/**
 * Perform an authenticated Redmine request. On a non-2xx response, throws an
 * Error with `.status` set so callers can distinguish auth failures (401/403)
 * from other problems, and `.errors` carrying Redmine's own validation messages
 * (the reason a 422 was rejected). Returns parsed JSON, or null for empty
 * bodies (e.g. the 204 an issue update answers with).
 */
async function redmineRequest(
  path,
  { account, method = 'GET', body, timeoutMs = DEFAULT_TIMEOUT_MS, accept = 'application/json' } = {},
) {
  if (!account?.baseUrl) throw new Error('No Redmine base URL is configured');
  const refusal = redmineUrlRefusal(account.baseUrl);
  if (refusal) throw new Error(refusal);

  const startedAt = Date.now();
  let res;
  try {
    res = await fetch(`${account.baseUrl}${path}`, {
      method,
      headers: {
        'X-Redmine-API-Key': account.apiKey,
        Accept: accept,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      // Bound the request so an unreachable/slow Redmine can't hang `redmine.connect`
      // (and the Settings UI) for the full default socket timeout.
      signal: AbortSignal.timeout(timeoutMs),
      // Never follow a redirect. Node's fetch keeps custom headers across a
      // cross-origin redirect, so a Redmine (or anything answering for its host)
      // could point us at a server of its choosing and be handed the user's
      // personal API key in the `X-Redmine-API-Key` header.
      redirect: 'manual',
    });
  } catch (err) {
    logRequestFailure({ method, path, startedAt, err });
    throw err;
  }

  if (res.status >= 300 && res.status < 400) {
    const err = new Error(`Redmine redirected (${res.status})`);
    err.status = res.status;
    err.redirected = true;
    logRequestFailure({ method, path, startedAt, err, status: res.status });
    throw err;
  }

  if (!res.ok) {
    const err = new Error(`Redmine request failed (${res.status})`);
    err.status = res.status;
    err.errors = await readErrorMessages(res);
    logRequestFailure({ method, path, startedAt, err, status: res.status });
    throw err;
  }

  const text = await res.text();
  if (accept !== 'application/json') return text;
  return text ? JSON.parse(text) : null;
}

/**
 * Log why a Redmine request failed, in enough detail to debug and no more.
 *
 * Deliberately **not** logged: the query string, the response body, and the
 * request headers. A query string carries search terms, and a user may type a
 * patient's name into the search box; a response body carries issue subjects and
 * descriptions; the headers carry the API key. The path without its query is
 * enough to tell a broken endpoint from a broken instance, and the duration is
 * what tells our own timeout apart from a refusal.
 */
function logRequestFailure({ method, path, startedAt, err, status = null }) {
  console.warn('[redmine] request failed', {
    method,
    path: path.split('?')[0],
    status,
    name: err?.name ?? null,
    code: err?.cause?.code ?? null,
    durationMs: Date.now() - startedAt,
  });
}

/**
 * `GET /issues.json` with an explicit, already-filtered query.
 *
 * Every issue read funnels through here, and the guard is the point: MVP2's
 * first acceptance criterion is that no code path can ask Redmine for issues
 * without narrowing them, and a helper added later that forgot to would fail
 * here rather than quietly listing the instance.
 */
async function issueQuery(account, params, { timeoutMs = LIST_TIMEOUT_MS } = {}) {
  const query = new URLSearchParams({ limit: '100', ...params });
  if (!ISSUE_FILTERS.some((name) => query.has(name))) {
    throw new Error('Refusing to list Redmine issues without a filter');
  }
  const data = await redmineRequest(`/issues.json?${query.toString()}`, { account, timeoutMs });
  return data?.issues ?? [];
}

/**
 * Query parameters that narrow `/issues.json` to a subset of the instance.
 * `status_id` is deliberately absent: "open issues only" is not a filter, it is
 * most of the database.
 */
const ISSUE_FILTERS = ['issue_id', 'assigned_to_id', 'watcher_id', 'author_id', 'project_id'];

/**
 * Fetch the Redmine user that owns `account`'s key via `GET /users/current.json`.
 * Works for any regular (non-admin) user and returns the caller's own record
 * (`id`, `login`, `firstname`, `lastname`, `mail`). Returns null if absent.
 */
export async function getCurrentUser(account) {
  const data = await redmineRequest('/users/current.json', { account });
  return data?.user ?? null;
}

/**
 * List issues visible to `account`'s key via `GET /issues.json`.
 *
 * `scope: 'mine'` restricts to issues assigned to the caller (`assigned_to_id=me`);
 * `scope: 'all'` lists everything the key can see. Pagination is bounded by
 * `limit`/`offset` (Redmine caps `limit` at 100). Returns the raw `issues` array
 * (shaping into our minimal DTO is done in redmine-issues.js).
 */
export async function listIssues(account, { scope = 'mine', limit = 100, offset = 0 } = {}) {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (scope === 'mine') params.set('assigned_to_id', 'me');
  const data = await redmineRequest(`/issues.json?${params.toString()}`, {
    account,
    timeoutMs: LIST_TIMEOUT_MS,
  });
  return data?.issues ?? [];
}

/**
 * Open issues assigned to the caller, most recently updated first (MVP2 A1).
 *
 * The strongest standing signal of what someone is meant to be working on, and
 * the one query that is both cheap and bounded on a large instance: Redmine
 * filters by assignee before it checks visibility.
 */
export function listAssignedIssues(account, { timeoutMs } = {}) {
  return issueQuery(
    account,
    { assigned_to_id: 'me', status_id: 'open', sort: 'updated_on:desc', limit: '100' },
    { timeoutMs },
  );
}

/** Open issues the caller watches (MVP2 A1). A standing interest, so a smaller page. */
export function listWatchedIssues(account, { timeoutMs } = {}) {
  return issueQuery(account, { watcher_id: 'me', status_id: 'open', limit: '50' }, { timeoutMs });
}

/**
 * Open issues assigned to one Redmine user id (MVP2 A2, the `@name` search).
 *
 * Separate from `listAssignedIssues` because the id is not `me`: the caller is
 * asking what someone else is carrying, which their own key still gates.
 */
export function listIssuesAssignedTo(account, redmineUserId, { limit = 25, timeoutMs } = {}) {
  return issueQuery(
    account,
    { assigned_to_id: String(redmineUserId), status_id: 'open', limit: String(limit) },
    { timeoutMs },
  );
}

/**
 * The issues the caller logged time against since `from`, as `{ issueId, at }`
 * per entry (MVP2 A1).
 *
 * `at` is the entry's `spent_on` — the day the work happened, which is what the
 * signal decays on, not when the row was typed in. Comments are dropped here:
 * a time-entry comment is free text on an enterprise instance, and nothing
 * downstream has a use for it.
 */
export async function listTimeEntryIssueIds(account, { from, timeoutMs } = {}) {
  const params = new URLSearchParams({ user_id: 'me', limit: '100' });
  if (from) params.set('from', from);
  const data = await redmineRequest(`/time_entries.json?${params.toString()}`, { account, timeoutMs });
  return (data?.time_entries ?? [])
    .filter((entry) => entry?.issue?.id != null)
    .map((entry) => ({ issueId: Number(entry.issue.id), at: entry.spent_on ?? null }));
}

/**
 * The issues the caller's own activity feed mentions since `from`, as
 * `{ issueId, at }` (MVP2 A1).
 *
 * Atom, not JSON: Redmine has no REST endpoint for a user's activity. The feed
 * is the one response in this integration that carries issue subjects and note
 * bodies, so it is reduced to ids and dates the moment it arrives — see
 * redmine-atom.js for why, and for what is thrown away.
 *
 * The key travels in the `X-Redmine-API-Key` header here as everywhere else. An
 * instance that only accepts `?key=` for Atom will answer 401, and the caller
 * drops the signal rather than putting the key in a URL.
 */
export async function listActivityIssueIds(account, { redmineUserId, from, timeoutMs } = {}) {
  const params = new URLSearchParams({ user_id: String(redmineUserId) });
  if (from) params.set('from', from);
  const xml = await redmineRequest(`/activity.atom?${params.toString()}`, {
    account,
    timeoutMs,
    accept: 'application/atom+xml',
  });
  return activityIssueRefs(xml);
}

/**
 * Fetch one issue via `GET /issues/{id}.json`, or null when it does not exist
 * (or the key cannot see it — Redmine reports both as 404, and the distinction
 * does not matter to a caller that only needs "can this user time this issue").
 */
export async function getIssue(account, issueId) {
  try {
    const data = await redmineRequest(`/issues/${issueId}.json`, { account });
    return data?.issue ?? null;
  } catch (err) {
    if (err?.status === 404 || err?.status === 403) return null;
    throw err;
  }
}

/**
 * List the instance's time-entry activities via
 * `GET /enumerations/time_entry_activities.json`.
 *
 * Enumerable with an ordinary personal key — no admin rights needed. Redmine
 * rejects a time entry with no `activity_id`, and this instance has no
 * `is_default` activity, so the id has to be resolved from here at runtime
 * rather than hardcoded (enumeration ids are instance-specific and an admin can
 * renumber them).
 */
export async function listTimeEntryActivities(account) {
  const data = await redmineRequest('/enumerations/time_entry_activities.json', { account });
  return data?.time_entry_activities ?? [];
}

/**
 * Fetch several issues by id in one request.
 *
 * `status_id=*` is required: `/issues.json` defaults to open issues only, and a
 * timesheet has to resolve the subject of an issue that has since been closed.
 * Redmine caps `limit` at 100, which also bounds how many ids are worth asking
 * for in a single call.
 */
export function listIssuesByIds(account, issueIds, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!issueIds.length) return Promise.resolve([]);
  return issueQuery(
    account,
    {
      issue_id: issueIds.join(','),
      status_id: '*',
      limit: String(Math.min(issueIds.length, 100)),
    },
    { timeoutMs },
  );
}

/**
 * Search issue **titles** via `GET /search.json`, and return the matching issue
 * ids and nothing else (MVP2 A2).
 *
 * `titles_only=1` is not a nicety: without it Redmine matches descriptions and
 * notes, which on the enterprise instance is where clinical detail lives, so a
 * user typing a common word could be handed issues they were only searching
 * *near*. `open_issues=1` keeps the result to live work.
 *
 * Redmine's search result carries a `title` and a `description` excerpt — both
 * free text, the excerpt drawn from the issue body. Both are dropped here, and
 * the ids are resolved through `listIssuesByIds`, so a search answers with the
 * same slim shape as everything else and there is no second path for issue text
 * to travel down.
 */
export async function searchIssues(account, query, { limit = 25, timeoutMs } = {}) {
  const params = new URLSearchParams({
    q: query,
    issues: '1',
    titles_only: '1',
    open_issues: '1',
    limit: String(limit),
  });
  const data = await redmineRequest(`/search.json?${params.toString()}`, { account, timeoutMs });
  return (data?.results ?? [])
    .filter((result) => result?.type == null || result.type === 'issue')
    .map((result) => Number(result?.id))
    .filter((id) => Number.isSafeInteger(id) && id > 0);
}

/**
 * Create one time entry via `POST /time_entries.json`, attributed to the owner
 * of `account`'s key.
 *
 * **Create-only and permanent (D1).** Requires the caller's Redmine
 * role to hold `log_time`; without it every call returns `403`. `activity_id` is
 * mandatory on this instance (it has no `is_default` activity), so omitting it
 * fails with `422 Activity cannot be blank`.
 *
 * @param {object} account      the caller's `{ apiKey, baseUrl }`
 * @param {object} entry
 * @param {number} entry.issueId    Redmine issue id
 * @param {number} entry.hours      decimal hours, already rounded by the caller
 * @param {number} entry.activityId resolved enumeration id — never hardcoded
 * @param {string} entry.spentOn    the day being logged, `YYYY-MM-DD`
 * @param {string} [entry.comments] free text shown in Redmine's Spent time tab
 * @returns {Promise<object|null>} the created entry as Redmine echoes it back
 */
export async function createTimeEntry(account, { issueId, hours, activityId, spentOn, comments }) {
  const data = await redmineRequest('/time_entries.json', {
    account,
    method: 'POST',
    body: {
      time_entry: {
        issue_id: issueId,
        hours,
        activity_id: activityId,
        spent_on: spentOn,
        ...(comments ? { comments } : {}),
      },
    },
  });
  return data?.time_entry ?? null;
}

/**
 * Fetch one time entry via `GET /time_entries/{id}.json`, or null when it is
 * gone. Used to confirm a write actually stored what we sent — Redmine can
 * answer `201` while persisting something else, and the cross-cutting
 * definition of done requires confirmation-by-read for every write.
 */
export async function getTimeEntry(account, entryId) {
  try {
    const data = await redmineRequest(`/time_entries/${entryId}.json`, { account });
    return data?.time_entry ?? null;
  } catch (err) {
    if (err?.status === 404 || err?.status === 403) return null;
    throw err;
  }
}

// ─── M6: issue create / edit ─────────────────────────────────────────────────

/** Upper bound on paginated reads, so a huge instance cannot stall a dropdown. */
const MAX_PAGED_ITEMS = 1000;

/**
 * Fetch every page of a Redmine list endpoint, following `total_count`.
 * `field` names the array in each response (`projects`, `memberships`, …).
 */
async function listAllPages(account, path, field) {
  const items = [];
  for (let offset = 0; offset < MAX_PAGED_ITEMS; offset += 100) {
    const joiner = path.includes('?') ? '&' : '?';
    const data = await redmineRequest(`${path}${joiner}limit=100&offset=${offset}`, { account });
    const page = data?.[field] ?? [];
    items.push(...page);
    if (page.length < 100 || items.length >= (data?.total_count ?? 0)) break;
  }
  return items;
}

/** Projects the key can see (`GET /projects.json`), all pages. */
export function listProjects(account) {
  return listAllPages(account, '/projects.json', 'projects');
}

/** The trackers enabled on one project (`GET /projects/{id}.json?include=trackers`). */
export async function listProjectTrackers(account, projectId) {
  const data = await redmineRequest(`/projects/${projectId}.json?include=trackers`, { account });
  return data?.project?.trackers ?? [];
}

/**
 * A project's memberships (`GET /projects/{id}/memberships.json`), all pages.
 * Each entry carries either a `user` or a `group`; shaping decides which count.
 */
export function listProjectMemberships(account, projectId) {
  return listAllPages(account, `/projects/${projectId}/memberships.json`, 'memberships');
}

/**
 * The instance's issue statuses (`GET /issue_statuses.json`). Readable with an
 * ordinary key; used to name the status ids an issue's history records.
 */
export async function listIssueStatuses(account) {
  const data = await redmineRequest('/issue_statuses.json', { account });
  return data?.issue_statuses ?? [];
}

/** The instance's issue priorities (`GET /enumerations/issue_priorities.json`). */
export async function listIssuePriorities(account) {
  const data = await redmineRequest('/enumerations/issue_priorities.json', { account });
  return data?.issue_priorities ?? [];
}

/**
 * One issue with the status transitions the caller's role and workflow allow
 * (`include=allowed_statuses`, Redmine 5.0+) and its history (`journals`), or
 * null when it does not exist or the key cannot see it — the same contract as
 * `getIssue`.
 */
export async function getIssueDetail(account, issueId) {
  try {
    const data = await redmineRequest(`/issues/${issueId}.json?include=allowed_statuses,journals`, {
      account,
    });
    return data?.issue ?? null;
  } catch (err) {
    if (err?.status === 404 || err?.status === 403) return null;
    throw err;
  }
}

/**
 * Create an issue via `POST /issues.json`, authored by the owner of `account`'s key.
 * `fields` are already in Redmine's names (`project_id`, `subject`, …).
 * @returns {Promise<object|null>} the created issue as Redmine echoes it back
 */
export async function createIssue(account, fields) {
  const data = await redmineRequest('/issues.json', {
    account,
    method: 'POST',
    body: { issue: fields },
  });
  return data?.issue ?? null;
}

/**
 * Update an issue via `PUT /issues/{id}.json`. Redmine answers `204` with no
 * body, so nothing is returned — callers re-read to see what was stored.
 * Send only the fields that changed: Redmine has no optimistic locking, and an
 * untouched field in the payload would overwrite a concurrent edit.
 */
export async function updateIssue(account, issueId, fields) {
  await redmineRequest(`/issues/${issueId}.json`, {
    account,
    method: 'PUT',
    body: { issue: fields },
  });
}
