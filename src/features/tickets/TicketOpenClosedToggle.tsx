/**
 * TicketOpenClosedToggle — the compact (phone) table's choice between open and
 * closed tickets, shown in the table header beside the list it changes.
 *
 * On a wide screen the same choice is the "Closed" switch in the toolbar
 * (`TicketViewControls`); a phone toolbar has no room for it.
 */
import { Button } from '@mieweb/ui';
import React from 'react';

export interface TicketOpenClosedToggleProps {
  showClosed: boolean;
  onShowClosedChange: (showClosed: boolean) => void;
}

const text = {
  group: 'Tickets shown',
  open: 'Open',
  closed: 'Close',
  showOpen: 'Show open tickets',
  showClosed: 'Show closed tickets',
};

/** The same greens and purples as a row's status dot; the one not chosen is dimmed. */
const OPTION_CLASS =
  'ticket-open-closed-option h-auto rounded px-1 py-0.5 text-xs font-semibold tracking-wide uppercase hover:bg-transparent dark:hover:bg-transparent';
const OPEN_CLASS = 'text-green-600 dark:text-green-400';
const CLOSED_CLASS = 'text-purple-600 dark:text-purple-400';
const DIMMED_CLASS = 'opacity-60 hover:opacity-100';

export const TicketOpenClosedToggle: React.FC<TicketOpenClosedToggleProps> = ({
  showClosed,
  onShowClosedChange,
}) => (
  <div
    role="group"
    aria-label={text.group}
    className="ticket-open-closed flex shrink-0 items-center gap-2"
  >
    <Button
      variant="ghost"
      type="button"
      aria-pressed={!showClosed}
      aria-label={text.showOpen}
      onClick={() => onShowClosedChange(false)}
      className={`${OPTION_CLASS} ${OPEN_CLASS} ${showClosed ? DIMMED_CLASS : ''}`}
    >
      {text.open}
    </Button>
    <Button
      variant="ghost"
      type="button"
      aria-pressed={showClosed}
      aria-label={text.showClosed}
      onClick={() => onShowClosedChange(true)}
      className={`${OPTION_CLASS} ${CLOSED_CLASS} ${showClosed ? '' : DIMMED_CLASS}`}
    >
      {text.closed}
    </Button>
  </div>
);
