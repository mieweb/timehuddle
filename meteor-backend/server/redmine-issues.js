/**
 * Pure shaping of raw Redmine issues into the minimal, client-safe DTO the
 * "Redmine Tickets" view renders (Milestone 2, read-only).
 *
 * Kept free of Meteor imports so it can be unit-tested directly (see
 * tests/redmine-issues.test.ts). Only the bare-minimum fields we actually show
 * are mapped — `id`, `subject`, `project`, `status`, `assignedTo`. Everything
 * else Redmine returns (tracker, priority, due_date, custom fields, …) is
 * intentionally dropped to keep the payload lean and the view simple.
 */

/** Shape a Redmine `{ id, name }` sub-object, or null when absent. */
function toNamed(value) {
  if (!value || typeof value !== 'object' || value.id == null) return null;
  return { id: value.id, name: value.name ?? '' };
}

/**
 * Shape a single raw Redmine issue into our minimal DTO.
 * @param {object} issue  a raw issue from `GET /issues.json`
 */
export function toIssue(issue) {
  return {
    id: issue.id,
    subject: issue.subject ?? '',
    project: toNamed(issue.project),
    status: toNamed(issue.status),
    assignedTo: toNamed(issue.assigned_to),
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
