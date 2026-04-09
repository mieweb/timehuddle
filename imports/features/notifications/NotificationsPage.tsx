/**
 * NotificationsPage — In-app notification inbox (parity with timeharbor-old /notifications).
 *
 * Lists notifications for the signed-in user, supports mark read, mark all read,
 * multi-select delete, and navigation when a notification has a deep link.
 */
import { faCheckDouble, faCircleInfo, faTrash, faXmark } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Button, Text } from '@mieweb/ui';
import { useFind, useSubscribe } from 'meteor/react-meteor-data';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { MESSAGES_PENDING_THREAD_KEY } from '../../lib/constants';
import { useMethod } from '../../lib/useMethod';
import { useRouter } from '../../ui/router';
import { Notifications } from '../teams/api';
import type { NotificationDoc } from '../teams/schema';

function idStr(id: unknown): string {
  if (id == null) return '';
  if (typeof id === 'string') return id;
  const o = id as { _str?: string; toHexString?: () => string };
  return o._str ?? o.toHexString?.() ?? String(id);
}

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
  doc: NotificationDoc | undefined,
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
  const loading = useSubscribe('notifications.inbox');
  const notifications = useFind(
    () => Notifications.find({}, { sort: { createdAt: -1 } }),
    [],
  );

  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const markAsRead = useMethod<[unknown], void>('notifications.markAsRead');
  const markAllAsRead = useMethod<[], void>('notifications.markAllAsRead');
  const deleteNotifications = useMethod<[string[]], { deletedCount: number }>('notifications.delete');

  const hasUnread = useMemo(() => notifications.some((n) => !n.read), [notifications]);
  const allIds = useMemo(() => notifications.map((n) => idStr(n._id)), [notifications]);
  const allSelected = allIds.length > 0 && selectedIds.length === allIds.length;

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }, []);

  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelectedIds([]);
  }, []);

  const handleRowClick = useCallback(
    async (doc: NotificationDoc) => {
      const nid = idStr(doc._id);
      if (selectMode) {
        toggleSelect(nid);
        return;
      }
      try {
        await markAsRead.call(doc._id ?? nid);
        resolveNotificationTarget(doc, navigate);
      } catch {
        /* useMethod surfaces error */
      }
    },
    [selectMode, toggleSelect, markAsRead, navigate],
  );

  const handleMarkAllRead = useCallback(() => {
    markAllAsRead.call().catch(() => {});
  }, [markAllAsRead]);

  const handleDeleteSelected = useCallback(() => {
    if (selectedIds.length === 0) return;
    deleteNotifications
      .call(selectedIds)
      .then(() => {
        setSelectedIds([]);
      })
      .catch(() => {});
  }, [selectedIds, deleteNotifications]);

  useEffect(() => {
    if (selectMode && notifications.length === 0) exitSelectMode();
  }, [selectMode, notifications.length, exitSelectMode]);

  if (loading()) {
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
                  isLoading={deleteNotifications.loading}
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
                <Button variant="secondary" size="sm" onClick={handleMarkAllRead} isLoading={markAllAsRead.loading}>
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
            const nid = idStr(n._id);
            const selected = selectedIds.includes(nid);
            return (
              <li key={nid}>
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
                      data-notification-id={nid}
                      aria-label={selected ? 'Deselect' : 'Select'}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleSelect(nid);
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
    </div>
  );
};
