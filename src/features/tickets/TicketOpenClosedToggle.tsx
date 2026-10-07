/**
 * TicketOpenClosedToggle — the choice between a view's open and closed tickets,
 * as a switcher that also says how many there are of each.
 *
 * The same control in the list header at every width. The counts are the
 * showing view's, after its search and filters, so they change with the view
 * and with what is typed.
 */
import React from 'react';

import { SegmentedSwitcher, type SegmentedOption } from '../../ui/SegmentedSwitcher';

export interface TicketOpenClosedToggleProps {
  /** Unique on the page: one of these is mounted per place it shows. */
  name: string;
  showClosed: boolean;
  onShowClosedChange: (showClosed: boolean) => void;
  openCount: number;
  closedCount: number;
  /** The counts are not known yet. */
  loading?: boolean;
}

/** Past this a count is only "a lot", and the control must not grow with it. */
const COUNT_CAP = 50;

const text = {
  group: 'Tickets shown',
  open: 'Open',
  closed: 'Closed',
  openName: (count: string) => `Open tickets, ${count}`,
  closedName: (count: string) => `Closed tickets, ${count}`,
  loadingName: 'loading',
};

export const formatTicketCount = (count: number) =>
  count > COUNT_CAP ? `${COUNT_CAP}+` : String(count);

type Shown = 'open' | 'closed';

export const TicketOpenClosedToggle: React.FC<TicketOpenClosedToggleProps> = ({
  name,
  showClosed,
  onShowClosedChange,
  openCount,
  closedCount,
  loading = false,
}) => {
  const open = loading ? null : formatTicketCount(openCount);
  const closed = loading ? null : formatTicketCount(closedCount);
  // The same green and purple as a row's status dot: a status, not the brand.
  const options: SegmentedOption<Shown>[] = [
    {
      value: 'open',
      label: text.open,
      detail: open,
      accessibleName: text.openName(open ?? text.loadingName),
      toneClassName: 'text-green-600 dark:text-green-400',
    },
    {
      value: 'closed',
      label: text.closed,
      detail: closed,
      accessibleName: text.closedName(closed ?? text.loadingName),
      toneClassName: 'text-purple-600 dark:text-purple-400',
    },
  ];

  return (
    <SegmentedSwitcher
      name={name}
      label={text.group}
      hideLabel
      compact
      options={options}
      value={showClosed ? 'closed' : 'open'}
      onValueChange={(value) => onShowClosedChange(value === 'closed')}
    />
  );
};
