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

/**
 * The Billable field of the first entry in `entries` that has one set, or null.
 * With `issueId`, only that issue's own entries count: Redmine's `issue_id`
 * filter can include subtasks, and a child's newer entry must not supply its
 * parent's value.
 */
export function firstBillable(entries, issueId) {
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (issueId != null && Number(entry?.issue?.id) !== Number(issueId)) continue;
    const field = billableFieldOf(entry);
    if (field) return field;
  }
  return null;
}

/**
 * Whether two Billable fields send the same thing: neither has one, or both
 * name the same field with the same value. A value that has been shown to the
 * user is checked against the one a send is about to use.
 */
export function sameBillable(shown, current) {
  if (!shown || !current) return !shown && !current;
  const words = (field) => [field.value].flat().join('\n');
  return shown.id === current.id && words(shown) === words(current);
}

/**
 * Thrown by a lookup that gave up before it had read every entry. The Billable
 * value is then unknown, not absent: a wider scope must not answer for it.
 */
export class BillableLookupIncomplete extends Error {
  constructor(params) {
    super(`The Billable lookup for ${JSON.stringify(params)} stopped before reading every entry.`);
    this.name = 'BillableLookupIncomplete';
    this.billableLookupIncomplete = true;
  }
}

/** True for what `BillableLookupIncomplete` raised, however many modules it crossed. */
export function isBillableLookupIncomplete(err) {
  return err?.billableLookupIncomplete === true;
}

/**
 * The Billable field on the newest entry of one scope, read a page at a time, or
 * null once every entry of the scope has been read and none has it.
 *
 * Reading stops after `maxPages` pages. A scope that long may still hold the
 * field further back, so that is `BillableLookupIncomplete`, not null. The end
 * is Redmine's own `total_count` when it gave one, so a scope of exactly
 * `maxPages` full pages counts as read in full; without it, a short page is the
 * end.
 *
 * @param {(offset: number, limit: number) => Promise<{entries: object[], totalCount?: number}>} fetchPage
 * @param {{issue_id?: number|string}} params the scope, as sent to Redmine
 */
export async function findBillableInPages(fetchPage, params, { pageSize = 100, maxPages = 3 } = {}) {
  for (let page = 0; page < maxPages; page += 1) {
    const offset = page * pageSize;
    const { entries, totalCount } = await fetchPage(offset, pageSize);
    const found = firstBillable(entries, params.issue_id);
    if (found) return found;
    const readSoFar = offset + entries.length;
    const atEnd = Number.isInteger(totalCount) ? readSoFar >= totalCount : entries.length < pageSize;
    if (atEnd || entries.length === 0) return null;
  }
  throw new BillableLookupIncomplete(params);
}

/**
 * The Billable field to send for each issue, keyed by issue id as a string.
 *
 * @param {Array<{id: number, project?: {id: number}}>} issues raw Redmine issues
 * @param {(params: Record<string, unknown>) => Promise<object|null>} recentBillable the Billable
 *   field on the newest time entry matching `params` (`issue_id`, `project_id`
 *   or `user_id`), or null. What it throws, this throws, except a
 *   `BillableLookupIncomplete`: that issue is left without a value, and no wider
 *   scope is asked in its place.
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
    const scopes = [
      () => recentBillable({ issue_id: issue.id }),
      ...(projectId != null ? [() => forProject(projectId)] : []),
      forCaller,
    ];
    try {
      for (const scope of scopes) {
        const field = await scope();
        if (field) return [String(issue.id), field];
      }
    } catch (err) {
      if (!isBillableLookupIncomplete(err)) throw err;
    }
    return [String(issue.id), null];
  });
  return new Map(pairs);
}
