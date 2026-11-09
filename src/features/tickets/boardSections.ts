/**
 * My Board in two sections, as one sortable list: the tickets pinned for
 * today on top, then the rest. Each section starts with a heading entry the
 * rows move past, so dragging a ticket across the Rest heading pins or unpins
 * it. Pure, so the list and the page agree on what a move means.
 */
import type { UnifiedTicket } from './sources';

export const PINNED_HEADING = 'section:pinned';
export const REST_HEADING = 'section:rest';

export type BoardEntry =
  | { kind: 'heading'; id: typeof PINNED_HEADING | typeof REST_HEADING }
  | { kind: 'ticket'; ticket: UnifiedTicket };

export const boardEntryId = (entry: BoardEntry) =>
  entry.kind === 'heading' ? entry.id : entry.ticket.key;

/** The listed tickets split: the pinned in their pinned order, the rest as listed. */
export function splitPinned(tickets: UnifiedTicket[], pinnedKeys: readonly string[]) {
  const byKey = new Map(tickets.map((t) => [t.key, t]));
  const pinned = pinnedKeys.flatMap((key) => byKey.get(key) ?? []);
  const pinnedSet = new Set(pinned.map((t) => t.key));
  return { pinned, rest: tickets.filter((t) => !pinnedSet.has(t.key)) };
}

/** Which sections are collapsed: their tickets are left out under their heading. */
export interface BoardCollapsed {
  pinned: boolean;
  rest: boolean;
}

/** The list's entries, each section under its heading. */
export function boardEntries(
  pinned: UnifiedTicket[],
  rest: UnifiedTicket[],
  collapsed: BoardCollapsed,
): BoardEntry[] {
  const ticket = (t: UnifiedTicket): BoardEntry => ({ kind: 'ticket', ticket: t });
  return [
    { kind: 'heading', id: PINNED_HEADING },
    ...(collapsed.pinned ? [] : pinned.map(ticket)),
    { kind: 'heading', id: REST_HEADING },
    ...(collapsed.rest ? [] : rest.map(ticket)),
  ];
}

/** Nothing lands above the Pinned heading: it is the list's top. */
export const canLandOn = (_dragged: string, target: string) => target !== PINNED_HEADING;

/**
 * The pinned keys and the rest's listed order after a move, from the list's
 * new ids. `shown` are each section's tickets as listed before it. A
 * collapsed section's tickets weren't in the list: a ticket dropped under
 * its heading joins them, at the end of Pinned or the top of the rest.
 * Pinned tickets a filter hides keep their pins, last.
 */
export function arrangeFromIds(
  ids: readonly string[],
  pinnedKeys: readonly string[],
  shown: { pinned: readonly string[]; rest: readonly string[] },
  collapsed: BoardCollapsed,
): { pinned: string[]; rest: string[] } {
  const restAt = ids.indexOf(REST_HEADING);
  const between = ids.slice(ids.indexOf(PINNED_HEADING) + 1, restAt);
  const after = ids.slice(restAt + 1);
  const pinned = collapsed.pinned ? [...shown.pinned, ...between] : between;
  const rest = collapsed.rest ? [...after, ...shown.rest] : after;
  const listed = new Set([...shown.pinned, ...pinned, ...rest]);
  const hidden = pinnedKeys.filter((key) => !listed.has(key));
  return { pinned: [...pinned, ...hidden], rest };
}
