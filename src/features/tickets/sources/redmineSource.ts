/**
 * A connected Redmine instance as a unified source.
 *
 * Read-only: Redmine issue data is never written from TimeHuddle, so every
 * mutating capability is false. `trackTime` stays false until the source-aware
 * `timers.createEntry` exists (M3) — the row must not offer a timer it cannot
 * start.
 */
import { redmineApi, type RedmineIssue, type RedmineScope } from '../../../lib/api';

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

const CAPABILITIES: SourceCapabilities = {
  edit: false,
  delete: false,
  assign: false,
  changeStatus: false,
  trackTime: false,
  openExternal: true,
};

/** An issue paired with the base URL needed to build its external link. */
export interface RedmineRaw {
  issue: RedmineIssue;
  baseUrl: string | null;
}

/**
 * Session-lived cache of the last fetched list, keyed by user *and* scope.
 * Module-level so it survives remounts without a refetch. Sign-out does not
 * reload the page, so the user id must be part of the key or a second user
 * could be served the first user's issues. Only connected responses are cached,
 * so linking an account in Settings and coming back refetches instead of
 * replaying a stale "not connected" state.
 */
const listCache = new Map<string, RedmineRaw[]>();

const cacheKey = (userId: string, scope: RedmineScope) => `${userId}:${scope}`;

/** Drop cached issues so the next fetch goes to Redmine. */
export function invalidateRedmineCache(): void {
  listCache.clear();
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

    const key = cacheKey(userId, ctx.redmineScope);
    const cached = listCache.get(key);
    if (cached) return cached;

    const result = await redmineApi.issues.list(ctx.redmineScope);
    if (!result.connected) return [];

    const raws = result.issues.map((issue) => ({ issue, baseUrl: result.baseUrl }));
    listCache.set(key, raws);
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
