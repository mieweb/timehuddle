/**
 * The Billable custom field on Redmine time entries (#686).
 *
 * The enterprise Redmine requires a time-entry custom field, "Billable status",
 * and refuses every entry without it ("Billable status cannot be blank"). A
 * personal API key cannot list custom fields (`/custom_fields.json` is admin
 * only), so neither the field's id nor its allowed values are known up front.
 * Both are read off time entries that already carry it: the newest on the same
 * issue, else in the same project, else the caller's own newest. An instance
 * without such a field (redmine0) finds nothing, and entries are sent as before.
 *
 * Only this one field is ever kept. A time entry's other custom fields and its
 * comment are free text on an enterprise instance, so they are dropped the
 * moment an entry is read.
 */

import { mapInChunks } from './redmine-client';

// Anchored: a free-text field such as "Billable notes" must never be copied.
const BILLABLE_NAME = /^billable( status)?$/i;

// Issues looked up at once, so a long preview is not one burst at Redmine.
const LOOKUPS_AT_ONCE = 5;

function hasValue(value) {
  return Array.isArray(value) ? value.length > 0 : typeof value === 'string' && value !== '';
}

/** The Billable field of one raw time entry, as `{ id, name, value }`, or null. */
export function billableFieldOf(entry) {
  const fields = Array.isArray(entry?.custom_fields) ? entry.custom_fields : [];
  const field = fields.find(
    (each) => each?.id != null && typeof each.name === 'string' && BILLABLE_NAME.test(each.name),
  );
  return field && hasValue(field.value)
    ? { id: field.id, name: field.name, value: field.value }
    : null;
}

/** The Billable field of the first entry in `entries` that has one set, or null. */
export function firstBillable(entries) {
  for (const entry of Array.isArray(entries) ? entries : []) {
    const field = billableFieldOf(entry);
    if (field) return field;
  }
  return null;
}

/**
 * The Billable field to send for each issue, keyed by issue id as a string.
 *
 * @param {Array<{id: number, project?: {id: number}}>} issues raw Redmine issues
 * @param {(params: object) => Promise<object|null>} recentBillable the Billable
 *   field on the newest time entry matching `params` (`issue_id`, `project_id`
 *   or `user_id`), or null. What it throws, this throws.
 */
export async function billableByIssue(issues, recentBillable) {
  // A project, or the caller's own entries, is asked once however many issues share it.
  const byProject = new Map();
  const forProject = (projectId) => {
    if (!byProject.has(projectId)) {
      byProject.set(projectId, recentBillable({ project_id: projectId }));
    }
    return byProject.get(projectId);
  };
  let own;
  const forCaller = () => (own ??= recentBillable({ user_id: 'me' }));

  const pairs = await mapInChunks(issues, LOOKUPS_AT_ONCE, async (issue) => {
      const projectId = issue.project?.id ?? null;
      const field =
        (await recentBillable({ issue_id: issue.id })) ??
        (projectId != null ? await forProject(projectId) : null) ??
        (await forCaller());
      return [String(issue.id), field];
  });
  return new Map(pairs);
}
