/**
 * Today's plan read out of its text (M4, #886) — shared by the app, which
 * turns an edited plan into items, and the server, which starts a session's
 * plan from its plan post. A plan is markdown: its tickets are links to the
 * ticket's page (`[TH-7: Fix login](/app/tickets/<id>)`), its own items are
 * checklist lines (`- [ ] Call Pam`).
 */

// A link to a ticket's page; Redmine issues live under /app/tickets/redmine/.
const TICKET_LINK = /\]\(\/app\/tickets\/(?!redmine\/)([^)/\s]+)\)/g;

// What renders as something other than a link: code (fenced or inline) and images.
const NOT_A_LINK = /```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`|!\[[^\]]*\]\([^)]*\)/g;

const FENCED_CODE = /```[\s\S]*?```|~~~[\s\S]*?~~~/g;
const TASK_ITEM = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/;

/** `id` URL-decoded, or null when it isn't valid encoding (a typed `%`). */
function decodeId(id) {
  try {
    return decodeURIComponent(id);
  } catch {
    return null;
  }
}

/** Ids `pattern` captures from `text`'s links, in order, each once; links quoted in code or images don't count. */
export function linkedIds(text, pattern) {
  const links = text.replace(NOT_A_LINK, ' ');
  const ids = [...links.matchAll(pattern)].flatMap((match) => decodeId(match[1]) ?? []);
  return [...new Set(ids)];
}

/** Ids of the tickets `text` links to, in order, each once. */
export function ticketIdsInText(text) {
  return linkedIds(text, TICKET_LINK);
}

/**
 * Today's plan's items, read out of its text in order: each of the team's
 * tickets it links (once), and each checklist line (`- [ ] Call Pam`) that
 * links none of them. A link to another team's ticket stays text, as it does
 * in the post, so a checklist line holding one is kept as a line. Other prose
 * is the plan's wording, not an item.
 * @param {string} text
 * @param {(ticketId: string) => boolean} [isTeamTicket] the default takes every linked ticket
 */
export function planChecklist(text, isTeamTicket = () => true) {
  const items = [];
  const seen = new Set();
  const add = (key, item) => {
    if (seen.has(key)) return;
    seen.add(key);
    items.push(item);
  };
  for (const line of text.replace(FENCED_CODE, '').split('\n')) {
    const tickets = ticketIdsInText(line).filter(isTeamTicket);
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
