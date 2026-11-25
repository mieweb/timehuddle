/**
 * Clocking out while a ticket of today's plan is still running (M5, #887):
 * ask whether it's done. Checked off, it leaves My Board's Pinned at clock-out
 * like every checked item; kept unchecked, it stays pinned for the next
 * session. The answer is saved to the session plan before clock-out goes on,
 * since clock-out's carry-over reads it there.
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
import React, { useCallback, useEffect, useRef, useState } from 'react';

import type { SessionPlanItem } from '../../lib/api';
import type { RunningTicket } from '../../lib/useRunningTicket';
import { clockText } from './clockStrings';
import type { SessionPlanState } from './useSessionPlan';

type TicketItem = Extract<SessionPlanItem, { ticketId: string }>;

/** Go on with clock-out, and the running ticket's check if one was asked about. */
export type RunningTicketAnswer =
  { proceed: false } | { proceed: true; ticket?: { ticketId: string; checked: boolean } };

/** The plan's ticket item that is running now, if any. */
function runningItemOf(
  items: readonly SessionPlanItem[],
  running: RunningTicket | null,
): TicketItem | null {
  const tickets = items.filter((item): item is TicketItem => 'ticketId' in item);
  if (running) {
    return running.source === 'huddle'
      ? (tickets.find((item) => item.ticketId === running.id) ?? null)
      : null;
  }
  return tickets.find((item) => item.runningSince !== null) ?? null;
}

export function useRunningPlanTicketCheck(
  sessionPlan: Pick<SessionPlanState, 'plan' | 'setChecked'>,
  runningTicket: RunningTicket | null,
) {
  const { plan, setChecked } = sessionPlan;
  const [asking, setAsking] = useState<TicketItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const resolveRef = useRef<((answer: RunningTicketAnswer) => void) | null>(null);

  const finish = useCallback((answer: RunningTicketAnswer) => {
    const resolve = resolveRef.current;
    resolveRef.current = null;
    setAsking(null);
    resolve?.(answer);
  }, []);

  // A page left mid-question doesn't clock out.
  useEffect(() => () => resolveRef.current?.({ proceed: false }), []);

  /** Ask about the running plan ticket, if there is one; resolves once answered and saved. */
  const confirmClockOut = useCallback((): Promise<RunningTicketAnswer> => {
    const item = runningItemOf(plan?.items ?? [], runningTicket);
    if (!item) return Promise.resolve({ proceed: true });
    resolveRef.current?.({ proceed: false });
    setFailed(false);
    setAsking(item);
    return new Promise((resolve) => {
      resolveRef.current = resolve;
    });
  }, [plan, runningTicket]);

  const answer = async (checked: boolean) => {
    const item = asking;
    if (!item) return;
    if (item.checked !== checked) {
      setSaving(true);
      setFailed(false);
      try {
        await setChecked(item.id, checked);
      } catch {
        setFailed(true);
        return;
      } finally {
        setSaving(false);
      }
    }
    finish({ proceed: true, ticket: { ticketId: item.ticketId, checked } });
  };

  const prompt = (
    <AppModal
      open={asking !== null}
      onOpenChange={(open) => {
        if (!open && !saving) finish({ proceed: false });
      }}
      size="sm"
      aria-labelledby="running-at-clock-out-title"
    >
      <ModalHeader>
        <ModalTitle id="running-at-clock-out-title">{clockText.runningAtClockOutTitle}</ModalTitle>
        <ModalClose />
      </ModalHeader>
      <ModalBody>
        <div className="running-at-clock-out-body space-y-2">
          <Text size="sm">{asking && clockText.runningAtClockOutBody(asking.title)}</Text>
          {failed && (
            <Text size="xs" className="text-danger" role="alert">
              {clockText.planCheckFailed}
            </Text>
          )}
        </div>
      </ModalBody>
      <ModalFooter>
        <ButtonGroup>
          <Button variant="outline" onClick={() => void answer(false)} disabled={saving}>
            {clockText.keepRunningPinned}
          </Button>
          <Button variant="primary" onClick={() => void answer(true)} isLoading={saving}>
            {clockText.checkOffRunning}
          </Button>
        </ButtonGroup>
      </ModalFooter>
    </AppModal>
  );

  return {
    confirmClockOut,
    /** Render once: the question asked by `confirmClockOut`. */
    prompt,
  };
}
