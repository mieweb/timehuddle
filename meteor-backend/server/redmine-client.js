/**
 * Thin fetch wrapper around the Redmine REST API.
 *
 * Redmine is a single shared instance configured via `REDMINE_BASE_URL`; the
 * per-user personal API key is injected as the `X-Redmine-API-Key` header so
 * every request is attributed to that user (no admin switch-user needed).
 *
 * Helpers are added milestone by milestone to avoid dead code: `getCurrentUser`
 * (M1 key validation + identity), `listIssues` (M2 read-only issue list),
 * `getIssue`/`listIssuesByIds` (M3 existence check + title resolution for
 * source-aware ticket timers), `listTimeEntryActivities` (M4 activity
 * resolution), `createTimeEntry`/`getTimeEntry` (M5 push + read-back), and the
 * M6 issue helpers (projects, trackers, members, priorities, issue detail,
 * `createIssue`/`updateIssue`).
 *
 * **Writes, and only these three:** `createTimeEntry`, `createIssue` and
 * `updateIssue`. Time entries stay create-only (D1): once time is logged it is
 * permanent, and changing it is an administrative act performed in Redmine
 * itself, so no update or delete helper exists for them. Issues are never
 * deleted from TimeHuddle either (M6 scope).
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

/**
 * Perform an authenticated Redmine request. On a non-2xx response, throws an
 * Error with `.status` set so callers can distinguish auth failures (401/403)
 * from other problems, and `.errors` carrying Redmine's own validation messages
 * (the reason a 422 was rejected). Returns parsed JSON, or null for empty
 * bodies (e.g. the 204 an issue update answers with).
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
    // Bound the request so an unreachable/slow Redmine can't hang `redmine.connect`
    // (and the Settings UI) for the full default socket timeout.
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) {
    const err = new Error(`Redmine request failed (${res.status})`);
    err.status = res.status;
    err.errors = await readErrorMessages(res);
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

/**
 * List issues visible to `apiKey` via `GET /issues.json`.
 *
 * `scope: 'mine'` restricts to issues assigned to the caller (`assigned_to_id=me`);
 * `scope: 'all'` lists everything the key can see. Pagination is bounded by
 * `limit`/`offset` (Redmine caps `limit` at 100). Returns the raw `issues` array
 * (shaping into our minimal DTO is done in redmine-issues.js).
 */
export async function listIssues(apiKey, { scope = 'mine', limit = 100, offset = 0 } = {}) {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (scope === 'mine') params.set('assigned_to_id', 'me');
  const data = await redmineRequest(`/issues.json?${params.toString()}`, { apiKey });
  return data?.issues ?? [];
}

/**
 * Fetch one issue via `GET /issues/{id}.json`, or null when it does not exist
 * (or the key cannot see it — Redmine reports both as 404, and the distinction
 * does not matter to a caller that only needs "can this user time this issue").
 */
export async function getIssue(apiKey, issueId) {
  try {
    const data = await redmineRequest(`/issues/${issueId}.json`, { apiKey });
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
export async function listTimeEntryActivities(apiKey) {
  const data = await redmineRequest('/enumerations/time_entry_activities.json', { apiKey });
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
export async function listIssuesByIds(apiKey, issueIds) {
  if (!issueIds.length) return [];
  const params = new URLSearchParams({
    issue_id: issueIds.join(','),
    status_id: '*',
    limit: String(Math.min(issueIds.length, 100)),
  });
  const data = await redmineRequest(`/issues.json?${params.toString()}`, { apiKey });
  return data?.issues ?? [];
}

/**
 * Create one time entry via `POST /time_entries.json`, attributed to the owner
 * of `apiKey`.
 *
 * **Create-only and permanent (D1).** Requires the caller's Redmine
 * role to hold `log_time`; without it every call returns `403`. `activity_id` is
 * mandatory on this instance (it has no `is_default` activity), so omitting it
 * fails with `422 Activity cannot be blank`.
 *
 * @param {string} apiKey        the caller's personal Redmine API key
 * @param {object} entry
 * @param {number} entry.issueId    Redmine issue id
 * @param {number} entry.hours      decimal hours, already rounded by the caller
 * @param {number} entry.activityId resolved enumeration id — never hardcoded
 * @param {string} entry.spentOn    the day being logged, `YYYY-MM-DD`
 * @param {string} [entry.comments] free text shown in Redmine's Spent time tab
 * @returns {Promise<object|null>} the created entry as Redmine echoes it back
 */
export async function createTimeEntry(apiKey, { issueId, hours, activityId, spentOn, comments }) {
  const data = await redmineRequest('/time_entries.json', {
    apiKey,
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
export async function getTimeEntry(apiKey, entryId) {
  try {
    const data = await redmineRequest(`/time_entries/${entryId}.json`, { apiKey });
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
async function listAllPages(apiKey, path, field) {
  const items = [];
  for (let offset = 0; offset < MAX_PAGED_ITEMS; offset += 100) {
    const joiner = path.includes('?') ? '&' : '?';
    const data = await redmineRequest(`${path}${joiner}limit=100&offset=${offset}`, { apiKey });
    const page = data?.[field] ?? [];
    items.push(...page);
    if (page.length < 100 || items.length >= (data?.total_count ?? 0)) break;
  }
  return items;
}

/** Projects the key can see (`GET /projects.json`), all pages. */
export function listProjects(apiKey) {
  return listAllPages(apiKey, '/projects.json', 'projects');
}

/** The trackers enabled on one project (`GET /projects/{id}.json?include=trackers`). */
export async function listProjectTrackers(apiKey, projectId) {
  const data = await redmineRequest(`/projects/${projectId}.json?include=trackers`, { apiKey });
  return data?.project?.trackers ?? [];
}

/**
 * A project's memberships (`GET /projects/{id}/memberships.json`), all pages.
 * Each entry carries either a `user` or a `group`; shaping decides which count.
 */
export function listProjectMemberships(apiKey, projectId) {
  return listAllPages(apiKey, `/projects/${projectId}/memberships.json`, 'memberships');
}

/** The instance's issue priorities (`GET /enumerations/issue_priorities.json`). */
export async function listIssuePriorities(apiKey) {
  const data = await redmineRequest('/enumerations/issue_priorities.json', { apiKey });
  return data?.issue_priorities ?? [];
}

/**
 * One issue with the status transitions the caller's role and workflow allow
 * (`include=allowed_statuses`, Redmine 5.0+), or null when it does not exist or
 * the key cannot see it — the same contract as `getIssue`.
 */
export async function getIssueDetail(apiKey, issueId) {
  try {
    const data = await redmineRequest(`/issues/${issueId}.json?include=allowed_statuses`, { apiKey });
    return data?.issue ?? null;
  } catch (err) {
    if (err?.status === 404 || err?.status === 403) return null;
    throw err;
  }
}

/**
 * Create an issue via `POST /issues.json`, authored by the owner of `apiKey`.
 * `fields` are already in Redmine's names (`project_id`, `subject`, …).
 * @returns {Promise<object|null>} the created issue as Redmine echoes it back
 */
export async function createIssue(apiKey, fields) {
  const data = await redmineRequest('/issues.json', {
    apiKey,
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
export async function updateIssue(apiKey, issueId, fields) {
  await redmineRequest(`/issues/${issueId}.json`, {
    apiKey,
    method: 'PUT',
    body: { issue: fields },
  });
}
