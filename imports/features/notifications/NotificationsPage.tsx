/**
 * NotificationsPage — In-app notification inbox (parity with timeharbor-old /notifications).
 *
 * Lists notifications for the signed-in user, supports mark read, mark all read,
 * multi-select delete, and navigation when a notification has a deep link.
 */
import { faCheckDouble, faCircleInfo, faTrash, faXmark } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Button, Modal, ModalBody, ModalClose, ModalFooter, ModalHeader, ModalTitle, Text } from '@mieweb/ui';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { MESSAGES_PENDING_THREAD_KEY } from '../../lib/constants';
import { notificationApi, type Notification, type TeamInvitePreview } from '../../lib/api';
import { useSession } from '../../lib/useSession';
import { useRouter } from '../../ui/router';

function timeAgo(date: Date | string | undefined): string {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  const diffMs = Date.now() - d.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins} min ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
  if (diffDays < 7) return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
  });
}

/** Map legacy Time Harbor paths to TimeHuddle /app routes */
function normalizeAppPath(path: string): string {
  if (!path.startsWith('/')) return '/app/dashboard';
  if (path.startsWith('/app/')) return path;
  const direct: Record<string, string> = {
    '/teams': '/app/teams',
    '/tickets': '/app/tickets',
    '/notifications': '/app/notifications',
    '/messages': '/app/messages',
  };
  if (direct[path]) return direct[path];
  if (path.startsWith('/member/')) return '/app/messages';
  return `/app${path}`;
}

function resolveNotificationTarget(
  doc: Notification | undefined,
  navigate: (path: string) => void,
): void {
  if (!doc) return;
  const data = (doc.data ?? {}) as Record<string, unknown>;

  if (typeof data.url === 'string' && data.url.length > 0) {
    const u = data.url as string;
    if (u.startsWith('http://') || u.startsWith('https://')) {
      window.location.href = u;
      return;
    }
    navigate(normalizeAppPath(u));
    return;
  }

  if (data.type === 'team-invite') {
    navigate('/app/teams');
    return;
  }
  if (data.type === 'auto-clock-out') {
    navigate('/app/tickets');
    return;
  }
  if (data.type === 'message') {
    if (typeof data.threadId === 'string') {
      const parts = (data.threadId as string).split(':');
      if (parts.length >= 3) {
        const teamId = parts[0]!;
        const adminId = parts[1]!;
        const memberId = parts[2]!;
        try {
          sessionStorage.setItem(
            MESSAGES_PENDING_THREAD_KEY,
            JSON.stringify({ teamId, adminId, memberId }),
          );
        } catch {
          /* ignore quota */
        }
      }
    }
    navigate('/app/messages');
  }
}

