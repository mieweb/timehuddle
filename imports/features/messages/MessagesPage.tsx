/**
 * MessagesPage — Admin-member threaded messaging.
 *
 * Features:
 *   • Thread list — admin sees all member threads, member sees admin threads
 *   • Message composition with send
 *   • Real-time updates via Meteor subscription
 */
import {
  faEnvelope,
  faPaperPlane,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  Avatar,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Select,
  Spinner,
  Text,
} from '@mieweb/ui';
import { Meteor } from 'meteor/meteor';
import { useFind, useSubscribe } from 'meteor/react-meteor-data';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { MESSAGES_PENDING_THREAD_KEY } from '../../lib/constants';
import { useTeam } from '../../lib/TeamContext';
import { useMethod } from '../../lib/useMethod';
import { Messages } from './api';
import type { MessageDoc } from './schema';

// ─── MessagesPage ─────────────────────────────────────────────────────────────

export const MessagesPage: React.FC = () => {
  const userId = Meteor.userId()!;
  const { teams, selectedTeamId, setSelectedTeamId, teamsReady, isAdmin, selectedTeam } = useTeam();

  // Thread selection
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [memberNames, setMemberNames] = useState<Record<string, string>>({});

  // Determine adminId and memberId for the thread
  const adminId = isAdmin ? userId : null;
  const memberId = isAdmin ? selectedMemberId : userId;

  // For non-admins, they need to pick an admin to message
  const [selectedAdminId, setSelectedAdminId] = useState<string | null>(null);
  const effectiveAdminId = isAdmin ? userId : selectedAdminId;
  const effectiveMemberId = isAdmin ? selectedMemberId : userId;

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
    const uid = Meteor.userId();
    if (!uid || typeof window === 'undefined') return;
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
        if (uid === adminId) setSelectedMemberId(memberId);
        else if (uid === memberId) setSelectedAdminId(adminId);
      }
    } catch {
      /* ignore */
    }
     
  }, []);

  // Subscribe to thread
  useSubscribe(
    'messages.thread',
    selectedTeamId ?? '',
    effectiveAdminId ?? '',
    effectiveMemberId ?? '',
  );

  const messages = useFind(
    () => {
      if (!selectedTeamId || !effectiveAdminId || !effectiveMemberId) {
        return Messages.find({ _id: '__none__' });
      }
      const threadId = `${selectedTeamId}:${effectiveAdminId}:${effectiveMemberId}`;
      return Messages.find({ threadId }, { sort: { createdAt: 1 } });
    },
    [selectedTeamId, effectiveAdminId, effectiveMemberId],
  );

  // Fetch team member names
  const getUsers = useMethod<[string[]], Array<{ id: string; name: string; email: string }>>('teams.getUsers');

  useEffect(() => {
    if (!selectedTeam) return;
    const ids = [...new Set([...selectedTeam.members, ...selectedTeam.admins])];
    getUsers.call(ids).then((users) => {
      const names: Record<string, string> = {};
      for (const u of users) names[u.id] = u.name;
      setMemberNames(names);
    }).catch(() => {});
  }, [selectedTeam]);

  // Send message
  const sendMessage = useMethod<
    [{ teamId: string; toUserId: string; text: string; adminId: string }],
    string
  >('messages.send');

  const [messageText, setMessageText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const handleSend = useCallback(async () => {
    if (!messageText.trim() || !selectedTeamId || !effectiveAdminId || !effectiveMemberId) return;
    const toUserId = userId === effectiveAdminId ? effectiveMemberId : effectiveAdminId;
    await sendMessage.call({
      teamId: selectedTeamId,
      toUserId,
      text: messageText.trim(),
      adminId: effectiveAdminId,
    });
    setMessageText('');
  }, [messageText, selectedTeamId, effectiveAdminId, effectiveMemberId, userId, sendMessage]);

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

  const teamOptions = useMemo(
    () =>
      teams
        .filter((t) => !t.isPersonal)
        .map((t) => ({ value: t._id!, label: t.name })),
    [teams],
  );

  if (!teamsReady) {
    return (
      <div className="flex items-center justify-center p-12">
        <Spinner size="lg" label="Loading…" />
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-4rem)] max-w-4xl flex-col p-4 md:p-6">
      {/* Team selector */}
      {teams.length > 1 && (
        <div className="mb-4 flex items-center gap-3">
          <Select
            label="Team"
            hideLabel
            size="sm"
            options={teamOptions}
            value={selectedTeamId ?? ''}
            onValueChange={(v) => { setSelectedTeamId(v); setSelectedMemberId(null); setSelectedAdminId(null); }}
          />
        </div>
      )}

      <div className="flex min-h-0 flex-1 gap-4 overflow-hidden">
        {/* Thread list */}
        <Card padding="none" className="w-48 shrink-0 overflow-y-auto md:w-56">
          <CardHeader className="px-4 py-3">
            <Text size="xs" weight="semibold" className="uppercase tracking-widest text-neutral-400">
              {isAdmin ? 'Members' : 'Admins'}
            </Text>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {threadMembers.map((m) => {
                const isSelected = isAdmin ? selectedMemberId === m.id : selectedAdminId === m.id;
                return (
                  <li key={m.id}>
                    <button
                      type="button"
                      onClick={() => isAdmin ? setSelectedMemberId(m.id) : setSelectedAdminId(m.id)}
                      className={`flex w-full items-center gap-2 px-4 py-3 text-left text-sm transition-colors ${
                        isSelected
                          ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400'
                          : 'text-neutral-700 hover:bg-neutral-50 dark:text-neutral-300 dark:hover:bg-neutral-800'
                      }`}
                      aria-label={`Chat with ${m.name}`}
                    >
                      <Avatar name={m.name} size="xs" />
                      <span className="truncate">{m.name}</span>
                    </button>
                  </li>
                );
              })}
              {threadMembers.length === 0 && (
                <li className="px-4 py-6 text-center">
                  <Text variant="muted" size="xs">
                    {isAdmin ? 'No other members in this team.' : 'No admins in this team.'}
                  </Text>
                </li>
              )}
            </ul>
          </CardContent>
        </Card>

        {/* Chat area */}
        <Card padding="none" className="flex min-w-0 flex-1 flex-col">
          {hasThread ? (
            <>
              {/* Header */}
              <CardHeader className="px-5 py-3">
                <CardTitle className="text-sm">
                  {memberNames[isAdmin ? selectedMemberId! : selectedAdminId!] ?? 'Chat'}
                </CardTitle>
              </CardHeader>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto px-5 py-4">
                {messages.length === 0 && (
                  <div className="flex h-full items-center justify-center">
                    <Text variant="muted" size="sm">No messages yet. Start the conversation!</Text>
                  </div>
                )}
                <div className="space-y-3">
                  {messages.map((msg) => {
                    const isMe = msg.fromUserId === userId;
                    return (
                      <div key={msg._id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                        <div
                          className={`max-w-[75%] rounded-xl px-3 py-2 text-sm ${
                            isMe
                              ? 'bg-blue-600 text-white'
                              : 'bg-neutral-100 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200'
                          }`}
                        >
                          <p>{msg.text}</p>
                          <p className={`mt-1 text-[10px] ${isMe ? 'text-blue-200' : 'text-neutral-400'}`}>
                            {new Date(msg.createdAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
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
                  <Input
                    label="Message"
                    hideLabel
                    placeholder="Type a message…"
                    value={messageText}
                    onChange={(e) => setMessageText(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
                    size="sm"
                  />
                  <Button
                    variant="primary"
                    size="icon"
                    onClick={handleSend}
                    disabled={sendMessage.loading || !messageText.trim()}
                    isLoading={sendMessage.loading}
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
