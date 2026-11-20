/**
 * Clock out / Clock in with a Pulse video (PLAN §5.1 B2 and B3; TH-11), for
 * the Clock page. Where Pulse runs in the app and the team has "Clock in and
 * out with a Pulse video" on (`pulseClockInOut`, read by startPulse), the
 * page shows a button that records for:
 *
 *  - the open session's wrap-up: context `clock:<clockEventId>`, type
 *    `clock.wrapup` (the key the session's own videos share, so they group);
 *  - today's plan: context `clock-plan:<teamId>:<postDate>`, type `clock.plan`.
 *
 * The clock action itself runs at Send, inside Pulse, through grants.ts's
 * `confirmSend` (`clock.stopWithVideo` / `clock.startWithPlan`, AD23): Pulse
 * closes only once the server has clocked. This module never calls a clock
 * method. After the flow it only says what happened:
 *
 *  - completed: "Clocked out at 5:02 PM · video sending", with the time the
 *    server recorded (the clockEvent `confirmSend` returned, noted here by
 *    noteClockSend), never Pulse's `sentAt`: the server replaces an `at`
 *    more than 30 minutes old with its own now;
 *  - closed (X → Keep draft): "Still clocked in", with "Clock out now", a
 *    plain clock-out the person asks for. Nothing is retried after Pulse
 *    closes: a Send whose clock call failed kept Pulse open on Export, where
 *    the person tries again or keeps the draft.
 *
 * TODO(PR2-I): Pulse's ConfirmSendRequest gains the draft's `name`; grants.ts
 * then passes `name: r.name || null` to stopWithVideo / startWithPlan, so the
 * wrap-up line and the plan post carry it.
 */
import type { DraftFilter, DraftState, DraftSummary, FlowResult } from '@mieweb/pulse-embed';
import { useOptionalToast } from '@mieweb/ui';
import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { ClockEvent } from '../../lib/api';
import { formatTime } from '../../lib/timeUtils';
import { CLOCK_LOCALE } from '../clock/clockStrings';
import { CLOCK_PULSE_TEXT } from './clockPulseStrings';
import type { ClockSendOutcome } from './grants';
import { usePermissionPrePrompt } from './PermissionPrePrompt';
import { placeData, type PulsePlaceInput } from './place';
import { usePulseStart } from './PulseRecordButton';
import { usePulseDrafts, usePulseEmbed } from './usePulseEmbed';

const T = CLOCK_PULSE_TEXT;

export type ClockPulseType = 'clock.wrapup' | 'clock.plan';

const isClockPulseType = (type: unknown): type is ClockPulseType =>
  type === 'clock.wrapup' || type === 'clock.plan';

// ─── The place ────────────────────────────────────────────────────────────────

export interface ClockPlaceFacts {
  /** The open session, which a Pulse video wraps up; null when clocked out. */
  session: Pick<ClockEvent, 'id' | 'teamId'> | null;
  /** The team a clock-in goes to; null when the person can't clock in to one. */
  teamId: string | null;
  /** The team's name: what Pulse's banner says ("Wrap-up · Platform"). */
  teamName: string | null;
  /** Today (YYYY-MM-DD): the plan's day, and the wrap-up post's if the session has none. */
  postDate: string;
}

/**
 * What a Clock page's Pulse video records for: the open session's wrap-up,
 * else a plan for the team; null with neither.
 */
export function clockPulsePlace(facts: ClockPlaceFacts): PulsePlaceInput | null {
  const label = facts.teamName ?? '';
  if (facts.session) {
    return {
      type: 'clock.wrapup',
      clockEventId: facts.session.id,
      teamId: facts.session.teamId,
      postDate: facts.postDate,
      label,
    };
  }
  if (!facts.teamId) return null;
  return { type: 'clock.plan', teamId: facts.teamId, postDate: facts.postDate, label };
}

// ─── What `confirmSend` clocked (from the provider's grants) ──────────────────

/** Outcomes kept until their flow's result is read; older ones go first. */
const MAX_NOTED_SENDS = 20;
const noted = new Map<string, ClockSendOutcome>();

/**
 * The server clocked at a Send (grants.ts `onClockSend`): kept, by draft, for
 * the flow's result to say when.
 */
