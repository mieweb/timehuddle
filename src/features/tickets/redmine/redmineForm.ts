/**
 * Pure helpers shared by the Redmine create and edit modals (M6): turning
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
    ...toOptions(others, current && current.id !== me ? current : null),
  ];
}

/** A `Select` value back to an id, with the unassigned sentinel mapping to null. */
export function toId(value: string): number | null {
  if (!value || value === UNASSIGNED) return null;
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
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
