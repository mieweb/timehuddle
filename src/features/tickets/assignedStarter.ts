/**
 * The first fill of an empty My Board: "Get issues assigned to me".
 *
 * It asks Redmine for the user's open assigned issues (#736), whatever they
 * removed from their Tickets table, and puts a handful on the board, each as
 * the ticket carrying it. When more remain, a notice points at All Sources
 * filtered to them; the notice counts from the rows the page already has.
 *
 * The notice is remembered in the browser, per user: it is a pointer for
 * someone setting up this board, not a fact about their account.
 */
import { useCallback, useEffect, useState } from 'react';

import { BOARD_ASSIGNED_NOTICE_KEY } from '../../lib/constants';
import { EMPTY_FILTERS, ME, type TicketFilters } from './ticketFilters';
import type { UnifiedTicket } from './sources';

/** How many issues one press puts on the board. */
export const STARTER_LIMIT = 10;

/**
 * The most assigned issues the server reads from Redmine (`ASSIGNED_ISSUES_LIMIT`).
 * A list this long may have been cut, so a count from it is a lower bound.
 */
const ASSIGNED_LIST_CAP = 100;

/** All Sources narrowed to the user's own Redmine issues. */
export const ASSIGNED_FILTERS: TicketFilters = {
  ...EMPTY_FILTERS,
  sources: ['redmine'],
  assignees: [ME],
};

/**
 * The tickets carrying the user's open, assigned Redmine issues, in the order
 * the tickets came in. The notice after a first fill counts from these.
 *
 * An issue shows as the TimeHuddle ticket carrying it (#736). What decides is
 * the issue's Redmine assignee, never the ticket's TimeHuddle one: that can be
 * someone with no Redmine account at all.
 */
export function assignedToMe(tickets: UnifiedTicket[], meKeys: readonly string[]): UnifiedTicket[] {
  const me = new Set(meKeys);
  const isMe = (redmineUserId: string | undefined) =>
    redmineUserId !== undefined && me.has(`redmine:${redmineUserId}`);
  return tickets.filter(
    (t) => !t.status.isClosed && t.linked?.sourceId === 'redmine' && isMe(t.linked.assignee?.id),
  );
}

/** Whether a count taken from `assigned` may be short of the real one. */
export const isApproximate = (assigned: UnifiedTicket[]): boolean =>
  assigned.length >= ASSIGNED_LIST_CAP;

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

export const starterText = {
  getAssigned: 'Get issues assigned to me',
  getting: 'Adding issues…',
  noneAssigned: 'Nothing is assigned to you in Redmine right now.',
  fetchFailed: "Couldn't get your issues from Redmine. Try again in a moment.",
  /** `approximate` when the list the count came from may have been cut. */
  moreAssigned: (count: number, approximate: boolean) =>
    `${count}${approximate ? '+' : ''} more ${plural(count, 'issue', 'issues')} assigned to you ` +
    `${plural(count, 'is', 'are')} in All Sources.`,
  showThem: 'Show them',
  showThemLabel: 'Show issues assigned to me in All Sources',
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
