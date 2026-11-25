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

// A whole ticket link, label and all: `[TH-7: Fix login](/app/tickets/<id>)`.
const TICKET_LINK_WHOLE = /\[(?:\\.|[^\]\\])*\]\(\/app\/tickets\/(?!redmine\/)[^)\s]+\)/g;
const BULLET = /^\s*[-*+]\s+/;
const FENCE = /^\s*(```|~~~)/;

/**
 * The plan as a checklist once clocked in: each of the team's tickets becomes
 * a checklist line (`- [ ] [TH-7: …](…)`). A line of tickets alone becomes
 * one line per ticket; a line with words besides its tickets becomes one line
 * as it reads. Checklist lines, other prose and code stay as written.
 * @param {string} text
 * @param {(ticketId: string) => boolean} [isTeamTicket]
 */
export function planTicketsAsChecklist(text, isTeamTicket = () => true) {
  const out = [];
  let inFence = false;
  for (const line of text.split('\n')) {
    if (FENCE.test(line)) inFence = !inFence;
    if (inFence || FENCE.test(line) || TASK_ITEM.test(line)) {
      out.push(line);
      continue;
    }
    const ours = ticketIdsInText(line).filter(isTeamTicket);
    if (ours.length === 0) {
      out.push(line);
      continue;
    }
    const body = line.replace(BULLET, '').trim();
    const links = body.match(TICKET_LINK_WHOLE) ?? [];
    const words = body.replace(TICKET_LINK_WHOLE, '').trim();
    if (words) {
      out.push(`- [ ] ${body}`);
      continue;
    }
    const others = [];
    for (const link of links) {
      const [id] = ticketIdsInText(link);
      if (id && isTeamTicket(id)) out.push(`- [ ] ${link}`);
      else others.push(link);
    }
    if (others.length) out.push(others.join(' '));
  }
  return out.join('\n');
}

/**
 * `text` with each checklist line's box set as `checkedOf` says for its items
 * (its linked tickets, checked when all are; else its words); lines it says
 * nothing about stay.
 * @param {string} text
 * @param {(item: { ticketId: string } | { text: string }) => boolean | undefined} checkedOf
 */
export function withChecks(text, checkedOf) {
  return text
    .split('\n')
    .map((line) => {
      const task = TASK_ITEM.exec(line);
      if (!task) return line;
      const ticketIds = ticketIdsInText(line);
      const states = (
        ticketIds.length
          ? ticketIds.map((ticketId) => checkedOf({ ticketId }))
          : [checkedOf({ text: task[2].trim() })]
      ).filter((state) => state !== undefined);
      const checked = states.length ? states.every(Boolean) : undefined;
      return checked === undefined ? line : line.replace(/\[[ xX]\]/, checked ? '[x]' : '[ ]');
    })
    .join('\n');
}
