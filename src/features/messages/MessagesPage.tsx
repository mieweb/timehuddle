/**
 * MessagesPage — Admin-member threaded messaging.
 *
 * Features:
 *   • Thread list — admin sees all member threads, member sees admin threads
 *   • Message composition with send
 *   • Real-time updates via SSE stream
 */
import { faArrowLeft, faEnvelope, faPaperPlane } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  Avatar,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Spinner,
  Text,
} from '@mieweb/ui';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { MESSAGES_PENDING_THREAD_KEY } from '../../lib/constants';
import { useTeam } from '../../lib/TeamContext';
import { useSession } from '../../lib/useSession';
import { messageApi, userApi, type Message } from '../../lib/api';

// ─── MessagesPage ─────────────────────────────────────────────────────────────

export const MessagesPage: React.FC = () => {
  const { user } = useSession();
  const userId = user?.id ?? '';
  const { selectedTeamId, setSelectedTeamId, teamsReady, isAdmin, selectedTeam } = useTeam();

  // Thread selection
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [memberNames, setMemberNames] = useState<Record<string, string>>({});
  const [memberNamesLoaded, setMemberNamesLoaded] = useState(false);

  // For non-admins, they need to pick an admin to message
  const [selectedAdminId, setSelectedAdminId] = useState<string | null>(null);
  const effectiveAdminId = isAdmin ? userId : selectedAdminId;
  const effectiveMemberId = isAdmin ? selectedMemberId : userId;

  // Messages state
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [sendLoading, setSendLoading] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const topSentinelRef = useRef<HTMLDivElement>(null);

  /** From push notification URL: /app/messages?openTeam=&openPeer= */
  const pendingOpenPeerRef = useRef<string | null>(null);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const q = new URLSearchParams(window.location.search);
    const openTeam = q.get('openTeam');
    const openPeer = q.get('openPeer');
    if (!openTeam && !openPeer) return;
    if (openTeam) setSelectedTeamId(openTeam);
    if (openPeer) pendingOpenPeerRef.current = openPeer;
    window.history.replaceState(null, '', '/app/messages');
  }, []);

  useEffect(() => {
    const peer = pendingOpenPeerRef.current;
    if (!peer || !selectedTeam || !userId) return;
    pendingOpenPeerRef.current = null;
    if (selectedTeam.admins.includes(userId) && selectedTeam.members.includes(peer)) {
      setSelectedMemberId(peer);
    } else if (selectedTeam.members.includes(userId) && selectedTeam.admins.includes(peer)) {
      setSelectedAdminId(peer);
    }
  }, [selectedTeam, userId]);

  // Deep-link from notification inbox (threadId team:admin:member) — one-shot on mount
  useEffect(() => {
    if (!userId || typeof window === 'undefined') return;
    let raw: string | null = null;
    try {
      raw = sessionStorage.getItem(MESSAGES_PENDING_THREAD_KEY);
    } catch {
      return;
    }
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as { teamId?: string; adminId?: string; memberId?: string };
      sessionStorage.removeItem(MESSAGES_PENDING_THREAD_KEY);
      const { teamId, adminId, memberId } = parsed;
      if (teamId) setSelectedTeamId(teamId);
      if (adminId && memberId) {
        if (userId === adminId) setSelectedMemberId(memberId);
        else if (userId === memberId) setSelectedAdminId(adminId);
      }
    } catch {
      /* ignore */
    }
  }, [userId]);

  // Handle in-app "open this thread" events (fired by notification tap when already mounted)
  useEffect(() => {
    const handler = (e: Event) => {
      const { teamId: tId, adminId: aId, memberId: mId } = (
        e as CustomEvent<{ teamId: string; adminId: string; memberId: string }>
      ).detail;
      if (tId) setSelectedTeamId(tId);
      if (aId && mId && userId) {
        if (userId === aId) setSelectedMemberId(mId);
        else if (userId === mId) setSelectedAdminId(aId);
      }
    };
    window.addEventListener('timehuddle:openThread', handler);
    return () => window.removeEventListener('timehuddle:openThread', handler);
  }, [userId]);

  // Fetch thread history + open WebSocket when thread is selected
  useEffect(() => {
    if (!selectedTeamId || !effectiveAdminId || !effectiveMemberId) {
      setMessages([]);
      setHasMore(false);
      return;
    }
    const threadId = `${selectedTeamId}:${effectiveAdminId}:${effectiveMemberId}`;

    // Initial fetch — most recent page
    messageApi
      .getThread(selectedTeamId, effectiveAdminId, effectiveMemberId)
      .then(({ messages: msgs, hasMore: more }) => {
        setMessages(msgs);
        setHasMore(more);
      })
      .catch(() => {});

    // WebSocket for real-time updates
    const es = messageApi.openStream(threadId);
    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data) as Message;
        setMessages((prev) => {
          if (prev.some((m) => m.id === msg.id)) return prev;
          return [...prev, msg];
        });
      } catch {
        /* ignore */
      }
    };
    return () => es.close();
  }, [selectedTeamId, effectiveAdminId, effectiveMemberId]);

  // Load older messages when top sentinel enters viewport
  const oldestCreatedAt = messages.length > 0 ? messages[0].createdAt : undefined;
  useEffect(() => {
    const sentinel = topSentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        if (!hasMore || loadingMore) return;
        if (!selectedTeamId || !effectiveAdminId || !effectiveMemberId || !oldestCreatedAt) return;

        setLoadingMore(true);
        const container = scrollContainerRef.current;
        const prevScrollHeight = container?.scrollHeight ?? 0;

        messageApi
          .getThread(selectedTeamId, effectiveAdminId, effectiveMemberId, oldestCreatedAt)
          .then(({ messages: older, hasMore: more }) => {
            setMessages((prev) => [...older, ...prev]);
            setHasMore(more);
            requestAnimationFrame(() => {
              if (container) {
                container.scrollTop = container.scrollHeight - prevScrollHeight;
              }
            });
          })
          .catch(() => {})
          .finally(() => setLoadingMore(false));
      },
      { threshold: 0.1 },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadingMore, selectedTeamId, effectiveAdminId, effectiveMemberId, oldestCreatedAt]);

  // Fetch team member names via REST
  useEffect(() => {
    if (!selectedTeam) {
      setMemberNamesLoaded(false);
      return;
    }
    setMemberNamesLoaded(false);
    const ids = [...new Set([...selectedTeam.members, ...selectedTeam.admins])];
    userApi
      .getUsers(ids)
      .then((users) => {
        const names: Record<string, string> = {};
        for (const u of users) names[u.id] = u.name;
        setMemberNames(names);
        setMemberNamesLoaded(true);
      })
      .catch(() => { setMemberNamesLoaded(true); });
  }, [selectedTeam]);

  const [messageText, setMessageText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const prevMessageCountRef = useRef(0);

  // Auto-scroll to bottom only when new messages arrive (not on prepend from lazy load)
  useEffect(() => {
    const prev = prevMessageCountRef.current;
    const curr = messages.length;
    // A prepend increases count but the first message changes — skip scroll
    // A new incoming message appends — scroll to bottom
    if (curr > prev && messages[curr - 1]?.createdAt !== messages[prev - 1]?.createdAt) {
      // count went up and last message changed → new message at the bottom
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    } else if (curr > 0 && prev === 0) {
      // initial load — jump to bottom instantly
      messagesEndRef.current?.scrollIntoView({ behavior: 'instant' });
    }
    prevMessageCountRef.current = curr;
  }, [messages]);

  const handleSend = useCallback(async () => {
    if (!messageText.trim() || !selectedTeamId || !effectiveAdminId || !effectiveMemberId) return;
    const toUserId = userId === effectiveAdminId ? effectiveMemberId : effectiveAdminId;
    setSendLoading(true);
    try {
      const sent = await messageApi.send({
        teamId: selectedTeamId,
        toUserId,
        text: messageText.trim(),
        adminId: effectiveAdminId,
      });
      // Append immediately (SSE will deduplicate if it also arrives)
      setMessages((prev) => (prev.some((m) => m.id === sent.id) ? prev : [...prev, sent]));
      setMessageText('');
    } finally {
      setSendLoading(false);
    }
  }, [messageText, selectedTeamId, effectiveAdminId, effectiveMemberId, userId]);

  // Thread participants
  const threadMembers = useMemo(() => {
    if (!selectedTeam) return [];
    if (isAdmin) {
      // Admin sees all non-admin members
      return selectedTeam.members
        .filter((id) => id !== userId)
        .map((id) => ({ id, name: memberNames[id] || id }));
    } else {
      // Member sees all admins
      return selectedTeam.admins.map((id) => ({ id, name: memberNames[id] || id }));
    }
  }, [selectedTeam, isAdmin, userId, memberNames]);

  const hasThread = isAdmin ? !!selectedMemberId : !!selectedAdminId;

  const handleBack = useCallback(() => {
    if (isAdmin) setSelectedMemberId(null);
    else setSelectedAdminId(null);
  }, [isAdmin]);

  if (!teamsReady) {
    return (
      <div className="flex items-center justify-center p-12">
        <Spinner size="lg" label="Loading…" />
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-4rem)] max-w-4xl flex-col p-4 md:p-6">
      <div className="flex min-h-0 flex-1 gap-4 overflow-hidden">
        {/* Thread list — full width on mobile, sidebar on desktop */}
        <Card
          padding="none"
          className={`overflow-y-auto md:block md:w-56 md:shrink-0 ${
            hasThread ? 'hidden' : 'w-full'
          }`}
        >
          <CardHeader className="px-4 py-3">
            <Text
              size="xs"
              weight="semibold"
              className="uppercase tracking-widest text-neutral-400"
            >
              {isAdmin ? 'Members' : 'Admins'}
            </Text>
          </CardHeader>
          <CardContent className="p-0">
            {!memberNamesLoaded ? (
              <div className="flex items-center justify-center py-8">
                <Spinner size="sm" label="Loading…" />
              </div>
            ) : (
            <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {threadMembers.map((m) => {
                const isSelected = isAdmin ? selectedMemberId === m.id : selectedAdminId === m.id;
                return (
                  <li key={m.id}>
                    <button
                      type="button"
                      onClick={() =>
                        isAdmin ? setSelectedMemberId(m.id) : setSelectedAdminId(m.id)
                      }
                      className={`flex w-full items-center gap-3 px-4 py-3.5 text-left text-sm transition-colors ${
                        isSelected
                          ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400'
                          : 'text-neutral-700 hover:bg-neutral-50 dark:text-neutral-300 dark:hover:bg-neutral-800'
                      }`}
                      aria-label={`Chat with ${m.name}`}
                    >
                      <Avatar name={m.name} size="sm" />
                      <span className="truncate font-medium">{m.name}</span>
                    </button>
                  </li>
                );
              })}
              {threadMembers.length === 0 && (
                <li className="px-4 py-8 text-center">
                  <Text variant="muted" size="sm">
                    {isAdmin ? 'No other members in this team.' : 'No admins in this team.'}
                  </Text>
                </li>
              )}
            </ul>
            )}
          </CardContent>
        </Card>

        {/* Chat area — hidden on mobile until a thread is selected */}
        <Card
          padding="none"
          className={`flex min-w-0 flex-col md:flex-1 ${hasThread ? 'flex-1' : 'hidden md:flex'}`}
        >
          {hasThread ? (
            <>
              {/* Header with back button on mobile */}
              <CardHeader className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleBack}
                    className="flex items-center justify-center rounded-lg p-1.5 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800 md:hidden"
                    aria-label="Back to list"
                  >
                    <FontAwesomeIcon icon={faArrowLeft} className="text-sm" />
                  </button>
                  <CardTitle className="text-sm">
                    {memberNames[isAdmin ? selectedMemberId! : selectedAdminId!] ?? 'Chat'}
                  </CardTitle>
                </div>
              </CardHeader>

              {/* Messages */}
              <div ref={scrollContainerRef} className="flex-1 overflow-y-auto px-5 py-4">
                {/* Top sentinel — triggers loading older messages */}
                <div ref={topSentinelRef} className="flex justify-center py-2">
                  {loadingMore && <Spinner size="sm" label="Loading older messages…" />}
                </div>
                {messages.length === 0 && (
                  <div className="flex h-full items-center justify-center">
                    <Text variant="muted" size="sm">
                      No messages yet. Start the conversation!
                    </Text>
                  </div>
                )}
                <div className="space-y-3">
                  {messages.map((msg) => {
                    const isMe = msg.fromUserId === userId;
                    return (
                      <div
                        key={msg.id}
                        className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}
                      >
                        <div
                          className={`max-w-[75%] rounded-xl px-3 py-2 text-sm ${
                            isMe
                              ? 'bg-blue-600 text-white'
                              : 'bg-neutral-100 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200'
                          }`}
                        >
                          <p>{msg.text}</p>
                          <p
                            className={`mt-1 text-[10px] ${isMe ? 'text-blue-200' : 'text-neutral-400'}`}
                          >
                            {new Date(msg.createdAt).toLocaleTimeString('en-US', {
                              hour: 'numeric',
                              minute: '2-digit',
                            })}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                  <div ref={messagesEndRef} />
                </div>
              </div>

              {/* Compose */}
              <div className="border-t border-neutral-100 p-3 dark:border-neutral-800">
                <div className="flex gap-2">
                  <div className="flex-1">
                    <Input
                      label="Message"
                      hideLabel
                      placeholder="Type a message…"
                      value={messageText}
                      onChange={(e) => setMessageText(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
                      size="sm"
                      className="w-full"
                    />
                  </div>
                  <Button
                    variant="primary"
                    size="icon"
                    onClick={handleSend}
                    disabled={sendLoading || !messageText.trim()}
                    isLoading={sendLoading}
                    aria-label="Send message"
                  >
                    <FontAwesomeIcon icon={faPaperPlane} className="text-xs" />
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <CardContent className="flex flex-1 flex-col items-center justify-center gap-2 text-neutral-400">
              <FontAwesomeIcon icon={faEnvelope} className="text-3xl" />
              <Text variant="muted" size="sm">
                Select a {isAdmin ? 'member' : 'admin'} to start messaging
              </Text>
            </CardContent>
          )}
        </Card>
      </div>
    </div>
  );
};
