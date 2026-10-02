/**
 * Pure shaping of raw Redmine issues into the client-safe DTO the unified
 * ticket list renders.
 *
 * Redmine issues are merged with Huddle tickets into one sortable, filterable
 * list, so beyond the names the list DTO carries:
 *   - `createdAt` / `updatedAt` — without them a merged list cannot be sorted
 *     chronologically at all,
 *   - `priority` — so the shared priority filter means the same thing for both
 *     sources,
 *   - `status.isClosed` — drives the Open/Closed tabs. Redmine statuses are
 *     instance-defined free text, so the name alone cannot tell us whether an
 *     issue is closed.
 * Everything else Redmine returns (due_date, description, custom fields, …) is
 * intentionally dropped from the list. The create/edit forms and the issue page
 * get shapes of their own, kept separate so the list DTO stays lean.
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
export function toIsoDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/** Shape a single raw Redmine issue into our read-only DTO. */
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
 * Shape a list of Redmine `{ id, name }` objects, dropping malformed entries.
 * Used for projects and trackers.
 */
export function toNamedList(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map(toNamed).filter(Boolean);
}

/** Redmine stores `\r\n`; the edit form compares and sends `\n`. */
export function normalizeText(value) {
  return typeof value === 'string' ? value.replace(/\r\n/g, '\n') : '';
}

/**
 * Shape one raw issue (from `GET /issues/{id}.json?include=allowed_statuses`)
 * into the edit form's DTO: the list DTO plus `description`, `author` and
 * `allowedStatuses`.
 *
 * `allowedStatuses` always contains the current status, first: it is the
 * no-change choice, and Redmine does not reliably list it among the
 * transitions. Everything else in it is what the caller's role and the
 * tracker's workflow allow — offering any other status would only earn a 422.
 */
export function toIssueDetail(issue) {
  const base = toIssue(issue);
  const allowed = Array.isArray(issue.allowed_statuses)
    ? issue.allowed_statuses.map(toStatus).filter(Boolean)
    : [];
  const allowedStatuses = base.status
    ? [base.status, ...allowed.filter((status) => status.id !== base.status.id)]
    : allowed;

  return {
    ...base,
    description: normalizeText(issue.description),
    author: toNamed(issue.author),
    allowedStatuses,
  };
}

/**
 * Shape what the create/edit form offers for one project.
 *
 * Assignees are users only (see `toAssignableUsers`). Priorities keep
 * `isDefault` so a new issue starts on the instance's own default rather than
 * one we guess.
 */
export function toFormOptions({ trackers, memberships, priorities }) {
  const priorityList = Array.isArray(priorities)
    ? priorities
        .filter((p) => p && p.id != null)
        .map((p) => ({ id: p.id, name: p.name ?? '', isDefault: p.is_default === true }))
    : [];

  return {
    trackers: toNamedList(trackers),
    assignees: toAssignableUsers(memberships),
    priorities: priorityList,
    defaultPriorityId: priorityList.find((p) => p.isDefault)?.id ?? null,
  };
}

/**
 * The **users** in a memberships list, deduplicated and sorted by name.
 *
 * Group memberships are skipped: group assignment depends on an instance setting
 * and is out of scope. A user holding several roles appears once.
 *
 * Shared by the create/edit form and the `@name` search, which needs the same
 * answer across every project the caller belongs to.
 */
