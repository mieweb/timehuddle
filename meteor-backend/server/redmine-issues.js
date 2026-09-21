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
 * description, custom fields, …) is still intentionally dropped from the list.
 *
 * M6 adds the shapes its create/edit forms need, kept separate so the list DTO
 * stays lean: `toIssueDetail` (one issue, with `description`, `author` and the
 * status transitions the caller may make), `toNamedList` (projects, trackers)
 * and `toFormOptions` (a project's trackers, assignable members, priorities),
 * plus `toJournals` for the issue page's history.
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
 * Only **user** memberships become assignees: group assignment depends on an
 * instance setting and is out of scope for M6. A user holding several roles
 * appears once. Priorities keep `isDefault` so a new issue starts on the
 * instance's own default rather than one we guess.
 *
 * @param {{trackers: unknown, memberships: unknown, priorities: unknown}} raw
 */
export function toFormOptions({ trackers, memberships, priorities }) {
  const assigneesById = new Map();
  for (const membership of Array.isArray(memberships) ? memberships : []) {
    const user = toNamed(membership?.user);
    if (user && !assigneesById.has(user.id)) assigneesById.set(user.id, user);
  }

  const priorityList = Array.isArray(priorities)
    ? priorities
        .filter((p) => p && p.id != null)
        .map((p) => ({ id: p.id, name: p.name ?? '', isDefault: p.is_default === true }))
    : [];

  return {
    trackers: toNamedList(trackers),
    assignees: [...assigneesById.values()].sort((a, b) => a.name.localeCompare(b.name)),
    priorities: priorityList,
    defaultPriorityId: priorityList.find((p) => p.isDefault)?.id ?? null,
  };
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
    // Custom fields, attachments and relations are out of M6 scope: name the
    // kind of change without pretending to render its values.
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
 * @param {unknown} raw  the `journals` array from `include=journals`
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

/** An id → name map from `{ id, name }` items, for `toJournals` lookups. */
export function toNameMap(items) {
  return new Map(
    (Array.isArray(items) ? items : [])
      .filter((i) => i && i.id != null)
      .map((i) => [Number(i.id), i.name ?? '']),
  );
}