export function noteClockSend(outcome: ClockSendOutcome): void {
  noted.delete(outcome.draftId);
  noted.set(outcome.draftId, outcome);
  while (noted.size > MAX_NOTED_SENDS) noted.delete(noted.keys().next().value as string);
}

/** The clock action noted for a draft's Send, once; null when none was. */
export function takeClockSend(draftId: string | null | undefined): ClockSendOutcome | null {
  if (!draftId) return null;
  const outcome = noted.get(draftId) ?? null;
  noted.delete(draftId);
  return outcome;
}

// ─── Who says what happened ───────────────────────────────────────────────────

/** Places whose flow the Clock page is waiting on, by context key (a count each). */
const announcing = new Map<string, number>();

function claim(key: string): () => void {
  announcing.set(key, (announcing.get(key) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const left = (announcing.get(key) ?? 1) - 1;
    if (left > 0) announcing.set(key, left);
    else announcing.delete(key);
  };
}

/**
 * Whether the Clock page says what a flow's end means, so the provider's
 * generic toast ("Sending to …", "Saved to Unsent videos") stays quiet: a
 * clock flow the page opened and is waiting on, that was sent or kept. A
 * failure is still the provider's to report, and a result from the inbox
 * (the page reloaded under the flow) gets the generic words.
 */
export function clockFlowAnnounced(result: FlowResult): boolean {
  const key = result.context?.key;
  if (!key || !announcing.has(key)) return false;
  if (!isClockPulseType(placeData(result.context)?.type)) return false;
  return (result.status === 'completed' && result.mode === 'pulse') || result.status === 'closed';
}

export interface ClockFlowNotice {
  message: string;
  /** Offer "Clock out now" (a kept wrap-up leaves the person clocked in). */
  clockOutNow: boolean;
}

/** A time as the Clock page writes it ("5:02 PM"); null without one. */
function clockTime(ms: number | null | undefined, locale: string): string | null {
  return typeof ms === 'number' && Number.isFinite(ms) ? formatTime(new Date(ms), locale) : null;
}

/**
 * What the page says when a clock flow ends: the clock action at Send, with
 * the time the server recorded (`outcome.clockEvent`), or that nothing was
 * clocked. Null for an end that says nothing here (discarded; a failure,
 * which the provider reports).
 */
export function clockFlowNotice(
  type: ClockPulseType,
  result: FlowResult,
  outcome: ClockSendOutcome | null,
  locale: string = CLOCK_LOCALE,
): ClockFlowNotice | null {
  const wrapUp = type === 'clock.wrapup';
  const notClocked: ClockFlowNotice = wrapUp
    ? { message: T.stillClockedIn, clockOutNow: true }
    : { message: T.stillClockedOut, clockOutNow: false };
  if (result.status === 'closed') return notClocked;
  if (result.status !== 'completed' || result.mode !== 'pulse') return null;
  const clocked = outcome && outcome.type === type ? outcome.clockEvent : null;
  // Sent without the clock action (a type that doesn't confirm): nothing clocked.
  if (!clocked && result.confirmedAt === undefined) return notClocked;
  const time = clocked
    ? clockTime(wrapUp ? clocked.endTime : clocked.startTime, locale)
    : // Clocked (Pulse confirmed it), but its answer wasn't noted: no time
      // rather than Pulse's own.
      null;
  return { message: wrapUp ? T.clockedOut(time) : T.clockedIn(time), clockOutNow: false };
}

// ─── Online ───────────────────────────────────────────────────────────────────

/** Whether the browser says it is online, kept current. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine !== false,
  );
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    setOnline(navigator.onLine !== false);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  return online;
}

// ─── The button's state ───────────────────────────────────────────────────────

export interface ClockPulse {
  type: ClockPulseType;
  /** The button's words: "Clock out with a Pulse video" / "Clock in with a Pulse video". */
  label: string;
  /** Online: clocking needs the server, so offline the button is disabled. */
  online: boolean;
  /** Why it is disabled ("Needs a connection"), or null. */
  disabledReason: string | null;
  /** A flow is open from this button. */
  busy: boolean;
  /** The tap: explains first on a phone that hasn't seen it, then opens Pulse. */
  start: () => void;
  /** Where focus goes back when the flow ends. */
  buttonRef: React.RefObject<HTMLButtonElement | null>;
  /** The one-time explanation before the first recording; render it. */
  prompt: React.ReactNode;
}

