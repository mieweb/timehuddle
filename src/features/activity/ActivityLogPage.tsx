/**
 * ActivityLogPage — Unified event log showing the signed-in user's activity.
 *
 * Displays a cursor-paginated list of activity events (clock-in/out,
 * ticket actions, etc.) ordered newest first. New event types are handled
 * automatically via the generic fallback renderer.
 */
import { faClockRotateLeft, faListCheck, faStar } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Button, Text } from '@mieweb/ui';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { activityApi, type ActivityLogItem } from '../../lib/api';
import { timeAgo } from '../../lib/date';
import { useTeam } from '../../lib/TeamContext';
import { useSession } from '../../lib/useSession';
import { useRefresh } from '../../lib/RefreshContext';
import { useScopeChange } from '../../lib/useScopeChange';
import { AppPage } from '../../ui/AppPage';
import { EmptyState } from '../../ui/EmptyState';
import { LoadingRegion, SkeletonRows } from '../../ui/PageSkeleton';
import { linkActivityLabel } from '../tickets/link/ticketLinkStrings';

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface ActivityMeta {
  icon: typeof faStar;
  iconClass: string;
  label: string;
}

function metaForItem(item: ActivityLogItem): ActivityMeta {
  if (item.type === 'ticket.updated') {
    const action = item.payload.action as string | undefined;
    switch (action) {
      case 'assigned':
        return { icon: faListCheck, iconClass: 'text-sky-500', label: 'Assigned ticket' };
      case 'unassigned':
        return { icon: faListCheck, iconClass: 'text-slate-500', label: 'Unassigned ticket' };
      case 'deleted':
        return { icon: faListCheck, iconClass: 'text-red-400', label: 'Deleted ticket' };
      case 'status-changed':
      case 'batch-status-changed':
        return { icon: faListCheck, iconClass: 'text-amber-500', label: 'Changed ticket status' };
      case 'priority-changed':
        return {
          icon: faListCheck,
          iconClass: 'text-orange-500',
          label: 'Changed ticket priority',
        };
      default:
        return {
          icon: faListCheck,
          iconClass: 'text-blue-500',
          label: linkActivityLabel(action) ?? 'Updated ticket',
        };
    }
  }

  switch (item.type) {
    case 'clock.in':
      return { icon: faClockRotateLeft, iconClass: 'text-green-500', label: 'Clocked in' };
    case 'clock.out':
      return { icon: faClockRotateLeft, iconClass: 'text-red-400', label: 'Clocked out' };
    case 'ticket.created':
      return { icon: faListCheck, iconClass: 'text-blue-500', label: 'Created ticket' };
    default:
      return { icon: faStar, iconClass: 'text-neutral-400', label: item.type };
  }
}

function activitySummary(item: ActivityLogItem): string {
  const p = item.payload;
  switch (item.type) {
    case 'clock.in': {
      const name = (p.teamName as string | undefined) ?? (p.teamId as string | undefined) ?? '';
      return name ? `into ${name}` : '';
    }
    case 'clock.out': {
      const name = (p.teamName as string | undefined) ?? (p.teamId as string | undefined) ?? '';
      const secs = typeof p.durationSeconds === 'number' ? p.durationSeconds : null;
      const dur =
        secs != null
          ? (() => {
              const h = Math.floor(secs / 3600);
              const m = Math.floor((secs % 3600) / 60);
              return h > 0 ? `${h}h ${m}m` : `${m}m`;
            })()
          : null;
      return [name && `from ${name}`, dur && `(${dur})`].filter(Boolean).join(' ');
    }
    case 'ticket.created':
      return (p.ticketTitle as string | undefined) ?? '';
    case 'ticket.updated': {
      const title = (p.ticketTitle as string | undefined) ?? '';
      const action = p.action as string | undefined;
      const status = p.status as string | undefined;
      const priority = p.priority as string | undefined;
      const assigneeName =
        (p.assigneeName as string | undefined) ?? (p.assigneeId as string | undefined);
      const details =
        action === 'assigned'
          ? assigneeName
            ? `to ${assigneeName}`
            : ''
          : action === 'status-changed' || action === 'batch-status-changed'
            ? status
              ? `to ${status}`
              : ''
            : action === 'priority-changed'
              ? priority
                ? `to ${priority}`
                : ''
              : action === 'status-priority-changed'
                ? [status && `to ${status}`, priority && `priority ${priority}`]
                    .filter(Boolean)
                    .join(' · ')
                : '';
      return [title, details].filter(Boolean).join(' ');
    }
    default:
      return '';
  }
}