export function toAssignableUsers(memberships) {
  const byId = new Map();
  for (const membership of Array.isArray(memberships) ? memberships : []) {
    const user = toNamed(membership?.user);
    if (user && !byId.has(user.id)) byId.set(user.id, user);
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Journal attributes the issue page names, and the lookup that resolves each
 * one's id values. Redmine records these as raw ids (`status_id: "3"`), which
 * mean nothing to a reader until named.
 */
const JOURNAL_FIELDS = {
  status_id: { label: 'status', lookup: 'statuses' },
  priority_id: { label: 'priority', lookup: 'priorities' },
  assigned_to_id: { label: 'assignee', lookup: 'users' },
  tracker_id: { label: 'tracker', lookup: 'trackers' },
  subject: { label: 'subject' },
  description: { label: 'description', hideValues: true },
};

/** Name an id from a lookup map, falling back to `#id` for one we can't resolve. */
function nameFor(lookup, value) {
  if (value == null || value === '') return null;
  return lookup?.get(Number(value)) ?? `#${value}`;
}

/** One journal detail as `{ field, from, to }`; values are null when not shown. */
function toJournalChange(detail, lookups) {
  if (detail?.property !== 'attr') {
    // Custom fields, attachments and relations are out of scope: name the kind
    // of change without pretending to render its values.
    const kind = { cf: 'custom field', attachment: 'attachment', relation: 'relation' }[
      detail?.property
    ];
    return { field: kind ?? 'issue', from: null, to: null };
  }
  const known = JOURNAL_FIELDS[detail.name];
  if (!known) {
    return {
      field: String(detail.name ?? 'issue')
        .replace(/_id$/, '')
        .replace(/_/g, ' '),
      from: null,
      to: null,
    };
  }
  if (known.hideValues) return { field: known.label, from: null, to: null };
  const resolve = (value) =>
    known.lookup
      ? nameFor(lookups[known.lookup], value)
      : value == null || value === ''
        ? null
        : String(value);
  return { field: known.label, from: resolve(detail.old_value), to: resolve(detail.new_value) };
}

/**
 * Shape an issue's `journals` into its history, oldest first as Redmine sends
 * it. Each entry is `{ id, user, createdAt, notes, changes }`; an entry with
 * neither notes nor changes is dropped.
 *
 * @param {{statuses?: Map, priorities?: Map, users?: Map, trackers?: Map}} lookups
 *   id → name maps used to name `status_id`, `priority_id`, … values
 */
export function toJournals(raw, lookups = {}) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((journal) => journal && journal.id != null)
    .map((journal) => ({
      id: journal.id,
      user: toNamed(journal.user),
      createdAt: toIsoDate(journal.created_on),
      notes: normalizeText(journal.notes).trim(),
      changes: Array.isArray(journal.details)
        ? journal.details.map((detail) => toJournalChange(detail, lookups))
        : [],
    }))
    .filter((journal) => journal.notes || journal.changes.length > 0);
}

/**
 * An issue's Redmine time entries for its page's Activity: who logged how many
 * hours, under which activity, on which day, with their comment. Shown on the
 * issue's own page, like its journals' notes — not on any list or search.
 */
export function toTimeEntries(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((entry) => entry && entry.id != null)
    .map((entry) => ({
      id: entry.id,
      user: toNamed(entry.user),
      hours: Number(entry.hours) || 0,
      activity: toNamed(entry.activity),
      comments: normalizeText(entry.comments).trim(),
      spentOn: typeof entry.spent_on === 'string' ? entry.spent_on : null,
      createdAt: toIsoDate(entry.created_on),
    }));
}

/**
 * The issue's newest `limit` time entries TimeHuddle did not push for the caller,
 * shaped by `toTimeEntries`. Filtering after a single page could come up empty on
 * a busy issue whose newest entries are all TimeHuddle's, so pages are read until
 * `limit` are collected, Redmine runs out, or `maxPages` bounds the cost.
 * `fetchPage(offset, pageSize)` resolves to one page of raw entries, newest first.
 */
export async function collectUnpushedTimeEntries(
  fetchPage,
  { issueId, pushedIds, limit, pageSize = 50, maxPages = 4 },
) {
  const kept = [];
  for (let page = 0; page < maxPages && kept.length < limit; page += 1) {
    const raw = await fetchPage(page * pageSize, pageSize);
    const rows = Array.isArray(raw) ? raw : [];
    kept.push(
      ...rows.filter((entry) => Number(entry?.issue?.id) === issueId && !pushedIds.has(entry.id)),
    );
    if (rows.length < pageSize) break;
  }
  return toTimeEntries(kept).slice(0, limit);
}

/** An id → name map from `{ id, name }` items, for `toJournals` lookups. */
export function toNameMap(items) {
  return new Map(
    (Array.isArray(items) ? items : [])
      .filter((i) => i && i.id != null)
      .map((i) => [Number(i.id), i.name ?? '']),
  );
}
