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

/** The rows to list for `record`, leaving out every field it has no value for. */
export function outsideFieldRows(
  record: Pick<TicketRecord, 'type' | 'labels' | 'milestone' | 'extra'>,
): OutsideFieldRow[] {
  const type = record.type?.name || null;
  // Redmine's tracker is both its type and a label: show it once, as the type.
  const labels = record.labels
    .filter((label) => label.name && label.group !== 'tracker')
    .map((label) => label.name);
  const milestone = record.milestone?.name || null;
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
