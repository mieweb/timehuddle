/**
 * useSessionPost — the caller's published Huddle post linked to a clock
 * session (by clockEventId), kept live via the `huddlePosts.byTeam` DDP
 * publication (oplog/change-stream backed).
 *
 * Backs the per-session plan-first gate: clock-out requires this session's
 * post to have a wrap-up. Realtime — the wrap-up flips the gate with no
 * reload.
 */
import { useEffect, useState } from 'react';

import type { HuddlePost } from './api';
import { getDdpClient } from './ddp';

// The plan is posted at clock-in; a day of slack covers one written just before it.
const PLAN_LEAD_MS = 24 * 60 * 60 * 1000;

export function useSessionPost(
  teamId: string | null,
  clockEventId: string | null,
  sessionStart: number | null,
) {
  const [sessionPost, setSessionPost] = useState<HuddlePost | null>(null);

  useEffect(() => {
    if (!teamId || !clockEventId || sessionStart === null) {
      setSessionPost(null);
      return;
    }

    const ddp = getDdpClient();

    const sync = () => {
      const match = ddp
        .docs('huddlePosts')
        .map((p) => ({ ...p, id: (p.id ?? p._id) as string }) as unknown as HuddlePost)
        .filter((p) => p.teamId === teamId && p.clockEventId === clockEventId)
        // Same pick as the server's SESSION_POST_SORT: the wrap-up post, else the
        // earliest (the plan) — later posts are inbox replies, not the plan.
        .sort(
          (a, b) =>
            Number(!!b.wrapUpAt) - Number(!!a.wrapUpAt) ||
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        );
      setSessionPost(match[0] ?? null);
    };

    // The feed only publishes the last 30 days by default, which a long-running
    // session's plan post can fall outside of.
    const since = new Date(sessionStart - PLAN_LEAD_MS).toISOString();
    const unsubscribe = ddp.subscribe('huddlePosts.byTeam', [teamId, since], sync);
    const offChange = ddp.onCollectionChange('huddlePosts', sync);
    sync();

    return () => {
      offChange();
      unsubscribe();
      setSessionPost(null);
    };
  }, [teamId, clockEventId, sessionStart]);

  return { sessionPost };
}
