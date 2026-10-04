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
import { ticketKey, type TicketSourceId, type UnifiedTicket } from './types';

/** The row key of the issue a ticket is linked to, e.g. `redmine:482`, or null. */
export const linkedIssueKey = (ticket: UnifiedTicket): string | null =>
  ticket.linked ? ticketKey(ticket.linked.sourceId, ticket.linked.id) : null;

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

/**
 * Overlay each linked issue's live status and assignee onto the ticket that
 * links to it, and drop the issue's own row.
 *
 * The linked issue's status replaces the ticket's, so it decides Open/Closed.
 * A ticket whose issue the viewer cannot read keeps its own status.
 */
export function mergeLinked(tickets: UnifiedTicket[]): UnifiedTicket[] {
  const byKey = new Map(tickets.map((ticket) => [ticket.key, ticket]));
  const absorbed = new Set<string>();

  const merged = tickets.map((ticket) => {
    const key = linkedIssueKey(ticket);
    const issue = key ? byKey.get(key) : undefined;
    if (!ticket.linked || !key || !issue) return ticket;
    absorbed.add(key);
    return {
      ...ticket,
      status: issue.status,
      linked: { ...ticket.linked, status: issue.status, assignee: issue.assignees[0] ?? null },
    };
  });

  return merged.filter((ticket) => !ticket.linkOnly && !absorbed.has(ticket.key));
}
