/**
 * The facts a linked issue carries beyond its status and assignee (#759): its
 * type, labels, milestone and the source's custom fields, as the ticket page
 * lists them. Read straight from the record, with no owner setup: a custom
 * field shows under the name its server gives it.
 */
import type { TicketRecord } from '@timehuddle/ticket-sources';

import { ticketLinkText } from './ticketLinkStrings';

export interface OutsideFieldRow {
  label: string;
  values: string[];
  /** Each value is its own badge (labels), not plain text. */
  badges?: boolean;
}

/** A due day, `2026-11-03`, read as that local day (not UTC midnight, a day early in the US). */
function formatDay(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** The rows to list for `record`, leaving out every field it has no value for. */
export function outsideFieldRows(
  record: Pick<TicketRecord, 'type' | 'labels' | 'milestone' | 'extra'>,
): OutsideFieldRow[] {
  const type = record.type?.name || null;
  // Redmine's tracker is both its type and a label: show it once, as the type.
  const labels = record.labels.map((label) => label.name).filter((name) => name && name !== type);
  const milestone = record.milestone?.name
    ? ticketLinkText.milestoneValue(
        record.milestone.name,
        record.milestone.due ? formatDay(record.milestone.due) : null,
      )
    : null;
  const rows: OutsideFieldRow[] = [
    { label: ticketLinkText.typeField, values: type ? [type] : [] },
    { label: ticketLinkText.labelsField, values: labels, badges: true },
    { label: ticketLinkText.milestoneField, values: milestone ? [milestone] : [] },
    ...record.extra.map((field) => ({
      label: field.label,
      values: field.value?.trim() ? [field.value.trim()] : [],
    })),
  ];
  return rows.filter((row) => row.label && row.values.length);
}
