/**
 * The signed-in user's assignee keys, one per source they exist in.
 *
 * The unified table namespaces assignee ids by source (`huddle:<userId>`,
 * `redmine:<accountId>`) because the two id spaces are unrelated and can
 * collide. "Me" is therefore not one value but a set, which is what the `ME`
 * filter sentinel resolves against.
 *
 * The Huddle key is available immediately from the session; the Redmine one
 * needs the linked account, so it arrives a moment later and simply widens the
 * set. Until then "Me" still works for Huddle tickets — it never shows a
 * half-loaded error state for something this incidental.
 */
import { useEffect, useMemo, useState } from 'react';

import { redmineApi } from '../../lib/api';
import { useSession } from '../../lib/useSession';

export function useMeAssigneeKeys(): string[] {
  const { user } = useSession();
  const userId = user?.id ?? null;
  const [redmineUserId, setRedmineUserId] = useState<number | null>(null);

  useEffect(() => {
    if (!userId) {
      setRedmineUserId(null);
      return;
    }
    let cancelled = false;
    redmineApi
      .status()
      .then((status) => {
        if (!cancelled) setRedmineUserId(status.connected ? (status.redmineUserId ?? null) : null);
      })
      // A missing Redmine link is the normal case, not an error worth surfacing:
      // "Me" just stays Huddle-only.
      .catch(() => {
        if (!cancelled) setRedmineUserId(null);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Stable identity: this feeds a useMemo dependency in useTicketTableView, so
  // a fresh array each render would re-filter the whole list every time.
  return useMemo(() => {
    const keys: string[] = [];
    if (userId) keys.push(`huddle:${userId}`);
    if (redmineUserId != null) keys.push(`redmine:${redmineUserId}`);
    return keys;
  }, [userId, redmineUserId]);
}
