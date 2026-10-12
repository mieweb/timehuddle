/**
 * TimeHuddle's own tickets as a unified source.
 *
 * Wraps `ticketApi` and the team context. Status and priority vocabularies here
 * are TimeHuddle's, so this adapter owns mapping them onto the cross-source
 * `isClosed` / `rank` facts.
 */
import { ticketApi, type Ticket } from '../../../lib/api';

import { isWebUrl } from '../link/ticketLinkForm';

import {
  ticketKey,
  type SourceCapabilities,
  type TicketSource,
  type TicketSourceContext,
  type UnifiedTicket,
} from './types';

/** Huddle statuses that mean "no longer open". Mirrors the Open/Closed tabs. */
const CLOSED_STATUSES = new Set(['closed', 'reviewed']);

/** Huddle's priority vocabulary, ranked for cross-source sorting. */
const PRIORITY_RANK: Record<string, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

/**
 * A Huddle ticket's short reference, e.g. `#3fa2c`. Huddle tickets have no
 * human number, so the table and the ticket page both show the tail of the id.
 */
export function huddleTicketRef(id: string): string {
  return `#${id.slice(-5)}`;
}

const CAPABILITIES: SourceCapabilities = {
  edit: true,
  delete: true,
  changeStatus: true,
  openExternal: false,
};

const assigneesOf = (ids: string[], ctx: TicketSourceContext) =>
  ids.map((id) => ({ id, name: ctx.resolveMemberName(id) ?? id }));

const creatorOf = (id: string, ctx: TicketSourceContext) => ({
  id,
  name: ctx.resolveMemberName(id) ?? `user-${id.slice(-4)}`,
});

export const huddleSource: TicketSource<Ticket> = {
  id: 'huddle',
  label: 'TimeHuddle',
  capabilities: CAPABILITIES,

  isAvailable: (ctx) => ctx.teams.length > 0,

  fetch: async (ctx) => {
    const results = await Promise.all(
      // The table never shows descriptions; the edit form fetches the full ticket.
      ctx.teams.map((team) => ticketApi.getTickets(team.id, { brief: true })),
    );
    // A ticket can come back from more than one team request; keep the first.
    const seen = new Set<string>();
    const merged: Ticket[] = [];
    for (const batch of results) {
      for (const ticket of batch) {
        if (seen.has(ticket.id)) continue;
        seen.add(ticket.id);
        merged.push(ticket);
      }
    }
    return merged;
  },

  relabel: (item, ctx) => ({
    ...item,
    assignees: assigneesOf(
      item.assignees.map((a) => a.id),
      ctx,
    ),
    createdBy: item.createdBy && creatorOf(item.createdBy.id, ctx),
  }),

  toUnified: (ticket, ctx): UnifiedTicket => {
    const status = ticket.status || 'open';
    const team = ctx.teams.find((t) => t.id === ticket.teamId);
    return {
      key: ticketKey('huddle', ticket.id),
      sourceId: 'huddle',
      id: ticket.id,
      ref: huddleTicketRef(ticket.id),
      title: ticket.title,
      container: team ? { id: team.id, name: team.name } : null,
      status: { native: status, isClosed: CLOSED_STATUSES.has(status) },
      priority: ticket.priority
        ? { native: ticket.priority, rank: PRIORITY_RANK[ticket.priority] ?? 0 }
        : null,
      assignees: assigneesOf(ticket.assignedTo ?? [], ctx),
      createdBy: creatorOf(ticket.createdBy, ctx),
      createdAt: ticket.createdAt,
      updatedAt: ticket.updatedAt,
      externalUrl: null,
      // Only a web address becomes a link: the value is user-entered.
      externalRef: isWebUrl(ticket.github)
        ? {
            url: ticket.github,
            label: ticket.github.includes('github.com') ? 'GitHub' : 'Issue link',
          }
        : null,
      sharedWithTimeharbor: ticket.sharedWithTimeharbor === true,
      linked: ticket.linkedIssue
        ? {
            sourceId: ticket.linkedIssue.source,
            id: ticket.linkedIssue.id,
            ref: `#${ticket.linkedIssue.id}`,
            status: null,
            assignee: null,
          }
        : null,
      capabilities: CAPABILITIES,
    };
  },
};
