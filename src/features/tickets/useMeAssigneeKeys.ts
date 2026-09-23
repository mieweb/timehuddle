/**
 * The signed-in user's assignee keys, one per source they exist in.
 *
 * The unified table namespaces assignee ids by source (`huddle:<userId>`,
 * `redmine:<accountId>`) because the two id spaces are unrelated and can
 * collide. "Me" is therefore not one value but a set, which is what the `ME`
 * filter sentinel resolves against.
 *
 * The Redmine half comes from the caller's `useRedmineStatus()`, rather than a
 * second `redmine.status()` fetch of its own: one fetch, and one place that
 * reacts when the account is linked or unlinked. Until that status resolves —
 * or for a user with no link at all — "Me" is simply Huddle-only, which is the
 * right answer rather than a half-loaded error state for something this
 * incidental.
 */
import { useMemo } from 'react';

import type { RedmineStatus } from '../../lib/api';
import { useSession } from '../../lib/useSession';

export function useMeAssigneeKeys(redmineStatus: RedmineStatus | null): string[] {
  const { user } = useSession();
  const userId = user?.id ?? null;
  const redmineUserId = redmineStatus?.connected ? (redmineStatus.redmineUserId ?? null) : null;

  // Stable identity: this feeds a useMemo dependency in useTicketTableView, so
  // a fresh array each render would re-filter the whole list every time.
  return useMemo(() => {
    // With nobody signed in there is no "me" to match, in either namespace —
    // a Redmine status left over from the previous session must not leak a key
    // into the next one.
    if (!userId) return [];
    const keys = [`huddle:${userId}`];
    if (redmineUserId != null) keys.push(`redmine:${redmineUserId}`);
    return keys;
  }, [userId, redmineUserId]);
}
