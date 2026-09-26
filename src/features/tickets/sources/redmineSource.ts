/**
 * A connected Redmine instance as a unified source.
 *
 * Since M6 a Redmine issue can be edited (status, priority, assignee,
 * description) and created from TimeHuddle, always under the user's own
 * personal key — so Redmine, not TimeHuddle, decides whether a given user may
 * make a given change, and a refusal is shown rather than pre-empted here.
 * Deleting stays out of scope. Timing an issue is not a Redmine write; it is
 * started from My Board like any other ticket (M3).
 *
 * Since MVP2 the rows come from `redmine.issues.relevant` rather than "every
 * issue the key can see": on a large instance that response was enormous and
 * every subject in it may carry PHI. The table therefore shows the user's own
 * work — assigned, recently logged against, recently touched, watched, pinned —
 * and anything else is reached through the search bar. `includeDismissed` is on,
 * because hiding a search suggestion must not quietly remove a row from a table.
 */
import { redmineApi, type RedmineIssue } from '../../../lib/api';

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
  edit: true,
  delete: false,
  assign: true,
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
const listCache = new Map<string, RedmineRaw[]>();

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

    const cached = listCache.get(userId);
    if (cached) return cached;

    // `includeDismissed: true` — a dismissal is about the search dropdown only.
    const result = await redmineApi.issues.relevant(true);
    if (!result.connected) return [];

    const raws = result.issues.map((issue) => ({ issue, baseUrl: result.baseUrl }));
    listCache.set(userId, raws);
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
