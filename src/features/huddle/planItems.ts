/**
 * A plan is markdown: a checklist whose ticket items link to the ticket's page
 * (`- [ ] [TH-7: Fix login](/app/tickets/…)`). The text is the one source of a
 * plan's tickets — the ids a post links are read back out of it — so picking a
 * ticket writes it into the plan, and deleting its line drops it.
 */

import { huddleTicketRef } from '../tickets/sources/huddleSource';

/** In-app path of a ticket's page (see src/ui/ROUTING.md). */
export function ticketPath(ticketId: string): string {
  return `/app/tickets/${encodeURIComponent(ticketId)}`;
}

/** How a plan names a ticket, as Huddle labels do: `TH-12: Fix login`. */
export function planTicketName(
  ticket: { id: string; title: string | null; number?: number },
  ticketPrefix?: string,
): string {
  const ref = huddleTicketRef(ticket, ticketPrefix);
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

/** An unchecked plan item for a ticket. */
export function planTicketItem(ticket: { id: string; name: string }): string {
  return `- [ ] ${ticketLinkMarkdown(ticket)}`;
}

/**
 * `text` with `item` added as its last checklist line. Joined to a checklist
 * the text already ends with; after a paragraph, a blank line starts the list.
 */
export function appendPlanItem(text: string, item: string): string {
  const trimmed = text.replace(/\s+$/, '');
  if (!trimmed) return item;
  const lastLine = trimmed.slice(trimmed.lastIndexOf('\n') + 1);
  return /^\s*[-*+] /.test(lastLine) ? `${trimmed}\n${item}` : `${trimmed}\n\n${item}`;
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

/** Ids of the tickets `text` links to, in order, each once; links quoted in code or images don't count. */
export function ticketIdsInText(text: string): string[] {
  const links = text.replace(NOT_A_LINK, ' ');
  const ids = [...links.matchAll(TICKET_LINK)].flatMap((match) => decodeId(match[1]) ?? []);
  return [...new Set(ids)];
}

/**
 * The ids `text` links to that a post in the team may carry: a link to another
 * team's ticket (or a deleted one) stays a plain link, since the server
 * refuses a post that carries one. `teamTicketIds` is read fresh at send
 * (`fetchTeamTicketIds`).
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
