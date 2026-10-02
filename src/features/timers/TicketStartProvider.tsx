/**
 * TicketStartProvider — one way to start a ticket timer, from anywhere (#586).
 *
 * Every ticket timer needs an open shift, for Huddle tickets and Redmine issues
 * alike (the server refuses with `no-active-shift`). Every start point — My
 * Board rows, the Redmine suggestions, Work page entries, the Redmine issue
 * page — goes through `useTicketStart().start`, so being clocked out is handled
 * the same way everywhere:
 *
 * - Clocked in: the timer starts, and a toast confirms it. When it stopped
 *   another ticket's timer, the toast names that one too.
 * - Clocked out: one "Clock In Required" prompt, owned here. **Clock In Now**
 *   clocks in, then starts the timer.
 * - Clocked out on a plan-required team: the prompt sends the user to the Clock
 *   page to write today's plan, and remembers the start. The moment they are
 *   clocked in, the timer starts and they are taken back where they were.
 *
 * A start is plain data (`TicketStartRequest`), not a callback, so it can wait
 * out that trip to the Clock page. It lives in memory only: a reload drops it.
 */
import {
  Button,
  ButtonGroup,
  Modal,
  ModalBody,
  ModalClose,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Text,
  useToast,
} from '@mieweb/ui';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

import { timerApi } from '../../lib/api';
import { useTeam } from '../../lib/TeamContext';
import { useClockToggle } from '../../lib/useClockToggle';
import { useRunningTicket, type RunningTicket } from '../../lib/useRunningTicket';
import { useRouter } from '../../ui/router';
import { invalidateRedmineCache } from '../tickets/sources';
import {
  startTicketTimer,
  timerErrorMessage,
  toastTimerOutcome,
  type TicketTimerOutcome,
  type TimerTicket,
} from '../tickets/startTicketTimer';

import { ticketTimerText as text, timerLabel } from './ticketTimerStrings';

/** What to start. `label` names the ticket in messages; see `timerLabel`. */
export type TicketStartRequest =
  /** A ticket: a new work entry is created and timed (`startTicketTimer`). */
  | {
      kind: 'ticket';
      ticket: TimerTicket;
      label: string;
      inTable: boolean;
      onBoard: boolean;
    }
  /** An existing work entry on the Work page (`timers.startSession`). */
  | { kind: 'entry'; entryId: string; ticketKey: string; label: string };

export interface TicketStopRequest {
  sessionId: string;
  ticketKey: string;
  label: string;
}

/** A start waiting for the user to write their plan and clock in. */
export interface PendingTicketStart {
  request: TicketStartRequest;
  /** Where the user asked for it, to go back to once it has started. */
  returnTo: string;
}

interface TicketStartContextValue {
  /** Start a timer, or open the clock-in prompt (`'clock-in'`) when clocked out. */
  start: (request: TicketStartRequest) => Promise<TicketTimerOutcome>;
  stop: (request: TicketStopRequest) => Promise<TicketTimerOutcome>;
  /** The ticket key being started or stopped right now, for a row's spinner. */
  busyKey: string | null;
  pending: PendingTicketStart | null;
  cancelPending: () => void;
}

const TicketStartContext = createContext<TicketStartContextValue | null>(null);

export function useTicketStart(): TicketStartContextValue {
  const ctx = useContext(TicketStartContext);
  if (!ctx) throw new Error('useTicketStart must be used inside TicketStartProvider');
  return ctx;
}

/** `${source}:${id}`, matching `UnifiedTicket.key` and `RunningTicket.key`. */
function requestKey(request: TicketStartRequest): string {
  return request.kind === 'ticket'
    ? `${request.ticket.sourceId}:${request.ticket.id}`
    : request.ticketKey;
}

function refreshTimerViews() {
  window.dispatchEvent(new CustomEvent('tickets:refetch'));
  window.dispatchEvent(new CustomEvent('work:refetch'));
}

