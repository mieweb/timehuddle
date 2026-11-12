import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { huddleApi, type HuddleConversation, type HuddlePost } from '@lib/api';

import { toConversationTopics, type ConversationTopics } from './superChatFeed';

/**
 * The conversation topics (#866) the reader can see on `teamId`, fetched once
 * per team. Posts stream in live but the list doesn't, so when a post names a
 * conversation the list doesn't have yet (a direct conversation someone just
 * opened with you, a workday a teammate just started), the list is fetched
 * again — once per unknown id (#866 R22).
 */
export function useConversationTopics(
  teamId: string | null,
  posts: HuddlePost[],
): {
  conversations: HuddleConversation[];
  topics: ConversationTopics;
  refresh: () => Promise<void>;
} {
  const [conversations, setConversations] = useState<HuddleConversation[]>([]);
  // The team the list was last loaded for; until then a post can't be "unknown".
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  // Answers for a team the reader has since left are dropped.
  const teamRef = useRef(teamId);
  teamRef.current = teamId;

  const refresh = useCallback(async () => {
    if (!teamId) {
      setConversations([]);
      return;
    }
    try {
      const { conversations: list } = await huddleApi.listConversations(teamId);
      if (teamRef.current !== teamId) return;
      setConversations(list);
      setLoadedFor(teamId);
    } catch (err) {
      // The feed still works without names; the next refresh tries again.
      console.error('[Huddle] Failed to load conversations:', err);
    }
  }, [teamId]);

  useEffect(() => {
    setConversations([]);
    void refresh();
  }, [refresh]);

  const asked = useRef(new Set<string>());
  useEffect(() => {
    asked.current = new Set();
  }, [teamId]);
  useEffect(() => {
    if (!teamId || loadedFor !== teamId) return;
    const known = new Set(conversations.map((c) => c.id));
    const unknown = posts.find(
      (p) =>
        p.conversationId && !known.has(p.conversationId) && !asked.current.has(p.conversationId),
    );
    if (!unknown?.conversationId) return;
    asked.current.add(unknown.conversationId);
    void refresh();
  }, [teamId, loadedFor, posts, conversations, refresh]);

  const topics = useMemo(() => toConversationTopics(conversations), [conversations]);
  return { conversations, topics, refresh };
}
