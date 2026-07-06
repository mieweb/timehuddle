import { useEffect, useMemo, useRef, useState } from 'react';
import { getDdpClient } from './ddp';

/**
 * Subscribe to real-time online/offline presence for a list of user IDs.
 * Returns a `Set<string>` of user IDs currently online.
 *
 * Uses the Meteor `presence.watch` DDP publication which pushes a virtual
 * `presence` collection with `{ _id: userId, online: boolean }` docs.
 * The DDP connection heartbeat keeps the current user marked online
 * server-side — no client-side ping loop needed.
 */
export function usePresence(watchIds: string[]): Set<string> {
  const [version, setVersion] = useState(0);
  const idsKey = watchIds.slice().sort().join(',');
  const idsRef = useRef(watchIds);
  idsRef.current = watchIds;

  useEffect(() => {
    if (idsRef.current.length === 0) return;
    const ddp = getDdpClient();
    const offChange = ddp.onCollectionChange('presence', () => setVersion((v) => v + 1));
    const unsubscribe = ddp.subscribe('presence.watch', [idsRef.current]);
    return () => {
      offChange();
      unsubscribe();
    };
  }, [idsKey]);

  const onlineSet = useMemo(() => {
    if (watchIds.length === 0) return new Set<string>();
    const ddp = getDdpClient();
    const set = new Set<string>();
    for (const doc of ddp.docs('presence')) {
      if (doc.online) set.add(doc._id);
    }
    return set;
  }, [idsKey, version]);

  return onlineSet;
}
