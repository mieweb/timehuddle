/**
 * A plan is markdown; its tickets are links to the ticket's page
 * (`[TH-7: Fix login](/app/tickets/…)`), shown as chips. The text is the one
 * source of a plan's tickets — the ids a post links are read back out of it —
 * so picking a ticket writes it into the plan, and deleting it drops it.
 */

import type { SourcePrefix } from '@lib/api';
import {
  linkedIds,
  planChecklist,
  planTicketsAsChecklist,
  ticketIdsInText,
  withChecks,
  type PlanItemInput,
} from '@timehuddle/plan-items';
import { huddleTicketRef } from '../tickets/sources/huddleSource';
import { ticketOutsideRefOf } from '../tickets/ticketIds';
import type { TicketRef } from './useTicketSelection';

/** In-app path of a ticket's page (see src/ui/ROUTING.md). */
export function ticketPath(ticketId: string): string {
  return `/app/tickets/${encodeURIComponent(ticketId)}`;
}

/** What a team names its tickets by: its own prefix and its organization's servers. */
export interface TicketNaming {
  ticketPrefix?: string;
  sourcePrefixes?: readonly SourcePrefix[];
}

/**
 * How a plan names a ticket, by the ID My Board shows it under: its outside
 * one (`timehuddle-717: Fix login`), else its own (`TH-12: Fix login`).
 */
export function planTicketName(ticket: TicketRef, naming: TicketNaming = {}): string {
  const ref =
    ticketOutsideRefOf(ticket, naming.sourcePrefixes ?? [], null) ??
    huddleTicketRef(ticket, naming.ticketPrefix);
  return ticket.title ? `${ref}: ${ticket.title}` : ref;
}

/** Escape text so markdown punctuation in it (`[`, `*`, …) shows as typed. */
function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_[\]<>]/g, '\\$&');
}

/** "[TH-7: Onboarding checklist](/app/tickets/…)" — opens the ticket in the app. */
export function ticketLinkMarkdown(ticket: { id: string; name: string }): string {
  return `[${escapeMarkdown(ticket.name)}](${ticketPath(ticket.id)})`;
}

/** A plan line for a ticket: an unchecked checklist item holding its link. */
export function planTicketItem(ticket: { id: string; name: string }): string {
  return `- [ ] ${ticketLinkMarkdown(ticket)}`;
}

const LIST_ITEM = /^\s*[-*+]\s/;

/**
 * `text` with `item` added as its own last line: the next item of a list it
 * ends with, else a paragraph of its own.
 */
export function appendPlanItem(text: string, item: string): string {
  const trimmed = text.replace(/\s+$/, '');
  if (!trimmed) return item;
  const lastLine = trimmed.slice(trimmed.lastIndexOf('\n') + 1);
  const sameList = LIST_ITEM.test(lastLine) && LIST_ITEM.test(item);
  return `${trimmed}${sameList ? '\n' : '\n\n'}${item}`;
}

/** Ids of the tickets `text` links to, in order, each once. */
export { ticketIdsInText };

/** `text` with a plan line for each ticket it doesn't link yet, in the given order. */
export function appendPlanTickets(text: string, tickets: { id: string; name: string }[]): string {
  const linked = new Set(ticketIdsInText(text));
  let plan = text;
  for (const ticket of tickets) {
    if (linked.has(ticket.id)) continue;
    linked.add(ticket.id);
    plan = appendPlanItem(plan, planTicketItem(ticket));
  }
  return plan;
}

/** In-app path of a person's profile (see src/ui/ROUTING.md). */
export function profilePath(userId: string): string {
  return `/app/profile/${encodeURIComponent(userId)}`;
}

// A link to a person's profile: how a picked @mention is written.
const PROFILE_LINK = /\]\(\/app\/profile\/([^)/\s]+)\)/g;

/** Ids of the people `text` links to — its picked mentions — in order, each once. */
export function profileIdsInText(text: string): string[] {
  return linkedIds(text, PROFILE_LINK);
}

/**
 * `text` without its profile and ticket links, label and all — what's left of
 * it is typed. A picked label is a name or a ticket title, so an `@` in it
 * (`Fix @team notifications`) mentions no one.
 */
export function withoutReferenceLinks(text: string): string {
  // A label may hold escaped brackets (`\\[PTO\\]`), so `\\` escapes are skipped whole.
  return text.replace(/\[(?:\\.|[^\]\\])*\]\(\/app\/(?:profile|tickets)\/[^)\s]*\)/g, ' ');
}

/**
 * The ids `text` links to that a post in the team may carry: a link to another
 * team's ticket (or a deleted one) stays a plain link, since the server
 * refuses a post that carries one. `teamTicketIds` is read fresh at send
 * (`fetchTeamRefs`).
 */
export function teamTicketIdsInText(text: string, teamTicketIds: ReadonlySet<string>) {
  return ticketIdsInText(text).filter((id) => teamTicketIds.has(id));
}

/**
 * A post's ticket ids after its text is edited: tickets it carried without a
 * link in the old text (picked with the Ticket button) stay, and the team's
 * tickets the new text links are the rest — so deleting a link drops its ticket.
 */
export function editedTicketIds(
  carried: string[],
  oldText: string,
  newText: string,
  teamTicketIds: ReadonlySet<string>,
): string[] {
  const linkedBefore = new Set(ticketIdsInText(oldText));
  const kept = carried.filter((id) => !linkedBefore.has(id));
  return [...new Set([...kept, ...teamTicketIdsInText(newText, teamTicketIds)])];
}

// ─── Today's plan as items (M4, #886) ────────────────────────────────────────

/** Today's plan read out of its text (`@timehuddle/plan-items`, shared with the server). */
export { planChecklist, planTicketsAsChecklist, withChecks, type PlanItemInput };

/** A plan item with what it needs to be written as a checklist line. */
export type PlanItemText =
  { ticketId: string; title: string; checked: boolean } | { text: string; checked: boolean };

/**
 * Today's plan as the editor shows it while clocked in: one checklist, every
 * item a line — a ticket as its link (`- [ ] [TH-7: …](/app/tickets/…)`),
 * which reads back as the same ticket (`planChecklist`).
 */
export function planMarkdown(items: readonly PlanItemText[]): string {
  return items
    .map((item) => {
      const box = `- [${item.checked ? 'x' : ' '}] `;
      return 'ticketId' in item
        ? box + ticketLinkMarkdown({ id: item.ticketId, name: item.title })
        : box + item.text;
    })
    .join('\n');
}

/** A checklist line's words as they read: a picked @mention's link shows as its name. */
export function planItemWords(text: string): string {
  return text.replace(/\[((?:\\.|[^\]\\])*)\]\([^)\s]*\)/g, (_, label: string) =>
    label.replace(/\\(.)/g, '$1'),
  );
}
