/**
 * ProfileActivityFeed — Day-grouped, team-facing activity feed for a user's profile.
 *
 * • Fetches /v1/users/:userId/activity (requires shared team membership).
 * • Groups events by calendar day with readable labels.
 * • Surfaces blocker signals when there is enough signal.
 * • Designed to be shown only when viewing a teammate's profile (not self).
 */
import {
  faCircleExclamation,
  faClockRotateLeft,
  faListCheck,
  faRss,
  faStar,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Badge, Button, Card, Spinner, Text } from '@mieweb/ui';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { activityApi, type ActivityLogItem } from '../../lib/api';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function dayKey(iso: string): string {
  return iso.slice(0, 10); // YYYY-MM-DD
}

function formatDayLabel(key: string): string {
  const d = new Date(`${key}T12:00:00`);
  const today = dayKey(new Date().toISOString());
  const yesterday = dayKey(new Date(Date.now() - 86_400_000).toISOString());
  if (key === today) return 'Today';
  if (key === yesterday) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

interface EventMeta {
  icon: typeof faStar;
  iconClass: string;
  label: string;
}

function metaForItem(item: ActivityLogItem): EventMeta {
  if (item.type === 'ticket.updated') {
    const action = item.payload.action as string | undefined;
    switch (action) {
      case 'assigned':
        return { icon: faListCheck, iconClass: 'text-sky-500', label: 'Assigned ticket' };
      case 'unassigned':
        return { icon: faListCheck, iconClass: 'text-slate-400', label: 'Unassigned ticket' };
      case 'deleted':
        return { icon: faListCheck, iconClass: 'text-red-400', label: 'Deleted ticket' };
      case 'status-changed':
      case 'batch-status-changed':
        return { icon: faListCheck, iconClass: 'text-amber-500', label: 'Updated ticket status' };
      case 'priority-changed':
        return { icon: faListCheck, iconClass: 'text-orange-500', label: 'Changed priority' };
      default:
        return { icon: faListCheck, iconClass: 'text-blue-500', label: 'Updated ticket' };
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

function summaryForItem(item: ActivityLogItem): string {
  const p = item.payload;
  switch (item.type) {
    case 'clock.in': {
      const name = (p.teamName as string | undefined) ?? '';
      return name ? `into ${name}` : '';
    }
    case 'clock.out': {
      const name = (p.teamName as string | undefined) ?? '';
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
      const assigneeName = (p.assigneeName as string | undefined) ?? '';
      const detail =
        action === 'assigned'
          ? assigneeName ? `to ${assigneeName}` : ''
          : action === 'status-changed' || action === 'batch-status-changed'
            ? status ? `→ ${status}` : ''
            : action === 'priority-changed'
              ? priority ? `→ ${priority}` : ''
              : '';
      return [title, detail].filter(Boolean).join(' ');
    }
    default:
      return '';
  }
}

/** Returns true when the event suggests something is blocked. */
function isBlockerSignal(item: ActivityLogItem): boolean {
  const status = (item.payload.status as string | undefined) ?? '';
  const title = (item.payload.ticketTitle as string | undefined) ?? '';
  return (
    status.toLowerCase().includes('block') ||
    title.toLowerCase().includes('block') ||
    title.toLowerCase().includes('blocker')
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

const EventRow: React.FC<{ item: ActivityLogItem }> = ({ item }) => {
  const { icon, iconClass, label } = metaForItem(item);
  const summary = summaryForItem(item);
  const blocker = isBlockerSignal(item);

  return (
    <li className="group flex items-start gap-3">
      {/* Timeline dot */}
      <div
        className="relative z-10 mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white ring-2 ring-neutral-200 dark:bg-neutral-900 dark:ring-neutral-700"
        aria-hidden
      >
        <FontAwesomeIcon icon={icon} className={`h-2.5 w-2.5 ${iconClass}`} />
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1 pb-4">
        <p className="text-sm text-neutral-900 dark:text-neutral-100">
          <span className="font-medium">{label}</span>
          {summary && (
            <span className="ml-1 text-neutral-500 dark:text-neutral-400">{summary}</span>
          )}
          {blocker && (
            <Badge variant="danger" size="sm" className="ml-2 align-middle">
              <FontAwesomeIcon icon={faCircleExclamation} className="mr-1 text-xs" />
              Blocker
            </Badge>
          )}
        </p>
        <time
          dateTime={item.occurredAt}
          className="mt-0.5 block text-xs text-neutral-400 dark:text-neutral-500"
        >
          {timeLabel(item.occurredAt)}
        </time>
      </div>
    </li>
  );
};

interface DayGroup {
  key: string;
  label: string;
  items: ActivityLogItem[];
}

// ─── ProfileActivityFeed ──────────────────────────────────────────────────────

interface ProfileActivityFeedProps {
  userId: string;
}

export const ProfileActivityFeed: React.FC<ProfileActivityFeedProps> = ({ userId }) => {
  const [items, setItems] = useState<ActivityLogItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    activityApi
      .getUserActivity(userId, { limit: 20 })
      .then(({ events, nextCursor: cursor }) => {
        setItems(events);
        setNextCursor(cursor);
      })
      .catch(() => setError('Activity unavailable.'))
      .finally(() => setLoading(false));
  }, [userId]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const { events, nextCursor: cursor } = await activityApi.getUserActivity(userId, {
        limit: 20,
        before: nextCursor,
      });
      setItems((prev) => [...prev, ...events]);
      setNextCursor(cursor);
    } finally {
      setLoadingMore(false);
    }
  }, [userId, nextCursor, loadingMore]);

  // Group items by calendar day, ordered newest → oldest
  const dayGroups = useMemo<DayGroup[]>(() => {
    const map = new Map<string, ActivityLogItem[]>();
    for (const item of items) {
      const key = dayKey(item.occurredAt);
      const arr = map.get(key) ?? [];
      arr.push(item);
      map.set(key, arr);
    }
    return Array.from(map.entries()).map(([key, dayItems]) => ({
      key,
      label: formatDayLabel(key),
      items: dayItems,
    }));
  }, [items]);

  // Surface blocker signals (only when ≥ 2 in recent history for enough signal)
  const blockerItems = useMemo(
    () => items.filter(isBlockerSignal).slice(0, 3),
    [items],
  );
  const showBlockers = blockerItems.length >= 2;

  return (
    <Card padding="lg">
      {/* Section heading */}
      <div className="mb-5 flex items-center gap-2 border-b border-neutral-200 pb-3 dark:border-neutral-700">
        <FontAwesomeIcon icon={faRss} className="text-neutral-400" aria-hidden="true" />
        <Text
          size="sm"
          weight="semibold"
          className="uppercase tracking-widest text-neutral-500 dark:text-neutral-400"
        >
          Recent Activity
        </Text>
      </div>

      {/* Blocker signal — only surfaced when there is enough signal */}
      {showBlockers && (
        <div className="mb-5 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 dark:border-red-900/40 dark:bg-red-950/30">
          <FontAwesomeIcon
            icon={faCircleExclamation}
            className="mt-0.5 shrink-0 text-red-500"
            aria-hidden="true"
          />
          <div className="min-w-0">
            <Text size="sm" weight="semibold" className="text-red-700 dark:text-red-400">
              Recurring blockers detected
            </Text>
            <Text size="xs" variant="muted" className="mt-0.5">
              {blockerItems.map((b) => (b.payload.ticketTitle as string) ?? b.type).join(' · ')}
            </Text>
          </div>
        </div>
      )}

      {/* Feed body */}
      {loading ? (
        <div className="flex justify-center py-10" aria-label="Loading activity">
          <Spinner size="md" />
        </div>
      ) : error ? (
        <Text variant="muted" size="sm" className="py-6 text-center">
          {error}
        </Text>
      ) : dayGroups.length === 0 ? (
        <Text variant="muted" size="sm" className="py-6 text-center">
          No recent activity to show.
        </Text>
      ) : (
        <div className="space-y-6">
          {dayGroups.map((group) => (
            <section key={group.key} aria-label={group.label}>
              {/* Day label */}
              <Text
                size="xs"
                weight="semibold"
                className="mb-3 block uppercase tracking-widest text-neutral-400 dark:text-neutral-500"
              >
                {group.label}
              </Text>

              {/* Timeline */}
              <div className="relative pl-3">
                {/* Vertical line */}
                <div
                  className="absolute bottom-0 left-3 top-1 w-px bg-neutral-200 dark:bg-neutral-700"
                  aria-hidden
                />
                <ul className="space-y-0" aria-label={`Events on ${group.label}`} role="list">
                  {group.items.map((item) => (
                    <EventRow key={item.id} item={item} />
                  ))}
                </ul>
              </div>
            </section>
          ))}

          {nextCursor && (
            <div className="flex justify-center pt-2">
              <Button variant="secondary" size="sm" onClick={loadMore} isLoading={loadingMore}>
                Load more
              </Button>
            </div>
          )}
        </div>
      )}
    </Card>
  );
};
