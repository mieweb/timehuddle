/**
 * NotificationsPage — In-app notification inbox (parity with timeharbor-old /notifications).
 *
 * Lists notifications for the signed-in user, supports mark read, mark all read,
 * multi-select delete, and navigation when a notification has a deep link.
 */
import { faCheckDouble, faCircleInfo, faTrash, faXmark } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  Button,
  CheckIcon,
  ModalBody,
  ModalClose,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Text,
} from '@mieweb/ui';
import { AppModal } from '@ui/AppModal';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

import {
  notificationApi,
  type Notification,
  type TeamInvitePreview,
  type TeamJoinRequestPreview,
} from '../../lib/api';
import { subscribeNewNotifications } from '../../lib/ddp';
import { NOTIFICATION_READ_EVENT } from './notificationEvents';
import { NOTIFICATION_STRINGS } from './notificationCopy';
import { formatReadTime, formatReceivedTime, groupByDay, useToday } from './notificationTimes';
import { useSession } from '../../lib/useSession';
import { useRouter } from '../../ui/router';
import { AppPage } from '../../ui/AppPage';
import { EmptyState } from '../../ui/EmptyState';
import { useRefresh } from '../../lib/RefreshContext';
import { useShiftReminder } from './ShiftReminderContext';

/** Marks a row read with the server's read time; a row already read keeps its own. */
function withRead(n: Notification, readAt: string | null): Notification {
  return n.read ? n : { ...n, read: true, readAt };
}

/** Map legacy Time Harbor paths to TimeHuddle /app routes */
function normalizeAppPath(path: string): string {
  if (!path.startsWith('/')) return '/app/dashboard';
  if (path.startsWith('/app/')) return path;
  const direct: Record<string, string> = {
    '/teams': '/app/teams',
    '/tickets': '/app/tickets',
    '/notifications': '/app/notifications',
  };
  if (direct[path]) return direct[path];
  if (path.startsWith('/member/')) return '/app/clock';
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
    console.log('[resolveNotificationTarget] Navigating to:', u);
    if (u.startsWith('http://') || u.startsWith('https://')) {
      window.location.href = u;
      return;
    }
    const normalized = normalizeAppPath(u);
    console.log('[resolveNotificationTarget] Normalized URL:', normalized);
    navigate(normalized);
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
  console.log('[resolveNotificationTarget] No URL found, staying on current page');
}

