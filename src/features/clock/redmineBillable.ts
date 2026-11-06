/**
 * Whether an entry still needs a Billable status before it can go (#786), for
 * both dialogs that send time: Redmine requires one, and none is picked or
 * copied from recent entries.
 */
import type { RedmineBillable, RedmineTimeEntryRow } from '../../lib/api';

export function billableMissing(
  row: Pick<RedmineTimeEntryRow, 'billable' | 'billableField'> | null | undefined,
  picked: RedmineBillable['value'] | undefined,
): boolean {
  if (!row?.billableField?.required) return false;
  return [picked ?? row.billable?.value ?? []].flat().length === 0;
}
