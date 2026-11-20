/**
 * Splits My Board's rows into its two sections (#884): **Pinned**, in the
 * user's own order, and **Rest of my board**, in the list's sort.
 *
 * A ticket counts as pinned through any of its board entries — its own, or
 * the linked issue's (`boardEntryKeys`) — and takes the earliest one's place.
 */
import { linkedIssueKey, type UnifiedTicket } from './sources';

export interface PinnedSections {
  pinned: UnifiedTicket[];
  rest: UnifiedTicket[];
}

/** Where a ticket sits among the pins, or -1 when it is not pinned. */
export function pinIndex(ticket: UnifiedTicket, pinnedKeys: readonly string[]): number {
  const places = [ticket.key, linkedIssueKey(ticket)]
    .map((key) => (key ? pinnedKeys.indexOf(key) : -1))
    .filter((index) => index >= 0);
  return places.length ? Math.min(...places) : -1;
}

/** `sorted` split into pins (in pin order) and the rest (left in `sorted`'s order). */
export function splitPinned(
  sorted: readonly UnifiedTicket[],
  pinnedKeys: readonly string[],
): PinnedSections {
  const placed = sorted.map((ticket) => ({ ticket, index: pinIndex(ticket, pinnedKeys) }));
  return {
    pinned: placed
      .filter((p) => p.index >= 0)
      .sort((a, b) => a.index - b.index)
      .map((p) => p.ticket),
    rest: placed.filter((p) => p.index < 0).map((p) => p.ticket),
  };
}

/**
 * The full pin list after a drag on My Board. `before` and `after` are the
 * pins the list showed, in order, before and after the drag. Pins it didn't
 * show (filtered out) keep their places; the shown ones fill the shown slots
 * in their new order, and a newly pinned one beyond those goes at the end.
 */
export function mergePinOrder(
  current: readonly string[],
  before: readonly string[],
  after: readonly string[],
): string[] {
  const shown = new Set(before);
  const queue = [...after];
  const merged: string[] = [];
  for (const key of current) {
    if (!shown.has(key)) merged.push(key);
    else if (queue.length) merged.push(queue.shift()!);
  }
  return [...merged, ...queue];
}