export const NotificationsPage: React.FC = () => {
  const { navigate } = useRouter();
  const { user } = useSession();

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [markAllLoading, setMarkAllLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [respondLoading, setRespondLoading] = useState(false);

  // Fetch inbox + open SSE for real-time delivery
  useEffect(() => {
    if (!user) return;

    setLoading(true);
    notificationApi.getInbox()
      .then(setNotifications)
      .catch(() => {})
      .finally(() => setLoading(false));

    const es = notificationApi.openStream();
    es.onmessage = (e) => {
      try {
        const n = JSON.parse(e.data) as Notification;
        setNotifications((prev) =>
          prev.some((x) => x.id === n.id) ? prev : [n, ...prev],
        );
      } catch { /* ignore */ }
    };
    return () => es.close();
  }, [user]);

  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [invitePreview, setInvitePreview] = useState<TeamInvitePreview | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);

  const hasUnread = useMemo(() => notifications.some((n) => !n.read), [notifications]);
  const allIds = useMemo(() => notifications.map((n) => n.id), [notifications]);
  const allSelected = allIds.length > 0 && selectedIds.length === allIds.length;

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }, []);

  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelectedIds([]);
  }, []);

  const handleRowClick = useCallback(
    async (doc: Notification) => {
      if (selectMode) {
        toggleSelect(doc.id);
        return;
      }
      try {
        const data = (doc.data ?? {}) as Record<string, unknown>;
        if (data.type === 'team-invite') {
          await notificationApi.markOneRead(doc.id);
          setNotifications((prev) =>
            prev.map((n) => (n.id === doc.id ? { ...n, read: true } : n)),
          );
          const preview = await notificationApi.getInvitePreview(doc.id);
          setInvitePreview(preview);
          setInviteError(null);
          return;
        }
        await notificationApi.markOneRead(doc.id);
        setNotifications((prev) =>
          prev.map((n) => (n.id === doc.id ? { ...n, read: true } : n)),
        );
        resolveNotificationTarget(doc, navigate);
      } catch { /* ignore */ }
    },
    [selectMode, toggleSelect, navigate],
  );

  const handleMarkAllRead = useCallback(async () => {
    setMarkAllLoading(true);
    try {
      await notificationApi.markAllRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    } catch { /* ignore */ } finally {
      setMarkAllLoading(false);
    }
  }, []);

  const handleDeleteSelected = useCallback(async () => {
    if (selectedIds.length === 0) return;
    setDeleteLoading(true);
    try {
      await notificationApi.deleteMany(selectedIds);
      setNotifications((prev) => prev.filter((n) => !selectedIds.includes(n.id)));
      setSelectedIds([]);
    } catch { /* ignore */ } finally {
      setDeleteLoading(false);
    }
  }, [selectedIds]);

  useEffect(() => {
    if (selectMode && notifications.length === 0) exitSelectMode();
  }, [selectMode, notifications.length, exitSelectMode]);

  const closeInviteModal = useCallback(() => {
    setInvitePreview(null);
    setInviteError(null);
  }, []);

  const handleInviteAction = useCallback(async (action: 'join' | 'ignore') => {
    if (!invitePreview) return;
    setRespondLoading(true);
    try {
      await notificationApi.respondToInvite(invitePreview.notificationId, action);
      setNotifications((prev) => prev.filter((n) => n.id !== invitePreview.notificationId));
      closeInviteModal();
      if (action === 'join') navigate('/app/teams');
    } catch (e: any) {
      setInviteError(e?.message || 'Failed to process invite');
    } finally {
      setRespondLoading(false);
    }
  }, [invitePreview, closeInviteModal, navigate]);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-16">
        <Text variant="muted" size="sm">
          Loading notifications…
        </Text>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 pb-20 md:p-6 md:pb-6">
      <div className="flex items-center justify-between border-b border-neutral-200 pb-3 dark:border-neutral-800">
        {selectMode ? (
          <>
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="icon" onClick={exitSelectMode} aria-label="Exit selection mode">
                <FontAwesomeIcon icon={faXmark} className="h-4 w-4" />
              </Button>
              <Text size="sm" weight="medium">
                {selectedIds.length} selected
              </Text>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => (allSelected ? setSelectedIds([]) : setSelectedIds([...allIds]))}
              >
                {allSelected ? 'Deselect all' : 'Select all'}
              </Button>
              {selectedIds.length > 0 && (
                <Button
                  variant="danger"
                  size="sm"
                  onClick={handleDeleteSelected}
                  isLoading={deleteLoading}
                  aria-label="Delete selected notifications"
                >
                  <FontAwesomeIcon icon={faTrash} className="mr-1.5 h-3.5 w-3.5" />
                  Delete
                </Button>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              {hasUnread && (
                <Button variant="secondary" size="sm" onClick={handleMarkAllRead} isLoading={markAllLoading}>
                  <FontAwesomeIcon icon={faCheckDouble} className="mr-1.5 h-3.5 w-3.5" />
                  Mark all read
                </Button>
              )}
              <Button variant="secondary" size="sm" onClick={() => { setSelectMode(true); setSelectedIds([]); }}>
                Select
              </Button>
            </div>
            <div />
          </>
        )}
      </div>

      {notifications.length > 0 ? (
        <ul className="divide-y divide-neutral-100 dark:divide-neutral-800/80" role="list">
          {notifications.map((n) => {
            const selected = selectedIds.includes(n.id);
            return (
              <li key={n.id}>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => handleRowClick(n)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleRowClick(n);
                    }
                  }}
                  className={[
                    'flex items-center gap-3 py-3.5 pl-1 pr-1',
                    selectMode ? '' : 'cursor-pointer',
                  ].join(' ')}
                >
                  {selectMode && (
                    <button
                      type="button"
                      className={[
                        'flex h-7 w-7 shrink-0 items-center justify-center rounded-md border-2 shadow-sm transition-all',
                        selected
                          ? 'border-blue-500 bg-blue-500 text-white'
                          : 'border-neutral-400 bg-white dark:border-neutral-500 dark:bg-neutral-800',
                      ].join(' ')}
                      data-notification-id={n.id}
                      aria-label={selected ? 'Deselect' : 'Select'}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleSelect(n.id);
                      }}
                    >
                      {selected && <span className="text-xs font-bold">✓</span>}
                    </button>
                  )}
                  <div className="shrink-0 rounded-full bg-neutral-100 p-2 text-neutral-400 dark:bg-neutral-800 dark:text-neutral-500">
                    <FontAwesomeIcon icon={faCircleInfo} className="h-5 w-5" aria-hidden />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold leading-tight text-neutral-900 dark:text-neutral-50 md:text-base">
                      {n.title}
                    </p>
                    <p className="mt-0.5 text-sm text-neutral-500 dark:text-neutral-400">{n.body}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="whitespace-nowrap text-xs text-neutral-400 dark:text-neutral-500">
                      {timeAgo(n.createdAt)}
                    </span>
                    {!n.read && (
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full bg-blue-500"
                        aria-label="Unread"
                      />
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="py-16 text-center">
          <div className="mb-4 text-4xl" aria-hidden>
            🔔
          </div>
          <Text variant="muted">No notifications yet</Text>
          <Text variant="muted" size="sm" className="mt-1 block">
            Team invites and new messages will show up here.
          </Text>
        </div>
      )}

      <Modal open={!!invitePreview} onOpenChange={(open) => !open && closeInviteModal()} size="lg">
        <ModalHeader>
          <ModalTitle>Team Invite</ModalTitle>
          <ModalClose />
        </ModalHeader>
        <ModalBody>
          {invitePreview && (
            <div className="space-y-4">
              <div>
                <Text size="sm" variant="muted">Team name</Text>
                <Text size="lg" weight="semibold">{invitePreview.teamName}</Text>
              </div>
              <div>
                <Text size="sm" variant="muted">Team description</Text>
                <Text size="sm">
                  {invitePreview.teamDescription || 'No team description provided.'}
                </Text>
              </div>
              <div>
                <Text size="sm" variant="muted">Invited by</Text>
                <Text size="sm">
                  {invitePreview.inviter
                    ? `${invitePreview.inviter.name}${invitePreview.inviter.email ? ` (${invitePreview.inviter.email})` : ''}`
                    : 'Unknown'}
                </Text>
              </div>
              <div>
                <Text size="sm" variant="muted">Admins ({invitePreview.admins.length})</Text>
                <Text size="sm">
                  {invitePreview.admins.map((a) => a.name).join(', ') || 'None'}
                </Text>
              </div>
              <div>
                <Text size="sm" variant="muted">Team members ({invitePreview.members.length})</Text>
                <Text size="sm">
                  {invitePreview.members.map((m) => m.name).join(', ') || 'None'}
                </Text>
              </div>
              {inviteError && (
                <Text size="sm" variant="destructive">{inviteError}</Text>
              )}
            </div>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="outline" onClick={() => handleInviteAction('ignore')} isLoading={respondLoading}>
            Ignore
          </Button>
          <Button
            variant="primary"
            onClick={() => handleInviteAction('join')}
            isLoading={respondLoading}
            disabled={invitePreview?.alreadyMember}
          >
            {invitePreview?.alreadyMember ? 'Already in team' : 'Join'}
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
};
