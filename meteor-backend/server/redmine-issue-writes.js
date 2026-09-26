/**
 * Pure rules for creating and editing Redmine issues from TimeHuddle (M6).
 *
 * Every write goes out under the acting user's personal API key, so Redmine
 * itself enforces their role, the tracker's workflow and required fields. What
 * this module adds is the part Redmine cannot do for us:
 *
 *   - **input validation** before any request, so a malformed form never costs
 *     a round trip or earns an opaque 422;
 *   - **changed-fields-only updates.** Redmine's REST API has no optimistic
 *     locking, so sending an untouched field would silently overwrite a
 *     concurrent edit made in Redmine. Only what the user changed is sent;
 *   - **read-back comparison**, because Redmine can answer 2xx while storing
 *     something else (a workflow or plugin rewriting a field);
 *   - **named failure reasons**, so the UI can say *why* a write was refused.
 *
 * Kept free of Meteor imports so it can be unit-tested directly
 * (tests/redmine-issue-writes.test.ts), like redmine-issues.js.
 */
import { normalizeText } from './redmine-issues';

/** Redmine's own column limit for `subject`. */
export const MAX_SUBJECT_LENGTH = 255;

/** A positive integer id, `null` for an explicit "none", or `undefined` when invalid. */
function toOptionalId(value) {
  if (value === null || value === undefined || value === '') return null;
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

/**
 * Validate the create form and map it onto Redmine's field names.
 * @returns {{fields?: Record<string, unknown>, error?: string}} exactly one is set
 */
export function validateCreateInput(input = {}) {
  const projectId = toOptionalId(input.projectId);
  if (!projectId) return { error: 'Choose a project.' };

  const subject = typeof input.subject === 'string' ? input.subject.trim() : '';
  if (!subject) return { error: 'A subject is required.' };
  if (subject.length > MAX_SUBJECT_LENGTH) {
    return { error: `The subject must be ${MAX_SUBJECT_LENGTH} characters or fewer.` };
  }

  const trackerId = toOptionalId(input.trackerId);
  const assigneeId = toOptionalId(input.assigneeId);
  const priorityId = toOptionalId(input.priorityId);
  if (trackerId === undefined || assigneeId === undefined || priorityId === undefined) {
    return { error: 'One of the selected options is not valid.' };
  }
  if (input.description != null && typeof input.description !== 'string') {
    return { error: 'The description must be text.' };
  }

  const description = normalizeText(input.description).trim();
  return {
    fields: {
      project_id: projectId,
      subject,
      ...(trackerId ? { tracker_id: trackerId } : {}),
      ...(description ? { description } : {}),
      ...(assigneeId ? { assigned_to_id: assigneeId } : {}),
      ...(priorityId ? { priority_id: priorityId } : {}),
    },
  };
}

/**
 * The Redmine payload for an edit, containing **only** the fields that differ
 * from `original` (the issue detail DTO the form was opened with).
 *
 * `edits` may carry `statusId`, `priorityId`, `assigneeId` (`null` unassigns)
 * and `description`; absent keys are left alone. A status the caller may not
 * move to is refused here rather than sent — `allowedStatuses` is what Redmine
 * reported for this user and this issue.
 *
 * @returns {{fields?: Record<string, unknown>, error?: string}} exactly one is set;
 *   `fields` may be empty (a no-op)
 */
export function buildUpdatePayload(original, edits = {}) {
  const fields = {};

  if ('statusId' in edits) {
    const statusId = toOptionalId(edits.statusId);
    if (!statusId) return { error: 'Choose a status.' };
    if (statusId !== original.status?.id) {
      const allowed = (original.allowedStatuses ?? []).some((s) => s.id === statusId);
      if (!allowed) return { error: "That status change isn't allowed for this issue." };
      fields.status_id = statusId;
    }
  }

  if ('priorityId' in edits) {
    const priorityId = toOptionalId(edits.priorityId);
    if (!priorityId) return { error: 'Choose a priority.' };
    if (priorityId !== original.priority?.id) fields.priority_id = priorityId;
  }

  if ('assigneeId' in edits) {
    const assigneeId = toOptionalId(edits.assigneeId);
    if (assigneeId === undefined) return { error: 'That assignee is not valid.' };
    if (assigneeId !== (original.assignedTo?.id ?? null)) {
      // Redmine clears an assignee on an empty string; `null` is ignored.
      fields.assigned_to_id = assigneeId ?? '';
    }
  }

  if ('description' in edits) {
    if (typeof edits.description !== 'string') return { error: 'The description must be text.' };
    const description = normalizeText(edits.description);
    if (description !== (original.description ?? '')) fields.description = description;
  }

  return { fields };
}

/**
 * The fields where the issue Redmine now reports disagrees with what was sent.
 * An empty list means the write landed as intended.
 *
 * @param {object} fields  the Redmine payload that was sent
 * @param {object} fresh   the issue detail DTO read back afterwards
 * @returns {string[]}     Redmine field names, e.g. `['status_id']`
 */
export function readBackMismatches(fields, fresh) {
  const actual = {
    project_id: fresh.project?.id ?? null,
    tracker_id: fresh.tracker?.id ?? null,
    subject: fresh.subject,
    status_id: fresh.status?.id ?? null,
    priority_id: fresh.priority?.id ?? null,
    assigned_to_id: fresh.assignedTo?.id ?? null,
    description: (fresh.description ?? '').trim(),
  };
  const expected = (key, value) => {
    if (key === 'assigned_to_id' && value === '') return null;
    if (key === 'description') return normalizeText(value).trim();
    return value;
  };

  return Object.entries(fields)
    .filter(([key]) => key in actual)
    .filter(([key, value]) => expected(key, value) !== actual[key])
    .map(([key]) => key);
}

/**
 * Name why Redmine refused a write, from the error `redmine-client` threw.
 * 403 is the caller's role; 422 is Redmine's validation (its messages ride on
 * `err.errors`); 404 means the issue is gone or no longer visible to them.
 *
 * @returns {'no-permission'|'rejected'|'gone'|'invalid-key'|'unreachable'}
 */
export function writeFailureReason(err) {
  switch (err?.status) {
    case 401:
      return 'invalid-key';
    case 403:
      return 'no-permission';
    case 404:
      return 'gone';
    case 422:
      return 'rejected';
    default:
      return 'unreachable';
  }
}
