/**
 * Pure shaping of raw Redmine issues into the client-safe DTO the unified
 * ticket list renders (M2.1; read-only).
 *
 * Kept free of Meteor imports so it can be unit-tested directly (see
 * tests/redmine-issues.test.ts).
 *
 * M2 deliberately mapped only `id`/`subject`/`project`/`status`/`assignedTo`.
 * M2.1 merges Redmine issues with Huddle tickets into one sortable, filterable
 * list, which needs three more things that are *not* presentational extras:
 *   - `createdAt` / `updatedAt` — without them a merged list cannot be sorted
 *     chronologically at all,
 *   - `priority` — so the shared priority filter means the same thing for both
 *     sources,
 *   - `status.isClosed` — drives the existing Open/Closed tabs. Redmine statuses
 *     are instance-defined free text, so the name alone cannot tell us whether
 *     an issue is closed.
 * `tracker` is mapped too: it is Redmine's nearest equivalent to a ticket type
 * and rides along at zero cost. Everything else Redmine returns (due_date,
 * description, custom fields, …) is still intentionally dropped.
 */

/** Shape a Redmine `{ id, name }` sub-object, or null when absent. */
function toNamed(value) {
  if (!value || typeof value !== 'object' || value.id == null) return null;
  return { id: value.id, name: value.name ?? '' };
}

/**
 * Shape an issue status, preserving `is_closed`.
 *
 * Older Redmine versions omit `is_closed` from the issue payload, so treat a
 * missing flag as "not closed" rather than guessing from the status name.
 */
function toStatus(value) {
  const named = toNamed(value);
  if (!named) return null;
  return { ...named, isClosed: value.is_closed === true };
}

/** Normalize a Redmine timestamp to an ISO string, or null when absent. */
function toIsoDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/**
 * Shape a single raw Redmine issue into our read-only DTO.
 * @param {object} issue  a raw issue from `GET /issues.json`
 */
export function toIssue(issue) {
  return {
    id: issue.id,
    subject: issue.subject ?? '',
    project: toNamed(issue.project),
    status: toStatus(issue.status),
    assignedTo: toNamed(issue.assigned_to),
    priority: toNamed(issue.priority),
    tracker: toNamed(issue.tracker),
    createdAt: toIsoDate(issue.created_on),
    updatedAt: toIsoDate(issue.updated_on),
  };
}

/**
 * Shape a raw Redmine issues array into our minimal DTO list.
 * Non-array input yields an empty list.
 * @param {unknown} raw  the `issues` array from `GET /issues.json`
 */
export function toIssueList(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map(toIssue);
}
