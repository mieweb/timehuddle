import { useEffect, useRef, useState } from 'react';
import { presenceApi } from './api.js';

const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * Subscribe to real-time online/offline presence for a list of user IDs.
 * Returns a `Set<string>` of user IDs currently online.
 * Sends periodic ping heartbeats to keep the current user marked online.
 */
export function usePresence(watchIds: string[]): Set<string> {
  const [onlineSet, setOnlineSet] = useState<Set<string>>(new Set());
  // Stable key so the effect only re-runs when the actual IDs change
  const idsKey = watchIds.slice().sort().join(',');
  const pingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (watchIds.length === 0) {
      setOnlineSet(new Set());
      return;
    }

    const ws = presenceApi.openStream(watchIds);

    ws.onmessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data as string) as
          | { type: 'snapshot'; online: string[] }
          | { type: 'presence'; userId: string; online: boolean };

        if (msg.type === 'snapshot') {
          setOnlineSet(new Set(msg.online));
        } else if (msg.type === 'presence') {
          setOnlineSet((prev) => {
            const next = new Set(prev);
            if (msg.online) next.add(msg.userId);
            else next.delete(msg.userId);
            return next;
          });
        }
      } catch {
        /* ignore malformed frames */
      }
    };

    // Keep the current user marked online with heartbeats
    pingRef.current = setInterval(() => {
      ws.send(JSON.stringify({ type: 'ping' }));
    }, HEARTBEAT_INTERVAL_MS);

    return () => {
      if (pingRef.current) {
        clearInterval(pingRef.current);
        pingRef.current = null;
      }
      ws.close();
    };
  }, [idsKey]);

  return onlineSet;
}
