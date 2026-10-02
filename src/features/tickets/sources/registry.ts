/**
 * The ticket source registry.
 *
 * This array is the single place that decides which sources the unified ticket
 * list draws from, and its order is the order of the source filter options.
 *
 * Kept separate from `index.ts` so the hook can import it without a cycle.
 * See README.md for how to add a source.
 */
import { huddleSource } from './huddleSource';
import { redmineSource } from './redmineSource';
import { defineSource, type AnyTicketSource, type TicketSourceId } from './types';

export const TICKET_SOURCES: AnyTicketSource[] = [
  defineSource(huddleSource),
  defineSource(redmineSource),
];

/** Display labels keyed by source id, for badges and filter options. */
export const SOURCE_LABELS = TICKET_SOURCES.reduce(
  (acc, source) => {
    acc[source.id] = source.label;
    return acc;
  },
  {} as Record<TicketSourceId, string>,
);
