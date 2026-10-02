/**
 * A connected Redmine instance as a unified source.
 *
 * Issues are edited and created under the user's own personal key, so Redmine,
 * not TimeHuddle, decides whether a given user may make a given change, and a
 * refusal is shown rather than pre-empted here.
 *
 * The rows come from `redmine.issues.relevant` rather than "every issue the
 * key can see": on a large instance that response is enormous and every
 * subject in it may carry PHI. The table shows the issues **assigned to the
 * user** (their groups included, as Redmine's `assigned_to_id=me` counts them)
 * and the issues they **pinned**. Starting a timer from a search suggestion
 * pins the issue, which is how an issue someone else owns joins the table —
 * and so My Board, which only shows rows the table has. An issue on My Board
 * is a table row too (`board`), so a board entry never outlives its row
 * because the issue was closed or reassigned. The rest of the relevant list
 * (recently logged, recent activity, watched) belongs to the search bar's
 * suggestions.
 */
import { useSyncExternalStore } from 'react';

import { redmineApi, type RedmineIssue, type RedmineRelevanceReason } from '../../../lib/api';

import { ticketKey, type SourceCapabilities, type TicketSource, type UnifiedTicket } from './types';

/**
 * Redmine's default priority vocabulary, ranked for cross-source sorting.
 * Instances can rename or add priorities, so an unrecognized name ranks 0
 * rather than being dropped.
 */
const PRIORITY_RANK: Record<string, number> = {
  low: 1,
  normal: 2,
  high: 3,
  urgent: 4,
  immediate: 5,
};

/** The relevance reasons that put an issue in the Tickets table. */
const TABLE_REASONS: readonly RedmineRelevanceReason[] = ['assigned', 'pinned', 'board'];

const CAPABILITIES: SourceCapabilities = {
  edit: true,
  delete: false,
  changeStatus: true,
  openExternal: true,
};

/** An issue paired with the base URL needed to build its external link. */
export interface RedmineRaw {
  issue: RedmineIssue;
  baseUrl: string | null;
}

/**
 * Session-lived cache of the last fetched list, keyed by user.
 * Module-level so it survives remounts without a refetch. Sign-out does not
 * reload the page, so the user id must be part of the key or a second user
 * could be served the first user's issues. Only connected responses are cached,
 * so linking an account in Settings and coming back refetches instead of
 * replaying a stale "not connected" state.
 */
const listCache = new Map<string, { raws: RedmineRaw[]; unavailableBoardIds: number[] }>();

/** Told whenever the cache changes, for `useUnavailableRedmineBoardIds`. */
const cacheListeners = new Set<() => void>();
const notifyCacheChanged = () => cacheListeners.forEach((listener) => listener());

/** Drop cached issues so the next fetch goes to Redmine. */
export function invalidateRedmineCache(): void {
  listCache.clear();
  notifyCacheChanged();
}

const NO_IDS: number[] = [];

/**
 * My Board issues Redmine confirmed it no longer returns (deleted, or out of the
 * user's sight), from the last fetch — so the Tickets page can offer to drop
 * those board entries, and only those, never an entry that merely failed to
 * load. Re-renders whenever a fetch lands.
 */
export function useUnavailableRedmineBoardIds(userId: string | null): number[] {
  return useSyncExternalStore(
    (listener) => {
      cacheListeners.add(listener);
      return () => cacheListeners.delete(listener);
    },
    () => (userId && listCache.get(userId)?.unavailableBoardIds) || NO_IDS,
  );
}

export const redmineSource: TicketSource<RedmineRaw> = {
  id: 'redmine',
  label: 'Redmine',
  capabilities: CAPABILITIES,

  // Whether an account is actually linked is only known after a fetch, which
  // returns an empty list when it is not. That keeps "not connected" a silent
  // omission rather than an error the user cannot act on from this page.
  isAvailable: (ctx) => Boolean(ctx.userId),

  fetch: async (ctx) => {
    const userId = ctx.userId;
    if (!userId) return [];

    const cached = listCache.get(userId);
    if (cached) return cached.raws;

    // `includeDismissed: true` — a dismissal is about the search dropdown only.
    const result = await redmineApi.issues.relevant(true);
    if (!result.connected) return [];

    const raws = result.issues
      .filter((issue) => issue.reasons.some((reason) => TABLE_REASONS.includes(reason)))
      .map((issue) => ({ issue, baseUrl: result.baseUrl }));
    listCache.set(userId, { raws, unavailableBoardIds: result.unavailableBoardIds ?? NO_IDS });
    notifyCacheChanged();
    return raws;
  },

  toUnified: ({ issue, baseUrl }): UnifiedTicket => ({
    key: ticketKey('redmine', issue.id),
    sourceId: 'redmine',
    id: String(issue.id),
    ref: `#${issue.id}`,
    title: issue.subject,
    container: issue.project ? { id: String(issue.project.id), name: issue.project.name } : null,
    status: {
      native: issue.status?.name ?? 'Unknown',
      isClosed: issue.status?.isClosed ?? false,
    },
    priority: issue.priority
      ? {
          native: issue.priority.name,
          rank: PRIORITY_RANK[issue.priority.name.toLowerCase()] ?? 0,
        }
      : null,
    assignees: issue.assignedTo
      ? [{ id: String(issue.assignedTo.id), name: issue.assignedTo.name }]
      : [],
    // Redmine returns an author, but the list DTO does not carry it yet.
    createdBy: null,
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
    externalUrl: baseUrl ? `${baseUrl}/issues/${issue.id}` : null,
    externalRef: null,
    sharedWithTimeharbor: false,
    capabilities: CAPABILITIES,
  }),
};
