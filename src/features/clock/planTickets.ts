/**
 * Tickets in a plan's text. A ticket is a Markdown link to its page —
 * `[TH-146 Fix login](/app/tickets/<id>)` — and the text is the only record
 * of which tickets a plan is about: the post's tickets (timers, Redmine time)
 * are read from its links when it is posted. Delete the line and the ticket
 * goes with it; there is no second list to keep in step.
 *
 * Only links count, not an ID typed as text: "TH-146 is blocked by TH-150"
 * attaches nothing.
 */
import { ticketDetailPath } from '../tickets/sources';
import { ticketLine, type TicketRef } from '../huddle/useTicketSelection';

/** A TimeHuddle ticket's page, as `ticketDetailPath` builds it. */
export const ticketPath = (id: string) => ticketDetailPath({ sourceId: 'huddle', id });

/** A ticket as a plan's link: `[TH-146 Fix login](/app/tickets/<id>)`. */
export const ticketLink = (ticket: TicketRef) =>
  `[${ticketLine(ticket)}](${ticketPath(ticket.id)})`;

// `[label](…/app/tickets/<id>)`, absolute or not. Huddle ids only: a Redmine
// issue's page (`/app/tickets/redmine/<n>`) is no TimeHuddle ticket to attach.
const TICKET_LINK = /\[([^\]]*)\]\((?:[^)\s]*?)\/app\/tickets\/([A-Za-z0-9]{17,24})\)/g;
// A label's leading ID, e.g. `TH-146` or `timehuddle-58`.
const LEADING_REF = /^([A-Za-z][\w]*-\d+)\s+(.*)$/;

/** The tickets a plan's text links to, in order, each once. */
export function ticketsInText(markdown: string): TicketRef[] {
  const seen = new Set<string>();
  const tickets: TicketRef[] = [];
  for (const [, label, id] of markdown.matchAll(TICKET_LINK)) {
    if (seen.has(id)) continue;
    seen.add(id);
    const parts = LEADING_REF.exec(label.trim());
    tickets.push(
      parts ? { id, ref: parts[1], title: parts[2] } : { id, title: label.trim() || null },
    );
  }
  return tickets;
}

const OPEN_TASK = /^(\s*(?:[-*+]|\d+[.)])\s+)\[ \]/;

/**
 * The plan with a ticket's checklist items ticked: each `- [ ]` line linking to
 * the ticket becomes `- [x]`. Everything else is left exactly as it was.
 */
export function checkOffTicket(markdown: string, id: string): string {
  const link = `${ticketPath(id)})`;
  return markdown
    .split('\n')
    .map((line) => (line.includes(link) ? line.replace(OPEN_TASK, '$1[x]') : line))
    .join('\n');
}

const TICKET_DONE = 'plan:ticket-done';

/** Tell open plan editors (the Clock page's composer) a ticket is done. */
export function announceTicketDone(id: string) {
  window.dispatchEvent(new CustomEvent<string>(TICKET_DONE, { detail: id }));
}

export function onTicketDone(listener: (id: string) => void) {
  const handle = (event: Event) => listener((event as CustomEvent<string>).detail);
  window.addEventListener(TICKET_DONE, handle);
  return () => window.removeEventListener(TICKET_DONE, handle);
}
