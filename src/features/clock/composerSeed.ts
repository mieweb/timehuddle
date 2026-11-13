/**
 * A plan handed to the Clock page's composer from elsewhere: My Board's
 * Pinned "Clock in" offers the pinned tickets as a checklist. Held until the
 * composer takes it (once), so it survives the navigation between the pages,
 * and announced so a composer that is already open picks it up too.
 */
export interface ComposerSeed {
  /**
   * Markdown for the plan, e.g. one `- [ ] [TH-146 Fix login](/app/tickets/…)`
   * line per ticket; its links are its tickets (see `planTickets`).
   */
  markdown: string;
}

let pending: ComposerSeed | null = null;
const listeners = new Set<() => void>();

export function offerComposerSeed(seed: ComposerSeed) {
  pending = seed;
  listeners.forEach((listener) => listener());
}

/** The waiting seed, if any; taking it clears it. */
export function takeComposerSeed(): ComposerSeed | null {
  const seed = pending;
  pending = null;
  return seed;
}

export function onComposerSeed(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** A checklist, one item per line (Markdown, e.g. a ticket's link), for a plan. */
export const ticketChecklist = (lines: readonly string[]) =>
  lines.map((line) => `- [ ] ${line}`).join('\n');
