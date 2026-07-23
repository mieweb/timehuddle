/**
 * useDailyPost — the caller's own Huddle post for today in a team.
 *
 * Backs the plan-first clock flow gates: Clock In requires today's post to
 * exist, Clock Out requires it to have a wrap-up. Listens for the
 * `huddle:refetch` window event so gates flip live after posting.
 */
import { useCallback, useEffect, useState } from 'react';

import { huddleApi, type HuddlePost } from './api';
import { toDateString } from './timeUtils';

export function useDailyPost(teamId: string | null) {
  const [todayPost, setTodayPost] = useState<HuddlePost | null>(null);
  const [loading, setLoading] = useState(false);

  const refetch = useCallback(async () => {
    if (!teamId) {
      setTodayPost(null);
      return;
    }
    setLoading(true);
    try {
      const post = await huddleApi.getMyPostForDate(teamId, toDateString(new Date()));
      setTodayPost(post);
    } catch {
      setTodayPost(null);
    } finally {
      setLoading(false);
    }
  }, [teamId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  useEffect(() => {
    const handler = () => void refetch();
    window.addEventListener('huddle:refetch', handler);
    return () => window.removeEventListener('huddle:refetch', handler);
  }, [refetch]);

  return { todayPost, loading, refetch };
}
