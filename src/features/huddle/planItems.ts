/**
 * A plan is markdown; its tickets are links to the ticket's page
 * (`[TH-7: Fix login](/app/tickets/…)`), shown as chips. The text is the one
 * source of a plan's tickets — the ids a post links are read back out of it —
 * so picking a ticket writes it into the plan, and deleting it drops it.
 */

import type { SourcePrefix } from '@lib/api';
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

/** A plan line for a ticket: its link alone, no checkbox. */
export function planTicketItem(ticket: { id: string; name: string }): string {
  return ticketLinkMarkdown(ticket);
}

/** `text` with `item` added as its own last line (paragraph). */
export function appendPlanItem(text: string, item: string): string {
  const trimmed = text.replace(/\s+$/, '');
  return trimmed ? `${trimmed}\n\n${item}` : item;
}

// A link to a ticket's page; Redmine issues live under /app/tickets/redmine/.
const TICKET_LINK = /\]\(\/app\/tickets\/(?!redmine\/)([^)/\s]+)\)/g;

/** `id` URL-decoded, or null when it isn't valid encoding (a typed `%`). */
function decodeId(id: string): string | null {
  try {
    return decodeURIComponent(id);
  } catch {
    return null;
  }
}

// What renders as something other than a link: code (fenced or inline) and images.
const NOT_A_LINK = /```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`|!\[[^\]]*\]\([^)]*\)/g;

/** Ids `pattern` captures from `text`'s links, in order, each once; links quoted in code or images don't count. */
function linkedIds(text: string, pattern: RegExp): string[] {
  const links = text.replace(NOT_A_LINK, ' ');
  const ids = [...links.matchAll(pattern)].flatMap((match) => decodeId(match[1]) ?? []);
  return [...new Set(ids)];
}

/** Ids of the tickets `text` links to, in order, each once. */
export function ticketIdsInText(text: string): string[] {
  return linkedIds(text, TICKET_LINK);
}

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

/** An item of today's plan as the text gives it: a ticket, or a checklist line. */
export type PlanItemInput = { ticketId: string } | { text: string; checked: boolean };

/** A plan item as the text has it, with the ticket's name for writing it back. */
export type PlanItemText = { ticketId: string; title: string } | { text: string; checked: boolean };

const FENCED_CODE = /```[\s\S]*?```|~~~[\s\S]*?~~~/g;
const TASK_ITEM = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/;

/**
 * Today's plan's items, read out of its text in order: each ticket it links
 * (once), and each checklist line (`- [ ] Call Pam`) that links none. Other
 * prose is the plan's wording, not an item.
 */
export function planChecklist(text: string): PlanItemInput[] {
  const items: PlanItemInput[] = [];
  const seen = new Set<string>();
  const add = (key: string, item: PlanItemInput) => {
    if (seen.has(key)) return;
    seen.add(key);
    items.push(item);
  };
  for (const line of text.replace(FENCED_CODE, '').split('\n')) {
    const tickets = ticketIdsInText(line);
    if (tickets.length > 0) {
      for (const ticketId of tickets) add(`ticket:${ticketId}`, { ticketId });
      continue;
    }
    const task = TASK_ITEM.exec(line);
    const words = task?.[2].trim();
    if (task && words) add(`text:${words}`, { text: words, checked: task[1] !== ' ' });
  }
  return items;
}

/**
 * The plan's items as text the plan editor opens on: a ticket on its own line
 * as its link, and checklist lines together as one list.
 */
export function planMarkdown(items: readonly PlanItemText[]): string {
  const blocks: string[] = [];
  for (const item of items) {
    if ('ticketId' in item) {
      blocks.push(planTicketItem({ id: item.ticketId, name: item.title }));
      continue;
    }
    const line = `- [${item.checked ? 'x' : ' '}] ${item.text}`;
    const last = blocks.length - 1;
    if (last >= 0 && blocks[last].startsWith('- [')) blocks[last] += `\n${line}`;
    else blocks.push(line);
  }
  return blocks.join('\n\n');
}

/** A checklist line's words as they read: a picked @mention's link shows as its name. */
export function planItemWords(text: string): string {
  return text.replace(/\[((?:\\.|[^\]\\])*)\]\([^)\s]*\)/g, (_, label: string) =>
    label.replace(/\\(.)/g, '$1'),
  );
}
