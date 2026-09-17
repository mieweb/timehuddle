/**
 * The ticket source registry.
 *
 * This array is the single place that decides which sources the unified ticket
 * list draws from. Order determines the order of the source filter options.
 *
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

export { huddleSource } from './huddleSource';
export { redmineSource, invalidateRedmineCache } from './redmineSource';
export * from './types';
export { useUnifiedTickets } from './useUnifiedTickets';