// ─── ActivityRow ──────────────────────────────────────────────────────────────

const ActivityRow: React.FC<{ item: ActivityLogItem }> = ({ item }) => {
  const { icon, iconClass, label } = metaForItem(item);
  const summary = activitySummary(item);

  return (
    <li className="flex items-start gap-3 py-3">
      <div
        className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800"
        aria-hidden
      >
        <FontAwesomeIcon icon={icon} className={`h-3.5 w-3.5 ${iconClass}`} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
          {label}
          {summary && (
            <span className="ml-1 font-normal text-neutral-500 dark:text-neutral-400">
              {summary}
            </span>
          )}
        </p>
        <p className="mt-0.5 text-xs text-neutral-400 dark:text-neutral-500">{item.actor.name}</p>
      </div>
      <time
        dateTime={item.occurredAt}
        className="shrink-0 text-xs text-neutral-400 dark:text-neutral-500"
      >
        {timeAgo(item.occurredAt)}
      </time>
    </li>
  );
};

// ─── ActivityLogPage ───────────────────────────────────────────────────────────

export const ActivityLogPage: React.FC = () => {
  const { user } = useSession();
  const { selectedTeamId } = useTeam();

  const [items, setItems] = useState<ActivityLogItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Kept mounted, so this re-runs on every return. A new user loads from
  // scratch; a return keeps what is loaded (Load more pages included) and adds
  // the events since on top. When none of the latest page is already shown,
  // there may be a gap, so the page replaces the list instead.
  const isNewUser = useScopeChange();
  const itemsRef = React.useRef(items);
  itemsRef.current = items;
  useEffect(() => {
    if (!user) return;
    const newUser = isNewUser(user.id);
    if (newUser) {
      setItems([]);
      setNextCursor(null);
      setLoading(true);
      setError(null);
    }
    activityApi
      .getLog({ limit: 50 })
      .then(({ events, nextCursor: cursor }) => {
        const shown = new Set(itemsRef.current.map((item) => item.id));
        const unseen = events.filter((event) => !shown.has(event.id));
        if (newUser || unseen.length === events.length) {
          setItems(events);
          setNextCursor(cursor);
        } else if (unseen.length > 0) {
          setItems((prev) => [...unseen, ...prev]);
        }
      })
      .catch(() => {
        // A failed quiet reload leaves the log already on screen in place.
        if (newUser) setError('Failed to load activity log.');
      })
      .finally(() => setLoading(false));
  }, [user, isNewUser]);

  useRefresh(
    React.useCallback(async () => {
      if (!user) return;
      setLoading(true);
      try {
        const { events, nextCursor: cursor } = await activityApi.getLog({ limit: 50 });
        setItems(events);
        setNextCursor(cursor);
      } catch {
        setError('Failed to load activity log.');
      } finally {
        setLoading(false);
      }
    }, [user]),
  );

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const { events, nextCursor: cursor } = await activityApi.getLog({
        limit: 50,
        before: nextCursor,
      });
      setItems((prev) => [...prev, ...events]);
      setNextCursor(cursor);
    } catch {
      // silently ignore — user can retry by clicking again
    } finally {
      setLoadingMore(false);
    }
  }, [nextCursor, loadingMore]);

  const filteredItems = useMemo(
    () =>
      selectedTeamId
        ? items.filter((item) => !item.teamId || item.teamId === selectedTeamId)
        : items,
    [items, selectedTeamId],
  );

  return (
    <AppPage subtitle="A chronological log of your activity in TimeHuddle.">
      {loading ? (
        <LoadingRegion label="Loading activity log…">
          <SkeletonRows count={6} />
        </LoadingRegion>
      ) : error ? (
        <div className="py-16 text-center">
          <Text variant="destructive" size="sm">
            {error}
          </Text>
        </div>
      ) : filteredItems.length === 0 ? (
        <EmptyState
          icon="📋"
          title="No activity yet"
          description="Events like clocking in and creating tickets will appear here."
        />
      ) : (
        <>
          <ul
            className="divide-y divide-neutral-100 dark:divide-neutral-800/80"
            aria-label="Activity log"
            role="list"
          >
            {filteredItems.map((item) => (
              <ActivityRow key={item.id} item={item} />
            ))}
          </ul>

          {nextCursor && (
            <div className="flex justify-center pt-4">
              <Button variant="secondary" size="sm" onClick={loadMore} isLoading={loadingMore}>
                Load more
              </Button>
            </div>
          )}
        </>
      )}
    </AppPage>
  );
};
