/**
 * "Record with Pulse" for a place on screen (PLAN §5.1 flows A, B1 and P;
 * F1, TH-7): a ticket's row and its Videos card, a clock session's videos,
 * and the Huddle composer. Where Pulse runs in the app (startPulse says
 * `embed`), the Pulse glyph opens Pulse's recorder for the place at once;
 * anywhere else the host's `fallback` shows instead, which is today's Pulse
 * link flow (PulseButton), unchanged.
 *
 * The first tap on a phone shows the in-context explanation first
 * (PermissionPrePrompt). After the flow, focus goes back to the button, and
 * on to the new row when the host shows one (`onResult`). What happened is said by
 * the provider, once per flow, in the toast region ("Sending to Fix login",
 * "Saved to Unsent videos").
 *
 * With `showUnsent`, the place's unsent videos on this phone sit beside the
 * button as "1 unsent video here · Open", which opens the newest in Pulse's
 * editor (O10: the recorder still opens directly).
 */
import type { DraftState, FlowResult } from '@mieweb/pulse-embed';
import { Button, cn } from '@mieweb/ui';
import React, { useCallback, useId, useMemo, useRef, useState } from 'react';

import { isMobileBrowser, isNativeApp } from '../../lib/device';
import { PulseIcon } from '../pulse-upload/PulseIcon';
import { usePermissionPrePrompt } from './PermissionPrePrompt';
import { pulsePlace, type PulsePlace, type PulsePlaceInput } from './place';
import { RECORD_TEXT } from './recordStrings';
import {
  isIPadAgent,
  pulseSettingsOnFor,
  startPulse,
  type StartPulseDecision,
  type StartPulseFacts,
} from './startPulse';
import { pulseFakeEnabled } from './testAdapter';
import { usePulseDrafts, usePulseEmbed, type PulseEmbed } from './usePulseEmbed';

const T = RECORD_TEXT;

// ─── Whether a place records in the app ───────────────────────────────────────

/** The team whose Pulse settings decide a place: its own, else the one the host names. */
export function placeTeamId(place: PulsePlaceInput, teamId?: string | null): string | null {
  if ('teamId' in place && typeof place.teamId === 'string') return place.teamId;
  return teamId ?? null;
}

/** What this device is, for startPulse; a fake-Pulse test build counts as the app. */
function deviceFacts(): Pick<StartPulseFacts, 'isNativeApp' | 'isMobileBrowser' | 'isIPad'> {
  const nav = typeof navigator === 'undefined' ? null : navigator;
  return {
    isNativeApp: isNativeApp() || pulseFakeEnabled(),
    isMobileBrowser: isMobileBrowser(),
    isIPad: nav ? isIPadAgent(nav.userAgent ?? '', nav.maxTouchPoints ?? 0) : false,
  };
}

/** startPulse's facts for recording `place` with Pulse as the provider has it now. */
export function recordFacts(
  embed: PulseEmbed,
  place: PulsePlaceInput,
  teamId: string | null,
  device: Pick<StartPulseFacts, 'isNativeApp' | 'isMobileBrowser' | 'isIPad'> = deviceFacts(),
): StartPulseFacts {
  return {
    ...device,
    // Until the account is applied, Pulse isn't ready to record: today's link shows.
    pluginAvailable: embed.status === 'ready',
    info: embed.info,
    runtimePaused: embed.runtimePaused === true,
    // Before the server has sent the settings, no team has Pulse on.
    settingOn: pulseSettingsOnFor(embed.teams, teamId, place.type),
    type: place.type,
    supportedTypes: embed.types?.map((t) => t.id) ?? null,
  };
}

export interface PulseStart {
  decision: StartPulseDecision;
  /** The place as Pulse records it; null when it can't be one (then the link shows). */
  place: PulsePlace | null;
}

/** How a tap records for `place` here: Pulse in the app, or today's link. */
export function usePulseStart(place: PulsePlaceInput | null, teamId?: string | null): PulseStart {
  const embed = usePulseEmbed();
  // By value: hosts build the place inline on every render.
  const placeJson = place ? JSON.stringify(place) : null;
  return useMemo(() => {
    const input = placeJson ? (JSON.parse(placeJson) as PulsePlaceInput) : null;
    if (!input) return { decision: { mode: 'link', reason: 'type-unsupported' }, place: null };
    const uploadType = embed.types?.find((t) => t.id === input.type) ?? null;
    const built = pulsePlace({ ...input, uploadType });
    const decision = startPulse(recordFacts(embed, input, placeTeamId(input, teamId)));
    return { decision, place: built };
  }, [embed, placeJson, teamId]);
}