export interface UseClockPulseOptions extends ClockPlaceFacts {
  /** "Clock out now" on the toast after a kept wrap-up: the page's own clock-out. */
  onClockOutNow: () => void;
}

/**
 * The Clock page's Pulse video button, or null where it doesn't show (not
 * the app, Pulse can't run, the team's "Pulse in the app" or "Clock in and
 * out with a Pulse video" is off, or the server doesn't offer the type):
 * then the page keeps today's Pulse link.
 */
export function useClockPulse(options: UseClockPulseOptions): ClockPulse | null {
  const { teamId, teamName, postDate } = options;
  // By value: the page passes a fresh session object each render.
  const sessionId = options.session?.id ?? null;
  const sessionTeamId = options.session?.teamId ?? null;
  const place = useMemo(
    () =>
      clockPulsePlace({
        session: sessionId && sessionTeamId ? { id: sessionId, teamId: sessionTeamId } : null,
        teamId,
        teamName,
        postDate,
      }),
    [sessionId, sessionTeamId, teamId, teamName, postDate],
  );
  const { decision, place: built } = usePulseStart(place);
  const { open } = usePulseEmbed();
  const toast = useOptionalToast();
  const online = useOnline();
  const { beforeRecord, prompt } = usePermissionPrePrompt();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const live = useRef({ toast, onClockOutNow: options.onClockOutNow });
  live.current = { toast, onClockOutNow: options.onClockOutNow };

  const record = useCallback(() => {
    if (!built || !isClockPulseType(built.type)) return;
    const type = built.type;
    const release = claim(built.context.key);
    setBusy(true);
    const ended = (result: FlowResult | null) => {
      release();
      setBusy(false);
      buttonRef.current?.focus();
      if (!result) return;
      const outcome = result.status === 'completed' ? takeClockSend(result.draftId) : null;
      const notice = clockFlowNotice(type, result, outcome);
      if (!notice) return;
      live.current.toast?.toast({
        message: notice.message,
        variant: 'info',
        ...(notice.clockOutNow
          ? {
              // Long enough to reach the action.
              duration: 10_000,
              action: { label: T.clockOutNow, onClick: () => live.current.onClockOutNow() },
            }
          : {}),
      });
    };
    void open({ entry: 'record', context: built.context }).then(ended, () => ended(null));
  }, [built, open]);

  const start = useCallback(() => {
    // Checked again at the tap: Pulse also checks before Send.
    if (busy || !online) return;
    beforeRecord(record);
  }, [beforeRecord, busy, online, record]);

  if (decision.mode !== 'embed' || !built || !isClockPulseType(built.type)) return null;
  return {
    type: built.type,
    label: built.type === 'clock.wrapup' ? T.clockOut : T.clockIn,
    online,
    disabledReason: online ? null : T.needsConnection,
    busy,
    start,
    buttonRef,
    prompt,
  };
}

// ─── "Unsent videos (n)" for clock places ─────────────────────────────────────

const ALL_STATES: DraftState[] = [
  'draft',
  'ready',
  'preparing',
  'queued',
  'waiting_network',
  'uploading',
  'delivering',
  'needs_credentials',
  'failed',
  'sent',
];

/** This phone's videos for clock places: sessions and wrap-ups (`clock:`), plans (`clock-plan:`). */
export const CLOCK_DRAFTS_FILTER: DraftFilter = { contextKeyPrefix: 'clock', states: ALL_STATES };

/**
 * The Clock page's "Unsent videos (n)": videos not yet sent, and of those
 * and the receipts, how many need the person (a failed send, a video kept in
 * the library and not yet dismissed).
 */
export function clockUnsentCounts(drafts: readonly DraftSummary[]): {
  count: number;
  attention: number;
} {
  let count = 0;
  let attention = 0;
  for (const draft of drafts) {
    if (draft.state !== 'sent') count += 1;
    if (draft.state === 'failed') attention += 1;
    else if (draft.state === 'sent' && draft.sent?.outcome === 'kept' && !draft.sent.dismissed) {
      attention += 1;
    }
  }
  return { count, attention };
}

/** This phone's clock videos, counted for the Clock page's link (zero outside the app). */
export function useClockUnsent(): { count: number; attention: number } {
  const { drafts } = usePulseDrafts(CLOCK_DRAFTS_FILTER);
  return useMemo(() => clockUnsentCounts(drafts), [drafts]);
}
