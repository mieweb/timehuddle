/**
 * SessionListCard — The "Sessions" card both timesheets show: Me → Timesheet
 * (PersonalTimesheetPanel) and Team → Timesheet (AdminTimesheetPanel).
 *
 * A list, not a table: each child is a <TimesheetRow>, which has one layout at
 * every width. A card on a wide screen; edge to edge on a phone, like Tickets.
 */
import { Badge, Card, CardHeader, CardTitle, cn } from '@mieweb/ui';
import { EDGE_TO_EDGE_BELOW_MD } from '@ui/AppPage';
import React from 'react';

interface SessionListCardProps {
  /** How many sessions the list holds. */
  count: number;
  /**
   * The card owns the remaining page height and scrolls the list itself.
   * Off, the list is capped so a long range can't push the rest of the page
   * off the bottom.
   */
  fill?: boolean;
  /** The sessions: one <TimesheetRow> each. */
  children: React.ReactNode;
}

export const SessionListCard: React.FC<SessionListCardProps> = ({ count, fill, children }) => (
  <Card
    padding="none"
    className={cn('flex flex-col overflow-hidden', EDGE_TO_EDGE_BELOW_MD, fill && 'min-h-0 flex-1')}
  >
    <CardHeader className="flex flex-row shrink-0 items-center gap-2 px-5 py-3">
      <CardTitle className="text-sm">Sessions</CardTitle>
      <Badge variant="secondary" size="sm">
        {count}
      </Badge>
    </CardHeader>
    <div
      className={cn(
        'scrollbar-mieweb scrollbar-mieweb-visible border-t border-border',
        fill ? 'min-h-0 flex-1 overflow-y-scroll' : 'max-h-[32rem] overflow-y-auto',
      )}
    >
      <ul aria-label="Sessions" className="session-list divide-y divide-border">
        {children}
      </ul>
    </div>
  </Card>
);
