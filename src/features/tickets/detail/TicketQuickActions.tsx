/**
 * TicketQuickActions — the My Board toggle and the timer button in a ticket
 * page's header, the same pair a table row carries.
 *
 * One component for both pages (a TimeHuddle ticket, a Redmine issue), so the
 * two behave alike: off the board the timer reads "Add & Start", because
 * starting one puts the ticket there.
 */
import { ButtonGroup } from '@mieweb/ui';
import React, { useState } from 'react';

import type { TicketSourceId } from '../../../lib/api';
import { useRunningTicket } from '../../../lib/useRunningTicket';
import { useSession } from '../../../lib/useSession';
import { TimerToggleButton } from '../../../ui/TimerToggleButton';
import { useTicketStart } from '../../timers/TicketStartProvider';
import { ticketTimerText, timerLabel } from '../../timers/ticketTimerStrings';
import { BoardToggleButton } from '../BoardToggleButton';
import { boardText } from '../boardStrings';
import { ticketKey } from '../sources';
import { useBoardActions } from '../useBoardActions';
import { useMyBoardKeys } from '../useMyBoardKeys';

export interface TicketQuickActionsProps {
  sourceId: TicketSourceId;
  id: string;
  /** A Huddle ticket's title, which is how its timer messages name it. */
  title?: string | null;
  /**
   * The Tickets table already shows this ticket, so starting a timer has
   * nothing to pin. Only a Redmine issue can be outside the table.
   */
  inTable: boolean;
  /** `${sourceId}:${id}` of the issue this ticket is linked to, which also puts it on the board. */
  linkedKey?: string | null;
}

export const TicketQuickActions: React.FC<TicketQuickActionsProps> = ({
  sourceId,
  id,
  title,
  inTable,
  linkedKey = null,
}) => {
  const { user } = useSession();
  const runningTicket = useRunningTicket(true);
  const { start, stop, busyKey } = useTicketStart();
  const { boardKeys, boardLoaded } = useMyBoardKeys(user?.id ?? null);
  const boardActions = useBoardActions();
  const [boardBusy, setBoardBusy] = useState(false);

  const key = ticketKey(sourceId, id);
  const label = timerLabel(sourceId, id, title);
  const entryKeys = [key, linkedKey].filter((k): k is string => !!k && boardKeys.has(k));
  const onBoard = entryKeys.length > 0;
  const isTiming = runningTicket?.key === key;
  // Until the board has answered, "not on it" is not known: say nothing about adding.
  const addsToBoard = boardLoaded && !onBoard && !isTiming;

  const toggleBoard = () => {
    setBoardBusy(true);
    void (onBoard ? boardActions.remove(entryKeys, label) : boardActions.add([key])).finally(() =>
      setBoardBusy(false),
    );
  };

  const toggleTimer = () => {
    if (isTiming && runningTicket) {
      void stop({ sessionId: runningTicket.sessionId, ticketKey: key, label });
      return;
    }
    void start({ kind: 'ticket', ticket: { sourceId, id }, label, inTable, onBoard });
  };

  return (
    <ButtonGroup className="ticket-quick-actions shrink-0 gap-2">
      <BoardToggleButton
        onBoard={onBoard}
        isLoading={boardBusy}
        // Not while the timer is starting: the start decides whether to add the
        // ticket from where the board stood when it was pressed.
        disabled={!boardLoaded || busyKey === key}
        onClick={toggleBoard}
        showLabel
        ariaLabel={onBoard ? boardText.removeLabel(label) : boardText.addLabel(label)}
      />
      <TimerToggleButton
        isRunning={isTiming}
        isLoading={busyKey === key}
        disabled={boardBusy}
        onClick={toggleTimer}
        label={
          isTiming
            ? ticketTimerText.stop
            : addsToBoard
              ? ticketTimerText.addAndStart
              : ticketTimerText.start
        }
        ariaLabel={
          isTiming
            ? ticketTimerText.stopLabel(label)
            : addsToBoard
              ? ticketTimerText.addAndStartLabel(label)
              : ticketTimerText.startLabel(label)
        }
        className="ticket-quick-timer shrink-0"
      />
    </ButtonGroup>
  );
};
