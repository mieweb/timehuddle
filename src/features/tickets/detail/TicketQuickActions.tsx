/**
 * TicketQuickActions — the My Board toggle and the timer button in a ticket
 * page's header, the same pair a table row carries.
 *
 * One component for both pages (a TimeHuddle ticket, a Redmine issue), so the
 * two behave alike: off the board the timer reads "Add & Start", because
 * starting one puts the ticket there. On a Redmine issue's page, either button
 * acts on the ticket carrying the issue in the selected team, then opens that
 * ticket's page (#736).
 */
import { ButtonGroup, useToast } from '@mieweb/ui';
import React, { useState } from 'react';

import type { TicketSourceId } from '../../../lib/api';
import { useTeam } from '../../../lib/TeamContext';
import { useRunningTicket } from '../../../lib/useRunningTicket';
import { useSession } from '../../../lib/useSession';
import { useRouter } from '../../../ui/router';
import { TimerToggleButton } from '../../../ui/TimerToggleButton';
import { useTicketStart } from '../../timers/TicketStartProvider';
import { ticketTimerText, timerLabel } from '../../timers/ticketTimerStrings';
import { BoardToggleButton } from '../BoardToggleButton';
import { boardText } from '../boardStrings';
import { carriedKey } from '../carryIssue';
import { ticketKey, ticketRefOf } from '../sources';
import { timerErrorMessage } from '../startTicketTimer';
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
  const { selectedTeamId } = useTeam();
  const { navigate } = useRouter();
  const toast = useToast();
  const runningTicket = useRunningTicket(true);
  const { start, stop, busyKey } = useTicketStart();
  const { boardKeys, boardKnown } = useMyBoardKeys(user?.id ?? null);
  const boardActions = useBoardActions();
  const [boardBusy, setBoardBusy] = useState(false);

  const key = ticketKey(sourceId, id);
  const label = timerLabel(sourceId, id, title);
  const entryKeys = [key, linkedKey].filter((k): k is string => !!k && boardKeys.has(k));
  const onBoard = entryKeys.length > 0;
  const isTiming = runningTicket?.key === key;
  // Until a read of the board has succeeded, "not on it" is not known: say
  // nothing about adding, and offer no toggle.
  const addsToBoard = boardKnown && !onBoard && !isTiming;

  /**
   * The key the buttons act on: this ticket's own, or for a Redmine issue the
   * ticket carrying it, found or created now. Null when that failed (toasted).
   */
  const carry = async (): Promise<string | null> => {
    if (sourceId !== 'redmine') return key;
    try {
      return await carriedKey(key, selectedTeamId);
    } catch (err) {
      toast.error(timerErrorMessage(err));
      return null;
    }
  };

  /** After acting on an issue's carrier, open the carrier's page. */
  const openCarrier = (actedKey: string) => {
    const { sourceId: actedSource, ticketId } = ticketRefOf(actedKey);
    if (actedKey !== key && actedSource === 'huddle') navigate(`/app/tickets/${ticketId}`);
  };

  const toggleBoard = async () => {
    setBoardBusy(true);
    try {
      if (onBoard) {
        await boardActions.remove(entryKeys, label);
        return;
      }
      const target = await carry();
      if (target && (await boardActions.add([target]))) openCarrier(target);
    } finally {
      setBoardBusy(false);
    }
  };

  const toggleTimer = async () => {
    if (isTiming && runningTicket) {
      void stop({ sessionId: runningTicket.sessionId, ticketKey: key, label });
      return;
    }
    const target = await carry();
    if (!target) return;
    // The carrier may already be the one running: just go to it.
    if (runningTicket?.key !== target) {
      const timed = ticketRefOf(target);
      await start({
        kind: 'ticket',
        ticket: { sourceId: timed.sourceId as TicketSourceId, id: timed.ticketId },
        label,
        inTable: inTable || target !== key,
        onBoard: onBoard && target === key,
      });
    }
    openCarrier(target);
  };

  return (
    <ButtonGroup className="ticket-quick-actions shrink-0 gap-2">
      <BoardToggleButton
        onBoard={onBoard}
        isLoading={boardBusy}
        // Not while the timer is starting: the start decides whether to add the
        // ticket from where the board stood when it was pressed.
        disabled={!boardKnown || busyKey === key}
        onClick={() => void toggleBoard()}
        showLabel
        ariaLabel={onBoard ? boardText.removeLabel(label) : boardText.addLabel(label)}
      />
      <TimerToggleButton
        isRunning={isTiming}
        isLoading={busyKey === key}
        disabled={boardBusy}
        onClick={() => void toggleTimer()}
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