// ─── "1 unsent video here · Open" ─────────────────────────────────────────────

/**
 * The drafts the link counts: those that go nowhere until the person acts
 * (never sent, or failed). One that is waiting or sending is on its way, and
 * shows on the place's "On this phone" rows instead.
 */
export const UNSENT_HERE_STATES: DraftState[] = ['draft', 'ready', 'failed'];

export interface UnsentHereLinkProps {
  /** The place's key (`context.key`). */
  contextKey: string;
  className?: string;
}

/** The place's unsent videos on this phone, opening the newest in Pulse's editor. */
export function UnsentHereLink({ contextKey, className }: UnsentHereLinkProps) {
  const embed = usePulseEmbed();
  const { drafts } = usePulseDrafts({ contextKey, states: UNSENT_HERE_STATES });
  const link = useRef<HTMLButtonElement>(null);
  if (drafts.length === 0) return null;
  const newest = drafts.reduce((a, b) => (b.updatedAt > a.updatedAt ? b : a));
  return (
    <Button
      ref={link}
      type="button"
      variant="link"
      size="sm"
      className={cn('pulse-unsent-here h-auto p-0', className)}
      onClick={() => {
        void embed.open({ entry: 'edit', draftId: newest.id }).then(() => link.current?.focus());
      }}
    >
      {T.unsentHere(drafts.length)}
    </Button>
  );
}

// ─── The button ───────────────────────────────────────────────────────────────

export interface PulseRecordButtonProps {
  /** Where the video goes and what Pulse calls it; null: today's link only. */
  place: PulsePlaceInput | null;
  /** The place's team when the place doesn't carry one (a ticket, a session). */
  teamId?: string | null;
  /** Today's Pulse link flow for this place, shown wherever Pulse doesn't run in the app. */
  fallback: React.ReactNode;
  /** Also show "1 unsent video here · Open" beside the button. */
  showUnsent?: boolean;
  /**
   * A flow ended (focus is already back on the button). A host with the
   * place's rows moves focus on to the new row once it shows.
   */
  onResult?: (result: FlowResult) => void;
  className?: string;
  /** The glyph's own classes (a row sizes it like its other icon buttons). */
  buttonClassName?: string;
}

export function PulseRecordButton({
  place,
  teamId,
  fallback,
  showUnsent = false,
  onResult,
  className,
  buttonClassName,
}: PulseRecordButtonProps) {
  const embed = usePulseEmbed();
  const { decision, place: built } = usePulseStart(place, teamId);
  const { beforeRecord, prompt } = usePermissionPrePrompt();
  const button = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const describedBy = useId();
  const { open } = embed;

  const record = useCallback(() => {
    if (!built) return;
    setBusy(true);
    const ended = (result: FlowResult | null) => {
      setBusy(false);
      // Back where the person was; the host may move it on to the new row.
      button.current?.focus();
      if (result) onResult?.(result);
    };
    void open({ entry: 'record', context: built.context }).then(ended, () => ended(null));
  }, [built, onResult, open]);

  if (decision.mode !== 'embed' || !built) return <>{fallback}</>;

  const forPlace = T.forPlace(built.context.label);
  return (
    <span className={cn('pulse-record inline-flex items-center gap-2', className)}>
      <Button
        ref={button}
        type="button"
        variant="ghost"
        size="icon"
        className={cn('pulse-record-button shrink-0', buttonClassName)}
        aria-label={T.record}
        aria-describedby={forPlace ? describedBy : undefined}
        // Not `disabled`: focus comes back to it when the flow ends.
        aria-disabled={busy || undefined}
        aria-busy={busy || undefined}
        onClick={() => {
          if (!busy) beforeRecord(record);
        }}
      >
        <PulseIcon className="h-4" />
      </Button>
      {forPlace && (
        <span id={describedBy} className="sr-only">
          {forPlace}
        </span>
      )}
      {showUnsent && <UnsentHereLink contextKey={built.context.key} />}
      {prompt}
    </span>
  );
}