export const NotificationsPage: React.FC = () => {
  const { navigate } = useRouter();
  const { user } = useSession();

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [markAllLoading, setMarkAllLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [respondLoading, setRespondLoading] = useState(false);
  const { openModal: openShiftReminderModal } = useShiftReminder();

  // Fetch inbox + subscribe to live updates (Meteor DDP, oplog-backed)
  useEffect(() => {
    if (!user) return;

    setLoading(true);
    notificationApi
      .getInbox()
      .then(setNotifications)
      .catch(() => {})
      .finally(() => setLoading(false));

    return subscribeNewNotifications((n) => {
      setNotifications((prev) => (prev.some((x) => x.id === n.id) ? prev : [n, ...prev]));
    });
  }, [user]);

  // A push tapped elsewhere in the app marks its row read (AppLayout's markPushRead).
  useEffect(() => {
    const handler = (e: Event) => {
      const { id, readAt } = (e as CustomEvent<{ id: string; readAt: string | null }>).detail;
      setNotifications((prev) => prev.map((n) => (n.id === id ? withRead(n, readAt) : n)));
    };
    window.addEventListener(NOTIFICATION_READ_EVENT, handler);
    return () => window.removeEventListener(NOTIFICATION_READ_EVENT, handler);
  }, []);

  // Remove notifications handled by the global ShiftReminderModal
  useEffect(() => {
    const handler = (e: Event) => {
      const { id } = (e as CustomEvent<{ id: string }>).detail;
      setNotifications((prev) => prev.filter((n) => n.id !== id));
    };
    window.addEventListener('timehuddle:shiftReminderHandled', handler);
    return () => window.removeEventListener('timehuddle:shiftReminderHandled', handler);
  }, []);

  useRefresh(
    React.useCallback(async () => {
      if (!user) return;
      await notificationApi
        .getInbox()
        .then(setNotifications)
        .catch(() => {});
    }, [user]),
  );

  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [invitePreview, setInvitePreview] = useState<TeamInvitePreview | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [joinRequestPreview, setJoinRequestPreview] = useState<TeamJoinRequestPreview | null>(null);
  const [joinRequestError, setJoinRequestError] = useState<string | null>(null);

  const hasUnread = useMemo(() => notifications.some((n) => !n.read), [notifications]);
  const today = useToday();
  const days = useMemo(() => groupByDay(notifications, today), [notifications, today]);
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
        console.log('[NotificationsPage] Notification clicked:', data);
        const { readAt } = await notificationApi.markOneRead(doc.id);
        setNotifications((prev) => prev.map((n) => (n.id === doc.id ? withRead(n, readAt) : n)));
        if (data.type === 'team-invite') {
          const preview = await notificationApi.getInvitePreview(doc.id);
          setInvitePreview(preview);
          setInviteError(null);
          return;
        }
        if (data.type === 'team-join-request') {
          const preview = await notificationApi.getJoinRequestPreview(doc.id);
          setJoinRequestPreview(preview);
          setJoinRequestError(null);
          return;
        }
        if (data.type === 'shift-end-reminder') {
          openShiftReminderModal(doc);
          return;
        }
        resolveNotificationTarget(doc, navigate);
      } catch (err) {
        console.error('[NotificationsPage] Error handling notification click:', err);
      }
    },
    [selectMode, toggleSelect, navigate, openShiftReminderModal],
  );

  const handleMarkAllRead = useCallback(async () => {
    setMarkAllLoading(true);
    try {
      const shown = new Set(allIds);
      const { readAt } = await notificationApi.markAllRead();
      // Take each row's stored read time (some were read elsewhere first) rather than
      // replacing the list, which would drop a row that arrived during the request.
      // Rows shown at the click but past the inbox's newest 200 were stamped with
      // this call's `readAt`; a row that arrived since is left as it is.
      const fresh = new Map((await notificationApi.getInbox()).map((n) => [n.id, n]));
      setNotifications((prev) =>
        prev.map((n) => fresh.get(n.id) ?? (shown.has(n.id) ? withRead(n, readAt) : n)),
      );
    } catch {
      /* ignore */
    } finally {
      setMarkAllLoading(false);
    }
  }, [allIds]);

  const handleDeleteSelected = useCallback(async () => {
    if (selectedIds.length === 0) return;
    setDeleteLoading(true);
    try {
      await notificationApi.deleteMany(selectedIds);
      setNotifications((prev) => prev.filter((n) => !selectedIds.includes(n.id)));
      setSelectedIds([]);
    } catch {
      /* ignore */
    } finally {
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

  const closeJoinRequestModal = useCallback(() => {
    setJoinRequestPreview(null);
    setJoinRequestError(null);
  }, []);

  const handleInviteAction = useCallback(
    async (action: 'join' | 'ignore') => {
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
    },
    [invitePreview, closeInviteModal, navigate],
  );

  const handleJoinRequestAction = useCallback(
    async (action: 'approve' | 'decline') => {
      if (!joinRequestPreview) return;
      setRespondLoading(true);
      try {
        await notificationApi.respondToJoinRequest(joinRequestPreview.notificationId, action);
        setNotifications((prev) => prev.filter((n) => n.id !== joinRequestPreview.notificationId));
        closeJoinRequestModal();
        if (action === 'approve') navigate('/app/teams?tab=pending');
      } catch (e: any) {
        setJoinRequestError(e?.message || 'Failed to process join request');
      } finally {
        setRespondLoading(false);
      }
    },
    [joinRequestPreview, closeJoinRequestModal, navigate],
  );

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
    <AppPage>
      <div className="flex items-center justify-between border-b border-neutral-200 pb-3 dark:border-neutral-800">
        {selectMode ? (
          <>
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                onClick={exitSelectMode}
                aria-label="Exit selection mode"
              >
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
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleMarkAllRead}
                  isLoading={markAllLoading}
                >
                  <FontAwesomeIcon icon={faCheckDouble} className="mr-1.5 h-3.5 w-3.5" />
                  Mark all read
                </Button>
              )}
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setSelectMode(true);
                  setSelectedIds([]);
                }}
              >
                Select
              </Button>
            </div>
            <div />
          </>
        )}
      </div>

      {notifications.length > 0 ? (
        <div className="notification-days">
          {days.map((day) => (
            <section key={day.key} aria-labelledby={`notification-day-${day.key}`}>
              <h2
                id={`notification-day-${day.key}`}
                className="px-1 pb-1 pt-4 text-xs font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500"
              >
                {day.heading}
              </h2>
              <ul className="divide-y divide-neutral-100 dark:divide-neutral-800/80" role="list">
                {day.items.map((n) => {
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
                          <p className="mt-0.5 text-sm text-neutral-500 dark:text-neutral-400">
                            {n.body}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <div className="notification-times flex flex-col items-end gap-0.5 whitespace-nowrap text-xs">
                            <time
                              dateTime={n.createdAt}
                              className="text-neutral-400 dark:text-neutral-500"
                            >
                              {formatReceivedTime(n.createdAt)}
                            </time>
                            {n.read &&
                              (n.readAt ? (
                                <span className="inline-flex items-center gap-1 text-green-700 dark:text-green-400">
                                  <CheckIcon className="h-3 w-3" aria-hidden="true" />
                                  {NOTIFICATION_STRINGS.read}{' '}
                                  <time dateTime={n.readAt}>
                                    {formatReadTime(n.createdAt, n.readAt, today)}
                                  </time>
                                </span>
                              ) : (
                                <span className="text-neutral-400 dark:text-neutral-500">
                                  {NOTIFICATION_STRINGS.read}
                                </span>
                              ))}
                          </div>
                          {n.read ? (
                            // Keeps read and unread times lined up in one column.
                            <span className="w-2.5 shrink-0" aria-hidden="true" />
                          ) : (
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
            </section>
          ))}
        </div>
      ) : (
        <EmptyState
          icon="🔔"
          title="No notifications yet"
          description="Team invites and new messages will show up here."
        />
      )}

      <AppModal
        open={!!invitePreview}
        onOpenChange={(open) => !open && closeInviteModal()}
        size="lg"
      >
        <ModalHeader>
          <ModalTitle>Team Invite</ModalTitle>
          <ModalClose />
        </ModalHeader>
        <ModalBody>
          {invitePreview && (
            <div className="space-y-4">
              <div>
                <Text size="sm" variant="muted">
                  Team name
                </Text>
                <Text size="lg" weight="semibold">
                  {invitePreview.teamName}
                </Text>
              </div>
              <div>
                <Text size="sm" variant="muted">
                  Team description
                </Text>
                <Text size="sm">
                  {invitePreview.teamDescription || 'No team description provided.'}
                </Text>
              </div>
              <div>
                <Text size="sm" variant="muted">
                  Invited by
                </Text>
                <Text size="sm">
                  {invitePreview.inviter
                    ? `${invitePreview.inviter.name}${invitePreview.inviter.email ? ` (${invitePreview.inviter.email})` : ''}`
                    : 'Unknown'}
                </Text>
              </div>
              <div>
                <Text size="sm" variant="muted">
                  Admins ({invitePreview.admins.length})
                </Text>
                <Text size="sm">
                  {invitePreview.admins.map((a) => a.name).join(', ') || 'None'}
                </Text>
              </div>
              <div>
                <Text size="sm" variant="muted">
                  Team members ({invitePreview.members.length})
                </Text>
                <Text size="sm">
                  {invitePreview.members.map((m) => m.name).join(', ') || 'None'}
                </Text>
              </div>
              {inviteError && (
                <Text size="sm" variant="destructive">
                  {inviteError}
                </Text>
              )}
            </div>
          )}
        </ModalBody>
        <ModalFooter>
          <Button
            variant="outline"
            onClick={() => handleInviteAction('ignore')}
            isLoading={respondLoading}
          >
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
      </AppModal>

      <AppModal
        open={!!joinRequestPreview}
        onOpenChange={(open) => !open && closeJoinRequestModal()}
        size="lg"
      >
        <ModalHeader>
          <ModalTitle>Team Join Request</ModalTitle>
          <ModalClose />
        </ModalHeader>
        <ModalBody>
          {joinRequestPreview && (
            <div className="space-y-4">
              {joinRequestPreview.alreadyProcessed ? (
                <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 p-4">
                  <Text size="sm" variant="muted">
                    This request has already been processed.
                  </Text>
                </div>
              ) : (
                <>
                  <div>
                    <Text size="sm" variant="muted">
                      Team name
                    </Text>
                    <Text size="lg" weight="semibold">
                      {joinRequestPreview.teamName}
                    </Text>
                  </div>
                  <div>
                    <Text size="sm" variant="muted">
                      Team description
                    </Text>
                    <Text size="sm">
                      {joinRequestPreview.teamDescription || 'No team description provided.'}
                    </Text>
                  </div>
                  <div>
                    <Text size="sm" variant="muted">
                      Requested by
                    </Text>
                    <Text size="sm">
                      {joinRequestPreview.requester
                        ? `${joinRequestPreview.requester.name}${joinRequestPreview.requester.email ? ` (${joinRequestPreview.requester.email})` : ''}`
                        : 'Unknown'}
                    </Text>
                  </div>
                  {joinRequestError && (
                    <Text size="sm" variant="destructive">
                      {joinRequestError}
                    </Text>
                  )}
                </>
              )}
            </div>
          )}
        </ModalBody>
        <ModalFooter>
          {joinRequestPreview?.alreadyProcessed ? (
            <Button variant="outline" onClick={closeJoinRequestModal}>
              Close
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => handleJoinRequestAction('decline')}
                isLoading={respondLoading}
              >
                Decline
              </Button>
              <Button
                variant="primary"
                onClick={() => handleJoinRequestAction('approve')}
                isLoading={respondLoading}
              >
                Approve
              </Button>
            </>
          )}
        </ModalFooter>
      </AppModal>
    </AppPage>
  );
};
