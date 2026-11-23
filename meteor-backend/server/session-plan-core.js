/**
 * Today's plan as session data (M4, #886): the plan's items and whether each
 * is checked off, stored on the clock session (`clockevents.planItems`),
 * apart from the Huddle post that announced the plan. The post is what the
 * team read that morning and is never edited to show progress; this is the
 * plan's current state, which the Clock page and My Board show.
 *
 * An item is a ticket of the session's team, `{ id, ticketId, checked }`, or
 * a line of text, `{ id, text, checked }`. Only ids and the person's own words
 * are kept: a ticket's name is resolved when the plan is read.
 *
 * Pure: no Meteor, no database, so it is unit-tested directly.
 */

export const MAX_PLAN_ITEMS = 100;
export const MAX_ITEM_TEXT = 500;

/** One identity per item: a ticket once, a line of text once. */
const keyOf = (item) => (item.ticketId ? `ticket:${item.ticketId}` : `text:${item.text}`);

/**
 * The items a client sent, trimmed, in order, each once: `{ ticketId }` or
 * `{ text }`, with `checked` when it says. Null when they aren't a plan.
 * @returns {Array<{ ticketId?: string, text?: string, checked?: boolean }> | null}
 */
export function planInput(input) {
  if (!Array.isArray(input) || input.length > MAX_PLAN_ITEMS) return null;
  const items = [];
  const seen = new Set();
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') return null;
    const checked = typeof raw.checked === 'boolean' ? { checked: raw.checked } : {};
    let item;
    if (typeof raw.ticketId === 'string' && raw.ticketId) {
      item = { ticketId: raw.ticketId, ...checked };
    } else if (typeof raw.text === 'string') {
      const text = raw.text.trim();
      if (text.length > MAX_ITEM_TEXT) return null;
      if (!text) continue;
      item = { text, ...checked };
    } else {
      return null;
    }
    if (seen.has(keyOf(item))) continue;
    seen.add(keyOf(item));
    items.push(item);
  }
  return items;
}

/**
 * The plan after an edit: `incoming` in its order. An item already in the plan
 * keeps its id and, unless the edit says otherwise, whether it was checked
 * off; the rest are new, and returned as `added` too. `toggled` are the items
 * already in the plan whose check the edit changed.
 * @param {Array<{ id: string, ticketId?: string, text?: string, checked: boolean }>} previous
 * @param {ReturnType<typeof planInput>} incoming
 * @param {() => string} newId
 */
export function mergePlan(previous, incoming, newId) {
  const before = new Map((previous ?? []).map((item) => [keyOf(item), item]));
  const items = incoming.map((next) => {
    const kept = before.get(keyOf(next));
    const what = next.ticketId ? { ticketId: next.ticketId } : { text: next.text };
    return { id: kept?.id ?? newId(), ...what, checked: next.checked ?? kept?.checked ?? false };
  });
  return {
    items,
    added: items.filter((item) => !before.has(keyOf(item))),
    toggled: items.filter((item) => {
      const kept = before.get(keyOf(item));
      return kept !== undefined && kept.checked !== item.checked;
    }),
  };
}

/**
 * The plan with one item checked or unchecked by hand. `changed` is that item
 * as it is now, or null when it was already so (or isn't in the plan).
 */
export function withChecked(items, itemId, checked) {
  let changed = null;
  const next = items.map((item) => {
    if (item.id !== itemId || item.checked === checked) return item;
    changed = { ...item, checked };
    return changed;
  });
  return { items: next, changed };
}

/**
 * Touch and go: starting a ticket unchecks its item (coming back to it), and
 * the ticket switched away from is checked off. Tickets not in the plan, and
 * text items, are left alone. `checkedOff` is the item that was just checked
 * off, if any; `changed` whether anything moved.
 * @param {{ fromTicketId?: string | null, toTicketId?: string | null }} switchInfo
 */
export function touchAndGo(items, { fromTicketId = null, toTicketId = null }) {
  let checkedOff = null;
  let changed = false;
  const next = items.map((item) => {
    if (!item.ticketId) return item;
    if (item.ticketId === toTicketId) {
      if (!item.checked) return item;
      changed = true;
      return { ...item, checked: false };
    }
    if (item.ticketId === fromTicketId && !item.checked) {
      changed = true;
      checkedOff = { ...item, checked: true };
      return checkedOff;
    }
    return item;
  });
  return { items: next, checkedOff, changed };
}
