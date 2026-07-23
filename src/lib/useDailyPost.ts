/**
 * useDailyPost — the caller's own Huddle post for today in a team, kept live
 * via the `huddlePosts.byTeam` DDP publication (oplog/change-stream backed).
 *
 * Backs the plan-first clock flow gates: Clock In requires today's post to
 * exist, Clock Out requires it to have a wrap-up. Creates, edits, and deletes
 * flip the gates in realtime — no reload or manual refetch needed.
 */
import { useEffect, useState } from 'react';

import type { HuddlePost } from './api';
import { getDdpClient } from './ddp';
import { toDateString } from './timeUtils';
import { useSession } from './useSession';

export function useDailyPost(teamId: string | null) {
  const { user } = useSession();
  const userId = user?.id ?? null;
  const [todayPost, setTodayPost] = useState<HuddlePost | null>(null);

  useEffect(() => {
    if (!teamId || !userId) {
      setTodayPost(null);
      return;
    }

    const ddp = getDdpClient();
    const today = toDateString(new Date());

    const sync = () => {
      const mine = ddp
        .docs('huddlePosts')
        .filter((p) => p.teamId === teamId && p.userId === userId && p.postDate === today)
        .map((p) => ({ ...p, id: (p.id ?? p._id) as string }) as unknown as HuddlePost)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setTodayPost(mine[0] ?? null);
    };

    const unsubscribe = ddp.subscribe('huddlePosts.byTeam', [teamId], sync);
    const offChange = ddp.onCollectionChange('huddlePosts', sync);
    // Sync immediately in case the collection is already cached.
    sync();

    return () => {
      offChange();
      unsubscribe();
      setTodayPost(null);
    };
  }, [teamId, userId]);

  return { todayPost };
}
