/**
 * Drafts and places for the Media page's tests: one place of each kind, and
 * a DraftSummary in any state for one of them.
 */
import type { DraftState, DraftSummary } from '@mieweb/pulse-embed';

import type { PulseUploadTypeInfo } from '../../lib/api';
import { pulsePlace, type PulsePlace } from '../pulse-embed/place';

export const uploadType = (id: PulseUploadTypeInfo['id']): PulseUploadTypeInfo => ({
  id,
  version: 1,
  targetKind:
    id === 'ticket.video'
      ? 'ticket'
      : id === 'huddle.post'
        ? 'huddle'
        : id === 'library.video'
          ? 'library'
          : id === 'clock.plan'
            ? 'clock-plan'
            : 'clock',
  title: null,
  sendLabel: null,
  prompt: null,
  limits: null,
  requireName: false,
  clock: id === 'clock.wrapup' ? 'stop' : id === 'clock.plan' ? 'start' : null,
  requireOnline: id === 'clock.wrapup' || id === 'clock.plan',
  confirmSend: id === 'clock.wrapup' || id === 'clock.plan',
  maxBytes: 500 * 1024 * 1024,
});

export const PLACES = {
  ticket: pulsePlace({
    type: 'ticket.video',
    ticketId: 'a'.repeat(24),
    label: 'Fix login',
    uploadType: uploadType('ticket.video'),
  })!,
  session: pulsePlace({
    type: 'clock.session',
    clockEventId: 'b'.repeat(24),
    label: 'Platform session',
    uploadType: uploadType('clock.session'),
  })!,
  wrapup: pulsePlace({
    type: 'clock.wrapup',
    clockEventId: 'c'.repeat(24),
    teamId: 'd'.repeat(24),
    postDate: '2026-11-19',
    label: 'Wrap-up · Platform',
    uploadType: uploadType('clock.wrapup'),
  })!,
  post: pulsePlace({
    type: 'huddle.post',
    teamId: 'd'.repeat(24),
    label: 'Platform',
    uploadType: uploadType('huddle.post'),
  })!,
} satisfies Record<string, PulsePlace>;

let seq = 0;

/** A draft for `place` in `state` (a fresh id each call unless given). */
export function draftAt(
  place: PulsePlace | null,
  state: DraftState,
  extra: Partial<DraftSummary> = {},
): DraftSummary {
  const id = extra.id ?? `d${++seq}`;
  return {
    id,
    draftKey: `inst:${id}`,
    name: `Video ${id}`,
    context: place?.context ?? null,
    state,
    clipCount: 1,
    durationMs: 42_000,
    hasCaptions: false,
    poster: null,
    createdVia: 'host',
    createdAt: 1_000,
    updatedAt: 1_000,
    ...extra,
  };
}
