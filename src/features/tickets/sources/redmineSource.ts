/**
 * A connected Redmine instance, as the live data behind carried tickets.
 *
 * Since #736 a Redmine issue is never a row of its own: work on one is carried
 * by a TimeHuddle ticket (`../carryIssue.ts`). This source reads, under the
 * user's own key, the issues those tickets are linked to, so each ticket shows
 * its issue's live status and assignee (`linkedTickets.ts`). Every item it
 * returns is `linkOnly` and folds into the ticket that links to it.
 *
 * The data comes from `redmine.issues.relevant`, whose `linkedIssues` are the
 * issues TimeHuddle tickets the user can see are linked to. The rest of that
 * list (assigned, recently logged, watched) belongs to the search bar's
 * suggestions.
 */
import { redmineApi, type RedmineIssue } from '../../../lib/api';

import { outsideIdOf } from '../ticketIds';

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
  changeStatus: true,
  openExternal: true,
};

/** An issue paired with the base URL needed to build its external link. */
export interface RedmineRaw {
  issue: RedmineIssue;
  baseUrl: string | null;
  /** Always set: the issue is here because a ticket links to it, never as a row. */
  linkOnly?: boolean;
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

    // Linked issues only: a Redmine issue is never a row of its own (#736).
    const raws: RedmineRaw[] = (result.linkedIssues ?? []).map((issue) => ({
      issue,
      baseUrl: result.baseUrl,
      linkOnly: true,
    }));
    listCache.set(userId, raws);
    return raws;
  },

  toUnified: ({ issue, baseUrl, linkOnly }, ctx): UnifiedTicket => {
    const externalUrl = baseUrl ? `${baseUrl}/issues/${issue.id}` : null;
    return {
      key: ticketKey('redmine', issue.id),
      sourceId: 'redmine',
      id: String(issue.id),
      // `PM-233` once the org has named this server, `#233` until then.
      ref: outsideIdOf(externalUrl, ctx.sourcePrefixes ?? []) ?? `#${issue.id}`,
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
      externalUrl,
      externalRef: null,
      sharedWithTimeharbor: false,
      linked: null,
      ...(linkOnly ? { linkOnly } : {}),
      capabilities: CAPABILITIES,
    };
  },
};
