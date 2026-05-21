/**
 * MessagesPage — Slack-style team channels + direct messages.
 *
 * Features:
 *   • Channels — team-wide group chat (#general etc.)
 *   • Direct Messages — admin↔member threaded messaging
 *   • Real-time updates via WebSocket streams
 *   • Scroll-up lazy loading (cursor-based pagination)
 */
import {
  faArrowLeft,
  faEnvelope,
  faHashtag,
  faPaperPlane,
  faPlus,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  Input,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Spinner,
  Text,
} from '@mieweb/ui';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { MESSAGES_PENDING_THREAD_KEY } from '../../lib/constants';
import { useTeam } from '../../lib/TeamContext';
import { useSession } from '../../lib/useSession';
import { MessagesActiveChatContext } from '../../ui/AppLayout';
import {
  channelApi,
  messageApi,
  userApi,
  type Channel,
  type ChannelMessage,
  type Message,
} from '../../lib/api';
import { UserAvatar } from '../../ui/UserAvatar';

// ─── MessagesPage ─────────────────────────────────────────────────────────────

export const MessagesPage: React.FC = () => {
  const { user } = useSession();
  const userId = user?.id ?? '';
  const { selectedTeamId, setSelectedTeamId, teamsReady, isAdmin, selectedTeam } = useTeam();
  const { setHasActiveChat } = React.useContext(MessagesActiveChatContext);

  // ── View mode ───────────────────────────────────────────────────────────────
  const [activeView, setActiveView] = useState<'channel' | 'dm'>('channel');

  // ── Channel state ────────────────────────────────────────────────────────────
  const [channels, setChannels] = useState<Channel[]>([]);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [channelMessages, setChannelMessages] = useState<ChannelMessage[]>([]);
  const [channelHasMore, setChannelHasMore] = useState(false);
  const [channelLoadingMore, setChannelLoadingMore] = useState(false);
  const [channelMessageText, setChannelMessageText] = useState('');
  const [channelSendLoading, setChannelSendLoading] = useState(false);
  const channelScrollRef = useRef<HTMLDivElement>(null);
  const channelTopSentinelRef = useRef<HTMLDivElement>(null);
  const channelEndRef = useRef<HTMLDivElement>(null);
  const prevChannelMsgCountRef = useRef(0);

  // Unread counts — keyed by channelId / peer userId
  const [channelUnread, setChannelUnread] = useState<Record<string, number>>({});
  const [dmUnread, setDmUnread] = useState<Record<string, number>>({});
  // Refs so async WS/SSE handlers can read current selection without stale closure
  const activeViewRef = useRef(activeView);
  const selectedChannelIdRef = useRef(selectedChannelId);
  const selectedPeerIdRef = useRef<string | null>(null);
  useEffect(() => {
    activeViewRef.current = activeView;
  }, [activeView]);
  useEffect(() => {
    selectedChannelIdRef.current = selectedChannelId;
  }, [selectedChannelId]);

  // Create channel modal
  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const [newChannelName, setNewChannelName] = useState('');
  const [newChannelDesc, setNewChannelDesc] = useState('');
  const [newChannelMembers, setNewChannelMembers] = useState<string[]>([]);
  const [createChannelLoading, setCreateChannelLoading] = useState(false);
  const [createChannelError, setCreateChannelError] = useState<string | null>(null);
  const [channelSendError, setChannelSendError] = useState<string | null>(null);

  // ── DM state ─────────────────────────────────────────────────────────────────
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [memberNames, setMemberNames] = useState<Record<string, string>>({});
  const [memberImages, setMemberImages] = useState<Record<string, string | null>>({});
  const [memberNamesLoaded, setMemberNamesLoaded] = useState(false);
  const [selectedAdminId, setSelectedAdminId] = useState<string | null>(null);
  const effectiveAdminId = isAdmin ? userId : selectedAdminId;
  const effectiveMemberId = isAdmin ? selectedMemberId : userId;

  const [messages, setMessages] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [sendLoading, setSendLoading] = useState(false);
  const [messageText, setMessageText] = useState('');
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const topSentinelRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const prevMessageCountRef = useRef(0);

  // ── Deep-link / pending thread handling ──────────────────────────────────────
  const pendingOpenPeerRef = useRef<string | null>(null);
  const pendingDmIntentRef = useRef(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const q = new URLSearchParams(window.location.search);
    const openTeam = q.get('openTeam');
    const openPeer = q.get('openPeer');
    if (!openTeam && !openPeer) return;
    if (openTeam) setSelectedTeamId(openTeam);
    if (openPeer) {
      pendingOpenPeerRef.current = openPeer;
      pendingDmIntentRef.current = true;
    }
    window.history.replaceState(null, '', '/app/messages');
  }, []);

  useEffect(() => {
    const peer = pendingOpenPeerRef.current;
    if (!peer || !selectedTeam || !userId) return;
    pendingOpenPeerRef.current = null;
    if (selectedTeam.admins.includes(userId) && selectedTeam.members.includes(peer)) {
      setSelectedMemberId(peer);
      setActiveView('dm');
      pendingDmIntentRef.current = false;
    } else if (selectedTeam.members.includes(userId) && selectedTeam.admins.includes(peer)) {
      setSelectedAdminId(peer);
      setActiveView('dm');
      pendingDmIntentRef.current = false;
    }
  }, [selectedTeam, userId]);

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
        pendingDmIntentRef.current = true;
        if (userId === adminId) setSelectedMemberId(memberId);
        else if (userId === memberId) setSelectedAdminId(adminId);
        setActiveView('dm');
      }
    } catch {
      /* ignore */
    }
  }, [userId]);

  useEffect(() => {
    const handler = (e: Event) => {
      const {
        teamId: tId,
        adminId: aId,
        memberId: mId,
      } = (e as CustomEvent<{ teamId: string; adminId: string; memberId: string }>).detail;
      if (tId) setSelectedTeamId(tId);
      if (aId && mId && userId) {
        pendingDmIntentRef.current = true;
        if (userId === aId) setSelectedMemberId(mId);
        else if (userId === mId) setSelectedAdminId(aId);
        setActiveView('dm');
      }
    };
    window.addEventListener('timehuddle:openThread', handler);
    return () => window.removeEventListener('timehuddle:openThread', handler);
  }, [userId]);

  // ── Fetch member names ────────────────────────────────────────────────────────
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
        const images: Record<string, string | null> = {};
        for (const u of users) {
          names[u.id] = u.name;
          images[u.id] = u.image;
        }
        setMemberNames(names);
        setMemberImages(images);
        setMemberNamesLoaded(true);
      })
      .catch(() => {
        setMemberNamesLoaded(true);
      });
  }, [selectedTeam]);

  // ── Fetch channels when team changes ─────────────────────────────────────────
  useEffect(() => {
    if (!selectedTeamId) {
      setChannels([]);
      setSelectedChannelId(null);
      return;
    }
    channelApi
      .getChannels(selectedTeamId)
      .then((cs) => {
        setChannels(cs);
        const def = cs.find((c) => c.isDefault) ?? cs[0];
        if (def) {
          setSelectedChannelId(def.id);
          if (!pendingDmIntentRef.current) {
            setActiveView('channel');
          }
        } else {
          setSelectedChannelId(null);
        }
      })
      .catch(() => {});
  }, [selectedTeamId]);

  // ── Channel messages (load on select) ────────────────────────────────────────
  useEffect(() => {
    if (!selectedChannelId || !selectedTeamId) {
      setChannelMessages([]);
      setChannelHasMore(false);
      return;
    }
    channelApi
      .getMessages(selectedChannelId, selectedTeamId)
      .then(({ messages: msgs, hasMore: more }) => {
        setChannelMessages(msgs);
        setChannelHasMore(more);
      })
      .catch(() => {});
  }, [selectedChannelId, selectedTeamId]);

  // Clear unread when a channel is opened
  useEffect(() => {
    if (!selectedChannelId) return;
    setChannelUnread((prev) => {
      if (!prev[selectedChannelId]) return prev;
      const next = { ...prev };
      delete next[selectedChannelId];
      return next;
    });
  }, [selectedChannelId]);

  // ── All-channels WS — real-time messages + unread tracking ───────────────────
  useEffect(() => {
    if (!selectedTeamId || channels.length === 0) return;
    const wsList = channels.map((ch) => {
      const ws = channelApi.openStream(ch.id, selectedTeamId);
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data) as ChannelMessage;
          const isActive =
            activeViewRef.current === 'channel' && selectedChannelIdRef.current === ch.id;
          if (isActive) {
            setChannelMessages((prev) =>
              prev.some((m) => m.id === msg.id) ? prev : [...prev, msg],
            );
          } else {
            setChannelUnread((prev) => ({ ...prev, [ch.id]: (prev[ch.id] ?? 0) + 1 }));
          }
        } catch {
          /* ignore */
        }
      };
      return ws;
    });
    return () => {
      wsList.forEach((ws) => ws.close());
    };
  }, [channels, selectedTeamId]);

  // ── Channel lazy-load older messages ─────────────────────────────────────────
  const oldestChannelCreatedAt =
    channelMessages.length > 0 ? channelMessages[0].createdAt : undefined;
  useEffect(() => {
    const sentinel = channelTopSentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        if (!channelHasMore || channelLoadingMore) return;
        if (!selectedChannelId || !selectedTeamId || !oldestChannelCreatedAt) return;

        setChannelLoadingMore(true);
        const container = channelScrollRef.current;
        const prevScrollHeight = container?.scrollHeight ?? 0;

        channelApi
          .getMessages(selectedChannelId, selectedTeamId, oldestChannelCreatedAt)
          .then(({ messages: older, hasMore: more }) => {
            setChannelMessages((prev) => [...older, ...prev]);
            setChannelHasMore(more);
            requestAnimationFrame(() => {
              if (container) {
                container.scrollTop = container.scrollHeight - prevScrollHeight;
              }
            });
          })
          .catch(() => {})
          .finally(() => setChannelLoadingMore(false));
      },
      { threshold: 0.1 },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [
    channelHasMore,
    channelLoadingMore,
    selectedChannelId,
    selectedTeamId,
    oldestChannelCreatedAt,
  ]);

  // ── Channel auto-scroll ───────────────────────────────────────────────────────
  useEffect(() => {
    const prev = prevChannelMsgCountRef.current;
    const curr = channelMessages.length;
    if (
      curr > prev &&
      channelMessages[curr - 1]?.createdAt !== channelMessages[prev - 1]?.createdAt
    ) {
      channelEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    } else if (curr > 0 && prev === 0) {
      channelEndRef.current?.scrollIntoView({ behavior: 'instant' });
    }
    prevChannelMsgCountRef.current = curr;
  }, [channelMessages]);

  // ── Channel send ──────────────────────────────────────────────────────────────
  const handleChannelSend = useCallback(async () => {
    if (!channelMessageText.trim() || !selectedChannelId || !selectedTeamId) return;
    setChannelSendLoading(true);
    setChannelSendError(null);
    try {
      const sent = await channelApi.sendMessage(selectedChannelId, {
        teamId: selectedTeamId,
        text: channelMessageText.trim(),
      });
      setChannelMessages((prev) => (prev.some((m) => m.id === sent.id) ? prev : [...prev, sent]));
      setChannelMessageText('');
    } catch (err) {
      setChannelSendError(err instanceof Error ? err.message : 'Failed to send');
    } finally {
      setChannelSendLoading(false);
    }
  }, [channelMessageText, selectedChannelId, selectedTeamId]);

  // ── Create channel ────────────────────────────────────────────────────────────
  const handleCreateChannel = useCallback(async () => {
    if (!newChannelName.trim() || !selectedTeamId) return;
    setCreateChannelLoading(true);
    setCreateChannelError(null);
    try {
      const ch = await channelApi.createChannel({
        teamId: selectedTeamId,
        name: newChannelName.trim(),
        description: newChannelDesc.trim() || undefined,
        members: newChannelMembers.length > 0 ? newChannelMembers : undefined,
      });
      setChannels((prev) => [...prev, ch]);
      setSelectedChannelId(ch.id);
      setActiveView('channel');
      setShowCreateChannel(false);
      setNewChannelName('');
      setNewChannelDesc('');
      setNewChannelMembers([]);
      setCreateChannelError(null);
    } catch (err) {
      setCreateChannelError(err instanceof Error ? err.message : 'Failed to create channel');
    } finally {
      setCreateChannelLoading(false);
    }
  }, [newChannelName, newChannelDesc, newChannelMembers, selectedTeamId]);

  // ── DM thread logic (load messages on select) ───────────────────────────────
  useEffect(() => {
    if (!selectedTeamId || !effectiveAdminId || !effectiveMemberId) {
      setMessages([]);
      setHasMore(false);
      return;
    }

    messageApi
      .getThread(selectedTeamId, effectiveAdminId, effectiveMemberId)
      .then(({ messages: msgs, hasMore: more }) => {
        setMessages(msgs);
        setHasMore(more);
      })
      .catch(() => {});
  }, [selectedTeamId, effectiveAdminId, effectiveMemberId]);

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

  useEffect(() => {
    const prev = prevMessageCountRef.current;
    const curr = messages.length;
    if (curr > prev && messages[curr - 1]?.createdAt !== messages[prev - 1]?.createdAt) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    } else if (curr > 0 && prev === 0) {
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
      setMessages((prev) => (prev.some((m) => m.id === sent.id) ? prev : [...prev, sent]));
      setMessageText('');
    } finally {
      setSendLoading(false);
    }
  }, [messageText, selectedTeamId, effectiveAdminId, effectiveMemberId, userId]);

  const threadMembers = useMemo(() => {
    if (!selectedTeam) return [];
    if (isAdmin) {
      return selectedTeam.members
        .filter((id) => id !== userId)
        .map((id) => ({ id, name: memberNames[id] || id }));
    } else {
      return selectedTeam.admins.map((id) => ({ id, name: memberNames[id] || id }));
    }
  }, [selectedTeam, isAdmin, userId, memberNames]);

  // Sync selected peer ref for WS/SSE handlers
  useEffect(() => {
    selectedPeerIdRef.current = isAdmin ? selectedMemberId : selectedAdminId;
  }, [isAdmin, selectedMemberId, selectedAdminId]);

  // Clear DM unread when a peer is opened
  useEffect(() => {
    const peerId = isAdmin ? selectedMemberId : selectedAdminId;
    if (!peerId) return;
    setDmUnread((prev) => {
      if (!prev[peerId]) return prev;
      const next = { ...prev };
      delete next[peerId];
      return next;
    });
  }, [isAdmin, selectedMemberId, selectedAdminId]);

  // ── All-DM-threads SSE — real-time messages + unread tracking ────────────────
  useEffect(() => {
    if (!selectedTeamId || threadMembers.length === 0) return;
    const esList = threadMembers.map((m) => {
      const threadId = isAdmin
        ? `${selectedTeamId}:${userId}:${m.id}`
        : `${selectedTeamId}:${m.id}:${userId}`;
      const es = messageApi.openStream(threadId);
      es.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data) as Message;
          const isActive = activeViewRef.current === 'dm' && selectedPeerIdRef.current === m.id;
          if (isActive) {
            setMessages((prev) =>
              prev.some((msg2) => msg2.id === msg.id) ? prev : [...prev, msg],
            );
          } else {
            setDmUnread((prev) => ({ ...prev, [m.id]: (prev[m.id] ?? 0) + 1 }));
          }
        } catch {
          /* ignore */
        }
      };
      return es;
    });
    return () => {
      esList.forEach((es) => es.close());
    };
  }, [threadMembers, selectedTeamId, userId, isAdmin]);

  const hasThread = isAdmin ? !!selectedMemberId : !!selectedAdminId;
  const hasActiveChat = activeView === 'channel' ? !!selectedChannelId : hasThread;

  // Sync active-chat state up to AppLayout so it can show/hide BottomNav
  useEffect(() => {
    setHasActiveChat(hasActiveChat);
    return () => setHasActiveChat(false);
  }, [hasActiveChat, setHasActiveChat]);

  const handleBack = useCallback(() => {
    if (activeView === 'channel') {
      setSelectedChannelId(null);
    } else {
      if (isAdmin) setSelectedMemberId(null);
      else setSelectedAdminId(null);
    }
  }, [activeView, isAdmin]);

  // ── Render ────────────────────────────────────────────────────────────────────
  if (!teamsReady) {
    return (
      <div className="flex items-center justify-center p-12">
        <Spinner size="lg" label="Loading…" />
      </div>
    );
  }

  const selectedChannel = channels.find((c) => c.id === selectedChannelId);

  return (
    <div className="flex h-full w-full flex-col md:mx-auto md:max-w-4xl md:p-6">
      <div className="flex min-h-0 flex-1 gap-0 overflow-hidden md:gap-4">
        {/* ── Sidebar ─────────────────────────────────────────────────────── */}
        <Card
          padding="none"
          className={`overflow-y-auto rounded-none border-0 shadow-none md:block md:w-56 md:shrink-0 md:rounded-lg md:border md:shadow ${
            hasActiveChat ? 'hidden' : 'w-full'
          }`}
        >
          {/* Channels section */}
          <CardHeader className="px-4 pb-1 pt-3">
            <div className="flex items-center justify-between">
              <Text
                size="xs"
                weight="semibold"
                className="uppercase tracking-widest text-neutral-400"
              >
                Channels
              </Text>
              <button
                type="button"
                onClick={() => setShowCreateChannel(true)}
                className="flex items-center justify-center rounded p-0.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
                aria-label="Create channel"
              >
                <FontAwesomeIcon icon={faPlus} className="text-xs" />
              </button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {channels.length === 0 ? (
              <div className="px-4 py-3">
                <Text variant="muted" size="xs">
                  No channels yet.
                </Text>
              </div>
            ) : (
              <ul>
                {channels.map((ch) => {
                  const isSel = selectedChannelId === ch.id && activeView === 'channel';
                  const unread = channelUnread[ch.id] ?? 0;
                  return (
                    <li key={ch.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedChannelId(ch.id);
                          setActiveView('channel');
                        }}
                        className={`flex w-full items-center gap-2 px-4 py-2 text-left text-sm transition-colors ${
                          isSel
                            ? 'bg-blue-50 font-semibold text-blue-700 dark:bg-blue-950/40 dark:text-blue-400'
                            : 'text-neutral-700 hover:bg-neutral-50 dark:text-neutral-300 dark:hover:bg-neutral-800'
                        }`}
                        aria-label={`Channel ${ch.name}${unread > 0 ? `, ${unread} unread` : ''}`}
                      >
                        <FontAwesomeIcon
                          icon={faHashtag}
                          className="shrink-0 text-xs text-neutral-400"
                        />
                        <span className="flex-1 truncate">{ch.name}</span>
                        {unread > 0 && (
                          <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-600 px-1.5 text-[10px] font-bold text-white">
                            {unread > 99 ? '99+' : unread}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>

          {/* Divider */}
          <div className="mx-4 my-2 border-t border-neutral-100 dark:border-neutral-800" />

          {/* Direct Messages section */}
          <CardHeader className="px-4 pb-1 pt-1">
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
              <div className="flex items-center justify-center py-6">
                <Spinner size="sm" label="Loading…" />
              </div>
            ) : (
              <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {threadMembers.map((m) => {
                  const isSelected =
                    activeView === 'dm' &&
                    (isAdmin ? selectedMemberId === m.id : selectedAdminId === m.id);
                  return (
                    <li key={m.id}>
                      <button
                        type="button"
                        onClick={() => {
                          if (isAdmin) setSelectedMemberId(m.id);
                          else setSelectedAdminId(m.id);
                          setActiveView('dm');
                        }}
                        className={`flex w-full items-center gap-3 px-4 py-3 text-left text-sm transition-colors ${
                          isSelected
                            ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400'
                            : 'text-neutral-700 hover:bg-neutral-50 dark:text-neutral-300 dark:hover:bg-neutral-800'
                        }`}
                        aria-label={`Direct message ${m.name}${dmUnread[m.id] ? `, ${dmUnread[m.id]} unread` : ''}`}
                      >
                        <UserAvatar name={m.name} size="sm" src={memberImages[m.id]} />
                        <span className="flex-1 truncate font-medium">{m.name}</span>
                        {(dmUnread[m.id] ?? 0) > 0 && (
                          <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-600 px-1.5 text-[10px] font-bold text-white">
                            {(dmUnread[m.id] ?? 0) > 99 ? '99+' : dmUnread[m.id]}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
                {threadMembers.length === 0 && (
                  <li className="px-4 py-6 text-center">
                    <Text variant="muted" size="sm">
                      {isAdmin ? 'No members yet.' : 'No admins yet.'}
                    </Text>
                  </li>
                )}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* ── Chat area ────────────────────────────────────────────────────── */}
        <Card
          padding="none"
          className={`flex min-w-0 flex-col rounded-none border-0 shadow-none md:flex-1 md:rounded-lg md:border md:shadow ${hasActiveChat ? 'flex-1' : 'hidden md:flex'}`}
        >
          {activeView === 'channel' && selectedChannel ? (
            <>
              {/* Channel header — sticky */}
              <CardHeader className="sticky top-0 z-10 flex-row items-center gap-2 bg-white px-4 py-3 dark:bg-neutral-900">
                <button
                  type="button"
                  onClick={handleBack}
                  className="flex items-center justify-center rounded-lg p-1.5 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800 md:hidden"
                  aria-label="Back to list"
                >
                  <FontAwesomeIcon icon={faArrowLeft} className="text-sm" />
                </button>
                <FontAwesomeIcon icon={faHashtag} className="text-neutral-400" />
                <span className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">
                  {selectedChannel.name}
                </span>
                {selectedChannel.description && (
                  <Text size="xs" variant="muted" className="ml-2 hidden md:block">
                    {selectedChannel.description}
                  </Text>
                )}
              </CardHeader>

              {/* Channel messages — Slack-style */}
              <div
                ref={channelScrollRef}
                className="flex-1 overflow-y-auto px-4 pb-[96px] pt-3 md:pb-3"
              >
                <div ref={channelTopSentinelRef} className="flex justify-center py-1">
                  {channelLoadingMore && <Spinner size="sm" label="Loading older messages…" />}
                </div>
                {channelMessages.length === 0 && (
                  <div className="flex h-full items-center justify-center">
                    <Text variant="muted" size="sm">
                      No messages yet. Start the conversation!
                    </Text>
                  </div>
                )}
                <div className="space-y-1">
                  {channelMessages.map((msg, i) => {
                    const prev = channelMessages[i - 1];
                    const showHeader =
                      !prev ||
                      prev.fromUserId !== msg.fromUserId ||
                      new Date(msg.createdAt).getTime() - new Date(prev.createdAt).getTime() >
                        5 * 60 * 1000;
                    return (
                      <div key={msg.id} className={`flex gap-3 ${showHeader ? 'mt-4' : 'mt-0.5'}`}>
                        <div className="w-8 shrink-0">
                          {showHeader && <UserAvatar name={msg.senderName} size="sm" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          {showHeader && (
                            <div className="mb-0.5 flex items-baseline gap-2">
                              <span className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">
                                {msg.senderName}
                              </span>
                              <span className="text-[10px] text-neutral-400">
                                {new Date(msg.createdAt).toLocaleTimeString('en-US', {
                                  hour: 'numeric',
                                  minute: '2-digit',
                                })}
                              </span>
                            </div>
                          )}
                          <p className="text-sm text-neutral-800 dark:text-neutral-200">
                            {msg.text}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                  <div ref={channelEndRef} />
                </div>
              </div>

              {/* Channel compose — fixed bottom on mobile */}
              <div className="fixed bottom-0 left-0 right-0 border-t border-neutral-100 bg-white px-3 pb-[env(safe-area-inset-bottom,16px)] pt-3 dark:border-neutral-800 dark:bg-neutral-900 md:relative md:bottom-auto md:left-auto md:right-auto md:px-3 md:pb-3">
                {channelSendError && (
                  <p className="mb-2 text-xs text-red-500">{channelSendError}</p>
                )}
                <div className="flex gap-2">
                  <div className="flex-1">
                    <Input
                      label="Message"
                      hideLabel
                      placeholder={`Message #${selectedChannel.name}`}
                      value={channelMessageText}
                      onChange={(e) => {
                        setChannelMessageText(e.target.value);
                        setChannelSendError(null);
                      }}
                      onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleChannelSend()}
                      size="sm"
                      className="w-full"
                    />
                  </div>
                  <Button
                    variant="primary"
                    size="icon"
                    onClick={handleChannelSend}
                    disabled={channelSendLoading || !channelMessageText.trim()}
                    isLoading={channelSendLoading}
                    aria-label="Send message"
                  >
                    <FontAwesomeIcon icon={faPaperPlane} className="text-xs" />
                  </Button>
                </div>
              </div>
            </>
          ) : activeView === 'dm' && hasThread ? (
            <>
              {/* DM header — sticky */}
              <CardHeader className="sticky top-0 z-10 bg-white px-4 py-3 dark:bg-neutral-900">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleBack}
                    className="flex items-center justify-center rounded-lg p-1.5 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800 md:hidden"
                    aria-label="Back to list"
                  >
                    <FontAwesomeIcon icon={faArrowLeft} className="text-sm" />
                  </button>
                  <span className="text-sm font-semibold">
                    {memberNames[isAdmin ? selectedMemberId! : selectedAdminId!] ?? 'Chat'}
                  </span>
                </div>
              </CardHeader>

              {/* DM messages */}
              <div
                ref={scrollContainerRef}
                className="flex-1 overflow-y-auto px-5 pb-[96px] pt-4 md:pb-4"
              >
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

              {/* DM compose — fixed bottom on mobile */}
              <div className="fixed bottom-0 left-0 right-0 border-t border-neutral-100 bg-white px-3 pb-[env(safe-area-inset-bottom,16px)] pt-3 dark:border-neutral-800 dark:bg-neutral-900 md:relative md:bottom-auto md:left-auto md:right-auto md:px-3 md:pb-3">
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
                Select a channel or direct message
              </Text>
            </CardContent>
          )}
        </Card>
      </div>

      {/* Create channel modal */}
      <Modal
        open={showCreateChannel}
        onOpenChange={(open) => {
          if (!open) {
            setShowCreateChannel(false);
            setCreateChannelError(null);
            setNewChannelMembers([]);
          }
        }}
        aria-label="Create channel"
      >
        <ModalHeader>Create Channel</ModalHeader>
        <ModalBody>
          <div className="flex flex-col gap-4">
            {createChannelError && (
              <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950 dark:text-red-400">
                {createChannelError}
              </p>
            )}
            <Input
              label="Channel name"
              placeholder="e.g. engineering"
              value={newChannelName}
              onChange={(e) => {
                setNewChannelName(e.target.value);
                setCreateChannelError(null);
              }}
              onKeyDown={(e) => e.key === 'Enter' && handleCreateChannel()}
            />
            <Input
              label="Description (optional)"
              placeholder="What is this channel for?"
              value={newChannelDesc}
              onChange={(e) => setNewChannelDesc(e.target.value)}
            />
            {/* Member selection */}
            {memberNamesLoaded && threadMembers.length > 0 && (
              <div>
                <Text size="sm" weight="semibold" className="mb-2 block">
                  Members
                </Text>
                <Text size="xs" variant="muted" className="mb-3 block">
                  Leave all unchecked to create a team-wide channel.
                </Text>
                <ul className="max-h-48 overflow-y-auto rounded-lg border border-neutral-200 dark:border-neutral-700">
                  {threadMembers.map((m) => (
                    <li key={m.id}>
                      <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-neutral-50 dark:hover:bg-neutral-800">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-neutral-300 accent-blue-600"
                          checked={newChannelMembers.includes(m.id)}
                          onChange={(e) =>
                            setNewChannelMembers((prev) =>
                              e.target.checked ? [...prev, m.id] : prev.filter((id) => id !== m.id),
                            )
                          }
                        />
                        <UserAvatar name={m.name} size="sm" src={memberImages[m.id]} />
                        <span className="text-sm">{m.name}</span>
                      </label>
                    </li>
                  ))}
                </ul>
                {newChannelMembers.length > 0 && (
                  <Text size="xs" variant="muted" className="mt-1">
                    {newChannelMembers.length} member{newChannelMembers.length > 1 ? 's' : ''}{' '}
                    selected
                  </Text>
                )}
              </div>
            )}
          </div>
        </ModalBody>
        <ModalFooter>
          <Button
            variant="ghost"
            onClick={() => {
              setShowCreateChannel(false);
              setNewChannelMembers([]);
            }}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleCreateChannel}
            disabled={createChannelLoading || !newChannelName.trim()}
            isLoading={createChannelLoading}
          >
            Create
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
};
