/**
 * Folds linked external issues into the tickets that link to them.
 *
 * A ticket stores only the id of the issue it is linked to. The issue itself
 * arrives from its own source, read with the viewer's key, and is shown on the
 * linking ticket instead of as a second row for the same piece of work.
 *
 * This is the one place ids are matched across sources: a link names its
 * source explicitly, so `redmine:482` on a ticket and the Redmine issue 482 are
 * the same thing by construction, not by coincidence.
 */
import type { OutsideIssueSummary } from '../../../lib/api';

import {
  ticketKey,
  type TicketSourceId,
  type UnifiedLinkedIssue,
  type UnifiedTicket,
} from './types';

/** The row key of the issue a ticket is linked to, e.g. `redmine:482`, or null. */
export const linkedIssueKey = (ticket: UnifiedTicket): string | null =>
  ticket.linked ? ticketKey(ticket.linked.sourceId, ticket.linked.id) : null;

/**
 * A ticket's My Board entries: its own, and the one for the issue it is linked
 * to. A board entry for a Redmine issue shows as the ticket linked to it, so
 * either one puts the ticket on the board, and taking it off removes both.
 */
export const boardEntryKeys = (ticket: UnifiedTicket, boardKeys: ReadonlySet<string>): string[] =>
  [ticket.key, linkedIssueKey(ticket)].filter(
    (key): key is string => key !== null && boardKeys.has(key),
  );

/** Whether a ticket is on My Board, itself or through the issue it is linked to. */
export const isOnBoard = (ticket: UnifiedTicket, boardKeys: ReadonlySet<string>): boolean =>
  boardEntryKeys(ticket, boardKeys).length > 0;

/**
 * The source a ticket is shown, filtered and sorted under: the system of the
 * issue it is linked to, or its own. A TimeHuddle ticket linked to a Redmine
 * issue is Redmine work, and reads as TimeHuddle again once unlinked.
 *
 * Display only. What a ticket *is* — its capabilities, its assignees, its page —
 * still follows `sourceId`.
 */
export const displaySourceId = (ticket: UnifiedTicket): TicketSourceId =>
  ticket.linked?.sourceId ?? ticket.sourceId;

const outsideKey = ({ source, id, host }: Pick<OutsideIssueSummary, 'source' | 'id' | 'host'>) =>
  `${source}:${id}@${host}`;

/**
 * Whether `issue` is the one `linked` names: the same number on another server
 * is a different issue. A link saved without its server is on the issue's.
 */
function onSameServer(linked: UnifiedLinkedIssue, issue: UnifiedTicket): boolean {
  if (!linked.host || !issue.externalUrl) return true;
  try {
    return new URL(issue.externalUrl).hostname === linked.host;
  } catch {
    return false;
  }
}

/**
 * Overlay each linked issue's live status and assignee onto the ticket that
 * links to it, and drop the issue's own row.
 *
 * The linked issue's status replaces the ticket's, so it decides Open/Closed.
 * A ticket whose issue the viewer cannot read keeps its own status.
 */
export function mergeLinked(
  tickets: UnifiedTicket[],
  outside: readonly OutsideIssueSummary[] = [],
): UnifiedTicket[] {
  const byKey = new Map(tickets.map((ticket) => [ticket.key, ticket]));
  const outsideByKey = new Map(outside.map((issue) => [outsideKey(issue), issue]));
  const absorbed = new Set<string>();

  const merged = tickets.map((ticket) => {
    // An issue on a server other than the main Redmine (`sources.linkedIssues`).
    const read =
      ticket.linked?.host &&
      outsideByKey.get(
        outsideKey({
          source: ticket.linked.sourceId,
          id: ticket.linked.id,
          host: ticket.linked.host,
        }),
      );
    if (ticket.linked && read) {
      const status = { native: read.status.native, isClosed: read.status.isClosed };
      return {
        ...ticket,
        status,
        linked: { ...ticket.linked, status, assignee: read.assignees[0] ?? null },
      };
    }
    const key = linkedIssueKey(ticket);
    const issue = key ? byKey.get(key) : undefined;
    if (!ticket.linked || !key || !issue || !onSameServer(ticket.linked, issue)) return ticket;
    absorbed.add(key);
    return {
      ...ticket,
      status: issue.status,
      // The issue's own ref names it the way its row would, e.g. `PM-482`.
      linked: {
        ...ticket.linked,
        ref: issue.ref,
        status: issue.status,
        assignee: issue.assignees[0] ?? null,
      },
    };
  });

  return merged.filter((ticket) => !ticket.linkOnly && !absorbed.has(ticket.key));
}
