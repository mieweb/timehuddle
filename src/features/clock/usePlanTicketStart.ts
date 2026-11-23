/**
 * Start a ticket of today's plan, from the Clock page or the plan post in
 * Huddle (M4, #886): the posted plan is the launching point for the day. It
 * goes through `useTicketStart` like every other start, so clock-in prompts,
 * short-stint questions and toasts are the same everywhere; on the server,
 * touch and go then unchecks it and checks off the ticket switched from.
 */
import { useCallback } from 'react';

import { useSession } from '../../lib/useSession';
import { ticketKey } from '../tickets/sources';
import { useMyBoardKeys } from '../tickets/useMyBoardKeys';
import { useTicketStart } from '../timers/TicketStartProvider';
import { timerLabel } from '../timers/ticketTimerStrings';

export function usePlanTicketStart() {
  const { user } = useSession();
  const { start, busyKey } = useTicketStart();
  const { boardKeys } = useMyBoardKeys(user?.id ?? null);

  const startPlanTicket = useCallback(
    (ticketId: string, title: string) =>
      start({
        kind: 'ticket',
        ticket: { sourceId: 'huddle', id: ticketId },
        label: timerLabel('huddle', ticketId, title),
        onBoard: boardKeys.has(ticketKey('huddle', ticketId)),
      }),
    [start, boardKeys],
  );

  /** Whether this ticket's start (or any start, `busyKey` set) is in flight. */
  const isStarting = useCallback(
    (ticketId: string) => busyKey === ticketKey('huddle', ticketId),
    [busyKey],
  );

  return { startPlanTicket, isStarting, busy: busyKey !== null };
}