export const TicketStartProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const toast = useToast();
  const { pathname, navigate } = useRouter();
  const { selectedTeamId } = useTeam();
  const { isClockedIn, clockIn, clockInLoading, planGate } = useClockToggle();
  const runningTicket = useRunningTicket(isClockedIn);

  const [busyKey, setBusyKey] = useState<string | null>(null);
  // One start or stop at a time, app-wide. The state above lands a render late,
  // so this ref is the guard: two overlapping starts could each find no open
  // session on the server and both insert one.
  const busyRef = useRef(false);

  /** Run `op` unless another start or stop is in flight; `'failed'` (silently) if one is. */
  const exclusive = useCallback(
    async (key: string, op: () => Promise<TicketTimerOutcome>): Promise<TicketTimerOutcome> => {
      if (busyRef.current) return 'failed';
      busyRef.current = true;
      setBusyKey(key);
      try {
        return await op();
      } finally {
        busyRef.current = false;
        setBusyKey(null);
      }
    },
    [],
  );
  const [prompt, setPrompt] = useState<TicketStartRequest | null>(null);
  const [promptError, setPromptError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingTicketStart | null>(null);

  // Read inside the callbacks below without re-creating them on every change.
  const runningRef = useRef<RunningTicket | null>(runningTicket);
  runningRef.current = runningTicket;
  const pendingRef = useRef<PendingTicketStart | null>(null);

  const setPendingStart = useCallback((next: PendingTicketStart | null) => {
    pendingRef.current = next;
    setPending(next);
  }, []);

  /** Start now: the user is (or has just been) clocked in. */
  const runStart = useCallback(
    async (request: TicketStartRequest): Promise<TicketTimerOutcome> => {
      const key = requestKey(request);
      // Starting one timer stops any other (`closeRunningSession`); the server
      // doesn't say which, so note it before the start.
      const running = runningRef.current;
      const stoppedLabel =
        running && running.key !== key
          ? timerLabel(running.source, running.id, running.title)
          : null;

      return exclusive(key, async () => {
        let outcome: TicketTimerOutcome;
        try {
          if (request.kind === 'ticket') {
            outcome = await startTicketTimer(request.ticket, request);
            // A pinned issue joins the Redmine rows, which are cached per session.
            if (request.ticket.sourceId === 'redmine' && !request.inTable) invalidateRedmineCache();
          } else {
            await timerApi.startSession(request.entryId, Date.now());
            outcome = 'started';
          }
        } catch (err) {
          toast.error(timerErrorMessage(err));
          return 'failed';
        }
        if (outcome === 'failed') {
          toast.error(timerErrorMessage(null));
          return outcome;
        }
        toastTimerOutcome(toast, outcome, request.label, stoppedLabel);
        refreshTimerViews();
        return outcome;
      });
    },
    [toast, exclusive],
  );

  const start = useCallback(
    async (request: TicketStartRequest): Promise<TicketTimerOutcome> => {
      // `isClockedIn` can be stale (another tab clocked out); the server's
      // `no-active-shift` is then shown as an error by `runStart`.
      if (isClockedIn) return runStart(request);
      setPromptError(null);
      setPrompt(request);
      return 'clock-in';
    },
    [isClockedIn, runStart],
  );

  const stop = useCallback(
    ({ sessionId, ticketKey, label }: TicketStopRequest): Promise<TicketTimerOutcome> =>
      exclusive(ticketKey, async () => {
        try {
          await timerApi.stopSession(sessionId, Date.now());
        } catch {
          toast.error(text.errorStop);
          return 'failed';
        }
        toastTimerOutcome(toast, 'stopped', label);
        refreshTimerViews();
        return 'stopped';
      }),
    [toast, exclusive],
  );

  const closePrompt = () => {
    setPrompt(null);
    setPromptError(null);
  };

  const clockInAndStart = async () => {
    if (!prompt) return;
    if (!selectedTeamId) {
      setPromptError(text.selectTeamFirst);
      return;
    }
    setPromptError(null);
    let clockedIn = false;
    try {
      clockedIn = await clockIn();
    } catch {
      clockedIn = false;
    }
    if (!clockedIn) {
      setPromptError(text.clockInFailed);
      return;
    }
    const request = prompt;
    closePrompt();
    await runStart(request);
  };

  /** Plan-required: remember the start and send the user to write the plan. */
  const goWritePlan = () => {
    if (!prompt) return;
    setPendingStart({ request: prompt, returnTo: pathname });
    closePrompt();
    navigate('/app/clock');
  };

  // The pending start runs the moment the user is clocked in, however they got
  // there (the Clock page's "Post plan and clock in", or any other clock-in).
  useEffect(() => {
    const waiting = pendingRef.current;
    if (!isClockedIn || !waiting) return;
    setPendingStart(null);
    void runStart(waiting.request).then(() => navigate(waiting.returnTo));
  }, [isClockedIn, runStart, navigate, setPendingStart]);

  const cancelPending = useCallback(() => setPendingStart(null), [setPendingStart]);

  const planFirst = planGate.planMissing;

  return (
    <TicketStartContext.Provider value={{ start, stop, busyKey, pending, cancelPending }}>
      {children}

      <Modal
        open={prompt !== null}
        onOpenChange={(open) => {
          if (!open) closePrompt();
        }}
        size="sm"
        aria-labelledby="clock-in-prompt-title"
      >
        <ModalHeader>
          <ModalTitle id="clock-in-prompt-title">{text.promptTitle}</ModalTitle>
          <ModalClose />
        </ModalHeader>
        <ModalBody>
          <div className="clock-in-prompt-body space-y-2">
            <Text size="sm">
              {planFirst && prompt ? text.promptPlanBody(prompt.label) : text.promptBody}
            </Text>
            {promptError && (
              <Text size="xs" className="text-danger" role="alert">
                {promptError}
              </Text>
            )}
          </div>
        </ModalBody>
        <ModalFooter>
          <ButtonGroup>
            <Button variant="outline" onClick={closePrompt}>
              {text.cancel}
            </Button>
            {planFirst ? (
              <Button variant="primary" onClick={goWritePlan}>
                {text.writePlan}
              </Button>
            ) : (
              <Button
                variant="primary"
                onClick={() => void clockInAndStart()}
                isLoading={clockInLoading}
              >
                {text.clockInNow}
              </Button>
            )}
          </ButtonGroup>
        </ModalFooter>
      </Modal>
    </TicketStartContext.Provider>
  );
};
