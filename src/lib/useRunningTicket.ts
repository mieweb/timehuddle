/**
 * useRunningTicket — which ticket (if any) has an open timer for the current user.
 *
 * Shared by ClockPage and TicketsPage so there is one fetch path, one DDP
 * subscription, and one clear-on-error/token-missing behavior. Source-aware
 * since M3: the running ticket may be a Redmine issue, which links out rather
 * than to an in-app route.
 *
 * Uses timers.getRunning + getDay(session.date) rather than getToday(): an open
 * timer keeps its original work-item date and can still be running after
 * midnight (or after break resume recreates it).
 */
import { useCallback, useEffect, useState } from 'react';

import { timerApi, type TicketSourceId } from './api';
import { getDdpClient } from './ddp';

export type RunningTicket = {
  /** `${source}:${id}` — row identity, matching a unified ticket's `key`. */
  key: string;
  source: TicketSourceId;
  id: string;
  title: string;
  /** In-app route for a Huddle ticket, the instance URL for a Redmine issue. */
  url: string | null;
  sessionId: string;
};

export function useRunningTicket(enabled: boolean): RunningTicket | null {
  const [running, setRunning] = useState<RunningTicket | null>(null);

  const refetch = useCallback(async () => {
    if (!localStorage.getItem('meteor_resume_token')) {
      setRunning(null);
      return;
    }
    try {
      const session = await timerApi.getRunning();
      if (!session?.workItemId) {
        setRunning(null);
        return;
      }
      const dayEntries = await timerApi.getDay(session.date);
      const dayEntry = dayEntries.find((de) => de.entry.id === session.workItemId);
      if (!dayEntry?.entry.ticketId) {
        setRunning(null);
        return;
      }
      const { source, ticketId, displayTitle, displayUrl } = dayEntry.entry;
      setRunning({
        key: `${source}:${ticketId}`,
        source,
        id: ticketId,
        title: displayTitle || ticketId,
        url: displayUrl,
        sessionId: session.id,
      });
    } catch {
      setRunning(null);
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setRunning(null);
      return;
    }
    void refetch();
    const ddp = getDdpClient();
    const offChange = ddp.onCollectionChange('timers', () => void refetch());
    const unsubscribe = ddp.subscribe('timers.liveForUser', []);
    const onRefetch = () => void refetch();
    window.addEventListener('work:refetch', onRefetch);
    window.addEventListener('tickets:refetch', onRefetch);
    return () => {
      offChange();
      unsubscribe();
      window.removeEventListener('work:refetch', onRefetch);
      window.removeEventListener('tickets:refetch', onRefetch);
    };
  }, [enabled, refetch]);

  return running;
}
