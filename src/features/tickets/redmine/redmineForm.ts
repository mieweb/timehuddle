/**
 * Pure helpers shared by the Redmine create and edit modals: turning
 * Redmine's `{ id, name }` lists into `Select` options, and turning a failed
 * write into something the user can act on.
 */
import type { SelectOption } from '@mieweb/ui';

import { ApiError, type RedmineNamed } from '../../../lib/api';

/** `Select` values are strings; this stands for "nobody" in the assignee list. */
export const UNASSIGNED = 'none';

/**
 * `{ id, name }` items as `Select` options. `current`, when given and missing
 * from the list, is added so an existing value never renders blank — e.g. an
 * issue assigned to a group, or to someone who has since left the project.
 */
export function toOptions(items: RedmineNamed[], current?: RedmineNamed | null): SelectOption[] {
  const options = items.map((item) => ({ value: String(item.id), label: item.name }));
  if (current && !items.some((item) => item.id === current.id)) {
    options.unshift({ value: String(current.id), label: current.name });
  }
  return options;
}

/**
 * Assignee options: "Unassigned", then the caller as "Assign to me (name)",
 * then everyone else. Putting the caller second makes "for myself" one click.
 */
export function assigneeOptions(
  members: RedmineNamed[],
  me: number | null,
  current?: RedmineNamed | null,
): SelectOption[] {
  const self = me == null ? undefined : members.find((m) => m.id === me);
  const others = members.filter((m) => m.id !== me);
  return [
    { value: UNASSIGNED, label: 'Unassigned' },
    ...(self ? [{ value: String(self.id), label: `Me (${self.name})` }] : []),
    // `current` is skipped only when the "Me" option above already stands for it.
    ...toOptions(others, current && current.id !== self?.id ? current : null),
  ];
}

/** A `Select` value back to an id, with the unassigned sentinel mapping to null. */
export function toId(value: string): number | null {
  if (!value || value === UNASSIGNED) return null;
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Redmine's own limit for an issue `subject`. */
export const MAX_SUBJECT_LENGTH = 255;

/** What a TimeHuddle ticket carries over into a new Redmine issue. */
export interface RedmineIssuePrefill {
  subject: string;
  description: string;
  /** A TimeHuddle priority (`low`, `medium`, …), matched to a Redmine one by name. */
  priority: string | null;
}

/**
 * The create form's starting values for a ticket. A TimeHuddle title may be
 * longer than Redmine allows, so it is cut to fit rather than refused later.
 */
export function prefillFromTicket(ticket: {
  title: string;
  description: string | null;
  priority: string | null;
}): RedmineIssuePrefill {
  return {
    subject: ticket.title.trim().slice(0, MAX_SUBJECT_LENGTH),
    description: ticket.description ?? '',
    priority: ticket.priority,
  };
}

/** TimeHuddle's priorities under the names Redmine ships with. */
const REDMINE_PRIORITY_NAME: Record<string, string> = {
  low: 'low',
  medium: 'normal',
  high: 'high',
  critical: 'urgent',
};

/**
 * The Redmine priority matching a TimeHuddle one, or null when the instance
 * has renamed it — the form then keeps its own default.
 */
export function matchPriorityId(
  priorities: RedmineNamed[],
  priority: string | null,
): number | null {
  const name = priority ? REDMINE_PRIORITY_NAME[priority] : undefined;
  if (!name) return null;
  return priorities.find((p) => p.name.toLowerCase() === name)?.id ?? null;
}

/** The user-facing message for a failed Redmine call. */
export function redmineErrorMessage(err: unknown): string {
  if (err instanceof ApiError || err instanceof Error) return err.message;
  return 'Something went wrong talking to Redmine. Try again.';
}

/** Whether a failed update was refused because the issue changed in Redmine meanwhile. */
export function isStaleError(err: unknown): boolean {
  return err instanceof ApiError && err.code === 'stale';
}

/** Redmine's field names, as the user would call them, for read-back warnings. */
const FIELD_LABELS: Record<string, string> = {
  project_id: 'project',
  tracker_id: 'tracker',
  subject: 'subject',
  status_id: 'status',
  priority_id: 'priority',
  assigned_to_id: 'assignee',
  description: 'description',
};

/** A warning when Redmine stored some fields differently from what was sent, else null. */
export function mismatchWarning(mismatches: string[]): string | null {
  if (!mismatches.length) return null;
  const fields = mismatches.map((m) => FIELD_LABELS[m] ?? m).join(', ');
  return `Saved, but Redmine stored a different ${fields} than you chose — a workflow rule or plugin may have changed it. Check the issue in Redmine.`;
}
