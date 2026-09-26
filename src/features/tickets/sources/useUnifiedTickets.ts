/**
 * Loads every registered ticket source and merges the results into one list.
 *
 * State is partitioned *per source* rather than held in one array. That is not
 * cosmetic: Huddle tickets arrive as a live DDP push that replaces the whole
 * subscribed set, so a shared array would let a Huddle update wipe the Redmine
 * rows on every push.
 *
 * Sources load concurrently and independently — one failing source shows its
 * own error and the rest still render.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { TICKET_SOURCES } from './registry';
import type { TicketSourceContext, TicketSourceId, UnifiedTicket } from './types';

export interface SourcePartition {
  items: UnifiedTicket[];
  loading: boolean;
  /** Set when this source failed; the other sources are unaffected. */
  error: string | null;
}

export interface UnifiedTicketsResult {
  tickets: UnifiedTicket[];
  partitions: Record<TicketSourceId, SourcePartition>;
  /** True until every source has settled at least once. */
  loading: boolean;
  /** Sources that failed, for a per-source error indicator. */
  errors: { sourceId: TicketSourceId; message: string }[];
  refetch: () => void;
  /** Replace one source's rows, for live updates (e.g. the Huddle DDP feed). */
  setSourceItems: (sourceId: TicketSourceId, items: UnifiedTicket[]) => void;
}

const emptyPartition: SourcePartition = { items: [], loading: true, error: null };

const initialPartitions = (): Record<TicketSourceId, SourcePartition> =>
  TICKET_SOURCES.reduce(
    (acc, source) => {
      acc[source.id] = { ...emptyPartition };
      return acc;
    },
    {} as Record<TicketSourceId, SourcePartition>,
  );

export function useUnifiedTickets(ctx: TicketSourceContext): UnifiedTicketsResult {
  const [partitions, setPartitions] =
    useState<Record<TicketSourceId, SourcePartition>>(initialPartitions);

  // Guards against a slow response for a superseded context (a team switch, or a
  // sign-in as someone else) overwriting a newer one.
  const requestSeq = useRef(0);

  const { userId, teams } = ctx;

  // `teams` and `resolveMemberName` get new identities on every render of the
  // owning component, so the load effect keys off the team ids instead.
  const teamsKey = useMemo(
    () =>
      teams
        .map((t) => t.id)
        .sort()
        .join(','),
    [teams],
  );

  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  const load = useCallback(() => {
    const seq = ++requestSeq.current;
    const current = ctxRef.current;

    for (const source of TICKET_SOURCES) {
      if (!source.isAvailable(current)) {
        setPartitions((prev) => ({
          ...prev,
          [source.id]: { items: [], loading: false, error: null },
        }));
        continue;
      }

      setPartitions((prev) => ({
        ...prev,
        [source.id]: { ...prev[source.id], loading: true, error: null },
      }));

      void source
        .load(current)
        .then((items) => {
          if (seq !== requestSeq.current) return;
          setPartitions((prev) => ({
            ...prev,
            [source.id]: { items, loading: false, error: null },
          }));
        })
        .catch((err: unknown) => {
          if (seq !== requestSeq.current) return;
          setPartitions((prev) => ({
            ...prev,
            [source.id]: {
              // Keep whatever this source last returned so a transient failure
              // does not blank out rows the user was already working with.
              items: prev[source.id]?.items ?? [],
              loading: false,
              error: err instanceof Error ? err.message : `Failed to load ${source.label}.`,
            },
          }));
        });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, userId, teamsKey]);

  const setSourceItems = useCallback((sourceId: TicketSourceId, items: UnifiedTicket[]) => {
    setPartitions((prev) => ({
      ...prev,
      [sourceId]: { ...prev[sourceId], items, loading: false },
    }));
  }, []);

  const tickets = useMemo(
    () => TICKET_SOURCES.flatMap((source) => partitions[source.id]?.items ?? []),
    [partitions],
  );

  const loading = useMemo(
    () => TICKET_SOURCES.some((source) => partitions[source.id]?.loading),
    [partitions],
  );

  const errors = useMemo(
    () =>
      TICKET_SOURCES.flatMap((source) => {
        const error = partitions[source.id]?.error;
        return error ? [{ sourceId: source.id, message: error }] : [];
      }),
    [partitions],
  );

  return { tickets, partitions, loading, errors, refetch: load, setSourceItems };
}
