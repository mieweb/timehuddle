/**
 * The Unsent videos section's rows as data (PLAN §5.1 Unsent videos): which
 * place group a row is in, the filters, the order rows keep, and the facts
 * about a draft that decide what may be done with it. Pure: no React, no
 * Pulse calls.
 */
import type { DraftSummary, PulseContext } from '@mieweb/pulse-embed';

import { placeData } from '../pulse-embed/place';

/** Where a video was recorded for, as the section groups it. */
export type PlaceGroup = 'ticket' | 'clock' | 'post' | 'library' | 'other';

/** The groups in the order the section shows them. */
export const GROUP_ORDER: readonly PlaceGroup[] = ['ticket', 'clock', 'post', 'library', 'other'];

export type MediaFilter = 'all' | PlaceGroup;

/**
 * A row's group, by the place it was recorded for. A row stays in its group
 * for its whole life (sent, kept or retired included), so it never jumps.
 * A draft with no place (made before Pulse knew places) is "Other".
 */
export function placeGroupOf(context: Pick<PulseContext, 'kind'> | null | undefined): PlaceGroup {
  switch (context?.kind) {
    case 'ticket':
      return 'ticket';
    case 'clock':
    case 'clock-plan':
      return 'clock';
    case 'huddle':
      return 'post';
    case 'library':
      return 'library';
    default:
      return 'other';
  }
}

/** The `?filter=` value as a filter; anything else is All. */
export function parseFilter(raw: string | null | undefined): MediaFilter {
  return raw && (GROUP_ORDER as readonly string[]).includes(raw) ? (raw as PlaceGroup) : 'all';
}

export interface RowGroup<T> {
  group: PlaceGroup;
  rows: T[];
}

/** Rows split into their groups, in GROUP_ORDER, empty groups left out; each keeps the rows' order. */
export function groupRows<T>(rows: readonly T[], groupOf: (row: T) => PlaceGroup): RowGroup<T>[] {
  const by = new Map<PlaceGroup, T[]>();
  for (const row of rows) {
    const group = groupOf(row);
    const list = by.get(group);
    if (list) list.push(row);
    else by.set(group, [row]);
  }
  return GROUP_ORDER.filter((g) => by.has(g)).map((group) => ({ group, rows: by.get(group)! }));
}

/** The filter chips: All plus each group with rows, only when more than one group has rows. */
export function filtersFor(groups: readonly PlaceGroup[]): MediaFilter[] {
  return groups.length > 1 ? ['all', ...groups] : [];
}

/** The groups a filter shows; a filter whose group has no rows (left from before) shows all. */
export function applyFilter<T>(groups: RowGroup<T>[], filter: MediaFilter): RowGroup<T>[] {
  if (filter === 'all') return groups;
  const only = groups.filter((g) => g.group === filter);
  return only.length > 0 ? only : groups;
}

/**
 * The order rows show in, kept across changes (§5.3 "row index stable"):
 * rows seen before keep their places relative to each other, whatever their
 * state does (a draft retiring into its receipt keeps its key, the
 * draftKey); new rows go on top in the order given (newest first).
 */
export function stableOrder(previous: readonly string[], keys: readonly string[]): string[] {
  const present = new Set(keys);
  const known = new Set(previous);
  const fresh = keys.filter((k) => !known.has(k));
  return [...fresh, ...previous.filter((k) => present.has(k))];
}

/** Sort `rows` by `order` (from stableOrder); rows missing from it go first. */
export function inOrder<T>(
  rows: readonly T[],
  order: readonly string[],
  keyOf: (row: T) => string,
) {
  const index = new Map(order.map((k, i) => [k, i]));
  return [...rows].sort((a, b) => (index.get(keyOf(a)) ?? -1) - (index.get(keyOf(b)) ?? -1));
}

/**
 * A clock video whose clock action ran at Send (O13): it stays with that
 * clock-in or clock-out. It can still be edited and sent, never moved.
 */
export function isClockBound(draft: Pick<DraftSummary, 'confirmedAt'> | null | undefined): boolean {
  return typeof draft?.confirmedAt === 'number';
}

/** Which clock action a clock-bound draft belongs to: out (wrap-up), in (plan). */
export function clockActionOf(context: PulseContext | null | undefined): 'out' | 'in' | null {
  const type = placeData(context)?.type ?? context?.uploadType?.id;
  if (type === 'clock.wrapup') return 'out';
  if (type === 'clock.plan') return 'in';
  return null;
}

/** A draft Huddle can send: its context says where (placeData). */
export function hasPlace(context: PulseContext | null | undefined): boolean {
  return placeData(context) !== null;
}
