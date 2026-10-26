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
  const options: SegmentedOption<Shown>[] = [
    {
      value: 'open',
      label: text.open,
      detail: open,
      accessibleName: text.openName(open ?? text.loadingName),
    },
    {
      value: 'closed',
      label: text.closed,
      detail: closed,
      accessibleName: text.closedName(closed ?? text.loadingName),
    },
  ];

  return (
    <SegmentedSwitcher
      name={name}
      label={text.group}
      hideLabel
      compact
      // Pill-shaped like the header's other controls, and only the one showing
      // is coloured.
      accent
      options={options}
      value={showClosed ? 'closed' : 'open'}
      onValueChange={(value) => onShowClosedChange(value === 'closed')}
    />
  );
};
