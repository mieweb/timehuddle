/**
 * TimeHuddle's own tickets as a unified source.
 *
 * Wraps `ticketApi` and the team context. Status and priority vocabularies here
 * are TimeHuddle's, so this adapter owns mapping them onto the cross-source
 * `isClosed` / `rank` facts.
 */
import { ticketApi, type Ticket } from '../../../lib/api';

import { ticketKey, type SourceCapabilities, type TicketSource, type UnifiedTicket } from './types';

/** Huddle statuses that mean "no longer open". Mirrors the Open/Closed tabs. */
const CLOSED_STATUSES = new Set(['closed', 'reviewed']);

/** Huddle's priority vocabulary, ranked for cross-source sorting. */
const PRIORITY_RANK: Record<string, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

const CAPABILITIES: SourceCapabilities = {
  edit: true,
  delete: true,
  assign: true,
  changeStatus: true,
  trackTime: true,
  openExternal: false,
};

export const huddleSource: TicketSource<Ticket> = {
  id: 'huddle',
  label: 'TimeHuddle',
  capabilities: CAPABILITIES,

  isAvailable: (ctx) => ctx.teams.length > 0,

  fetch: async (ctx) => {
    const results = await Promise.all(ctx.teams.map((team) => ticketApi.getTickets(team.id)));
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

  toUnified: (ticket, ctx): UnifiedTicket => {
    const status = ticket.status || 'open';
    const team = ctx.teams.find((t) => t.id === ticket.teamId);
    return {
      key: ticketKey('huddle', ticket.id),
      sourceId: 'huddle',
      id: ticket.id,
      ref: `#${ticket.id.slice(-5)}`,
      title: ticket.title,
      container: team ? { id: team.id, name: team.name } : null,
      status: { native: status, isClosed: CLOSED_STATUSES.has(status) },
      priority: ticket.priority
        ? { native: ticket.priority, rank: PRIORITY_RANK[ticket.priority] ?? 0 }
        : null,
      assignees: (ticket.assignedTo ?? []).map((id) => ({
        id,
        name: ctx.resolveMemberName(id) ?? id,
      })),
      createdBy: {
        id: ticket.createdBy,
        name: ctx.resolveMemberName(ticket.createdBy) ?? `user-${ticket.createdBy.slice(-4)}`,
      },
      createdAt: ticket.createdAt,
      updatedAt: ticket.updatedAt,
      externalUrl: null,
      externalRef: ticket.github
        ? {
            url: ticket.github,
            label: ticket.github.includes('github.com') ? 'GitHub' : 'Issue link',
          }
        : null,
      sharedWithTimeharbor: ticket.sharedWithTimeharbor === true,
      capabilities: CAPABILITIES,
    };
  },
};
