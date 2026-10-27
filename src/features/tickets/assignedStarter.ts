/**
 * The first fill of an empty My Board: "Get issues assigned to me".
 *
 * It asks Redmine for the user's open assigned issues (#736), whatever they
 * removed from their Tickets table, and puts a handful on the board, each as
 * the ticket carrying it. When more remain, a notice says how many and adds
 * the next handful the same way, asking Redmine again each time.
 *
 * The notice is remembered in the browser, per user: it is a pointer for
 * someone setting up this board, not a fact about their account.
 */
import { useCallback, useEffect, useState } from 'react';

import { BOARD_ASSIGNED_NOTICE_KEY } from '../../lib/constants';

/** How many issues one press puts on the board. */
export const STARTER_LIMIT = 10;

/**
 * How many pages of 100 one fill may read looking for issues not on the board
 * yet: as far as the server goes (`MAX_ASSIGNED_OFFSET`, 1,000 issues).
 */
export const ASSIGNED_PAGES_PER_FILL = 10;

/** One page of `redmine.issues.assignedIds`. */
export interface AssignedPage {
  issueIds: number[];
  nextOffset?: number | null;
}

/**
 * The assigned issues still to put on the board, read a page at a time until
 * there are more than one batch's worth (so a leftover is known) or the list
 * ends. `nextOffset` is where reading would carry on: null when the whole list
 * was read, so the count of what's left is exact.
 */
export async function collectAssignedOffBoard(
  fetchPage: (offset: number) => Promise<AssignedPage>,
  isOffBoard: (issueId: number) => boolean,
): Promise<{ offBoard: number[]; nextOffset: number | null }> {
  const offBoard: number[] = [];
  let offset: number | null = 0;
  for (let pages = 0; offset !== null && pages < ASSIGNED_PAGES_PER_FILL; pages += 1) {
    const page: AssignedPage = await fetchPage(offset);
    offBoard.push(...page.issueIds.filter(isOffBoard));
    // A server that doesn't page sends no `nextOffset`: its one page is the list.
    offset = page.nextOffset ?? null;
    if (offBoard.length > STARTER_LIMIT) break;
  }
  return { offBoard, nextOffset: offset };
}

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

export const starterText = {
  getAssigned: 'Get issues assigned to me',
  getting: 'Adding issues…',
  noneAssigned: 'Nothing is assigned to you in Redmine right now.',
  fetchFailed: "Couldn't get your issues from Redmine. Try again in a moment.",
  moreAssigned: (count: number) =>
    `${count} more ${plural(count, 'issue', 'issues')} assigned to you in Redmine.`,
  /** After a reload, when the count from the last fill is gone. */
  moreAssignedUncounted: 'More issues may be assigned to you in Redmine.',
  addMore: (count: number) => `Add ${count} more`,
  addMoreLabel: (count: number) =>
    `Add ${count} more ${plural(count, 'issue', 'issues')} assigned to you to My Board`,
  dismiss: 'Dismiss',
};

const noticeKey = (userId: string) => `${BOARD_ASSIGNED_NOTICE_KEY}:${userId}`;

// Storage can be unavailable (private mode): the notice then lasts for the visit.
function readNotice(userId: string | null): boolean {
  if (!userId) return false;
  try {
    return localStorage.getItem(noticeKey(userId)) === '1';
  } catch {
    return false;
  }
}

function writeNotice(userId: string | null, open: boolean): void {
  if (!userId) return;
  try {
    if (open) localStorage.setItem(noticeKey(userId), '1');
    else localStorage.removeItem(noticeKey(userId));
  } catch {
    // Nothing to do: the state still holds for this visit.
  }
}

/** The "more issues assigned to you" notice: shown after a fill, until dismissed. */
export function useAssignedNotice(userId: string | null): {
  open: boolean;
  show: () => void;
  dismiss: () => void;
} {
  const [open, setOpen] = useState(() => readNotice(userId));

  // The page outlives a sign-in as someone else; the notice is per user.
  useEffect(() => setOpen(readNotice(userId)), [userId]);

  const set = useCallback(
    (next: boolean) => {
      writeNotice(userId, next);
      setOpen(next);
    },
    [userId],
  );
  const show = useCallback(() => set(true), [set]);
  const dismiss = useCallback(() => set(false), [set]);

  return { open, show, dismiss };
}
