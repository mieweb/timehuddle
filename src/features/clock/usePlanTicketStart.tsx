/**
 * Start or stop a ticket of today's plan, from the Clock page or the plan post
 * in Huddle (M4, #886): the posted plan is the launching point for the day. It
 * goes through `useTicketStart` like every other start, so clock-in prompts,
 * short-stint questions and toasts are the same everywhere; on the server,
 * touch and go then unchecks it and checks off the ticket switched from.
 *
 * A ticket taken out of today's plan still has a start button in the plan
 * post, which stays as posted. Starting it asks first whether to add it back,
 * so the Clock page and My Board show what's being worked on.
 */
import {
  Button,
  ButtonGroup,
  ModalBody,
  ModalClose,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Text,
} from '@mieweb/ui';
import { AppModal } from '@ui/AppModal';
import React, { useCallback, useState } from 'react';

import type { RunningTicket } from '../../lib/useRunningTicket';
import { useSession } from '../../lib/useSession';
import { ticketKey } from '../tickets/sources';
import { useMyBoardKeys } from '../tickets/useMyBoardKeys';
import { useTicketStart } from '../timers/TicketStartProvider';
import { timerLabel } from '../timers/ticketTimerStrings';
import { clockText } from './clockStrings';
import { planInputOf, type SessionPlanState } from './useSessionPlan';

interface RemovedTicket {
  ticketId: string;
  title: string;
}

export function usePlanTicketStart(
  running: RunningTicket | null,
  sessionPlan: Pick<SessionPlanState, 'plan' | 'setItems'>,
) {
  const { user } = useSession();
  const { start, stop, busyKey } = useTicketStart();
  const { boardKeys } = useMyBoardKeys(user?.id ?? null);
  const [removed, setRemoved] = useState<RemovedTicket | null>(null);
  const [addingBack, setAddingBack] = useState(false);
  const [addBackFailed, setAddBackFailed] = useState(false);
  const { plan, setItems } = sessionPlan;

  const startNow = useCallback(
    (ticketId: string, title: string) =>
      start({
        kind: 'ticket',
        ticket: { sourceId: 'huddle', id: ticketId },
        label: timerLabel('huddle', ticketId, title),
        onBoard: boardKeys.has(ticketKey('huddle', ticketId)),
      }),
    [start, boardKeys],
  );

  const isRunning = useCallback(
    (ticketId: string) => running?.source === 'huddle' && running.id === ticketId,
    [running],
  );

  /** Start the ticket, or stop it when it's the one running. */
  const togglePlanTicket = useCallback(
    (ticketId: string, title: string) => {
      if (running && isRunning(ticketId)) {
        void stop({
          sessionId: running.sessionId,
          ticketKey: running.key,
          label: timerLabel('huddle', ticketId, title),
        });
        return;
      }
      const inPlan = plan?.items.some((item) => 'ticketId' in item && item.ticketId === ticketId);
      if (plan?.initialized && !inPlan) {
        setAddBackFailed(false);
        setRemoved({ ticketId, title });
        return;
      }
      void startNow(ticketId, title);
    },
    [running, isRunning, stop, plan, startNow],
  );

  const answer = async (addBack: boolean) => {
    const ticket = removed;
    if (!ticket) return;
    if (addBack && plan) {
      setAddingBack(true);
      try {
        await setItems([...planInputOf(plan.items), { ticketId: ticket.ticketId }]);
      } catch {
        setAddBackFailed(true);
        return;
      } finally {
        setAddingBack(false);
      }
    }
    setRemoved(null);
    void startNow(ticket.ticketId, ticket.title);
  };

  /** Whether this ticket's start or stop is in flight. */
  const isBusy = useCallback(
    (ticketId: string) => busyKey === ticketKey('huddle', ticketId),
    [busyKey],
  );

  const addBackPrompt = (
    <AppModal
      open={removed !== null}
      onOpenChange={(open) => {
        if (!open && !addingBack) setRemoved(null);
      }}
      size="sm"
      aria-labelledby="add-back-to-plan-title"
    >
      <ModalHeader>
        <ModalTitle id="add-back-to-plan-title">{clockText.addBackTitle}</ModalTitle>
        <ModalClose />
      </ModalHeader>
      <ModalBody>
        <div className="add-back-to-plan-body space-y-2">
          <Text size="sm">{removed && clockText.addBackBody(removed.title)}</Text>
          {addBackFailed && (
            <Text size="xs" className="text-danger" role="alert">
              {clockText.planSaveFailed}
            </Text>
          )}
        </div>
      </ModalBody>
      <ModalFooter>
        <ButtonGroup>
          <Button variant="outline" onClick={() => void answer(false)} disabled={addingBack}>
            {clockText.justStart}
          </Button>
          <Button variant="primary" onClick={() => void answer(true)} isLoading={addingBack}>
            {clockText.addBackAndStart}
          </Button>
        </ButtonGroup>
      </ModalFooter>
    </AppModal>
  );

  return {
    togglePlanTicket,
    isRunning,
    isBusy,
    busy: busyKey !== null,
    /** Render once: asks whether to add a ticket back to the plan before starting it. */
    addBackPrompt,
  };
}
