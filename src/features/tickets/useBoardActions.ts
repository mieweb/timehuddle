/**
 * Putting tickets on My Board and taking them off, shared by every place that
 * offers it: the Tickets tables, the search suggestions and both ticket pages.
 *
 * Tickets are named by key (`${sourceId}:${id}`, as `UnifiedTicket.key`). A
 * Redmine issue put on the board goes on as the ticket carrying it in the
 * selected team (`carryIssue.ts`, #736). Each write tells the rest of the app
 * with `tickets:refetch`, which every board reader already listens for
 * (`useMyBoardKeys`), so a caller only updates its own state if it wants to be
 * ahead of that read.
 */
import { useToast } from '@mieweb/ui';
import { useCallback } from 'react';

import { ApiError, myBoardApi } from '../../lib/api';
import { useTeam } from '../../lib/TeamContext';

import { boardText } from './boardStrings';
import { NoTeamError, carriedKey } from './carryIssue';
import { invalidateRedmineCache, ticketRefOf } from './sources';
import { removalText } from './ticketRemovalStrings';

/**
 * A Redmine issue is a table row for being on the board alone (`board`), so
 * the cached issue list is stale after either write.
 */
function announce(keys: string[]): void {
  if (keys.some((key) => ticketRefOf(key).sourceId === 'redmine')) invalidateRedmineCache();
  window.dispatchEvent(new CustomEvent('tickets:refetch'));
}

/**
 * What an add put on the board: `requested` are the keys asked for that made
 * it, and `added` the board keys they went on as, in the same order (a Redmine
 * issue goes on as the ticket carrying it).
 */
export interface BoardAdd {
  requested: string[];
  added: string[];
}

export interface BoardActions {
  /** Resolves to what was added, or null when nothing was. A failure is toasted. */
  add: (keys: string[]) => Promise<BoardAdd | null>;
  /**
   * Resolves to whether the tickets were removed; a failure is toasted. With
   * `undoLabel` (the ticket's name) the removal is confirmed in a toast that
   * can put it back: for one ticket taken off with a single press.
   */
  remove: (keys: string[], undoLabel?: string) => Promise<boolean>;
}

export function useBoardActions(): BoardActions {
  const toast = useToast();
  const { selectedTeamId } = useTeam();

  const add = useCallback(
    async (keys: string[]): Promise<BoardAdd | null> => {
      const settled = await Promise.allSettled(keys.map((key) => carriedKey(key, selectedTeamId)));
      if (settled.some((r) => r.status === 'rejected' && r.reason instanceof NoTeamError)) {
        toast.error(boardText.noTeam);
        return null;
      }
      const requested = keys.filter((_, i) => settled[i].status === 'fulfilled');
      const carried = settled.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
      // An issue that couldn't be carried is left out; the rest still go on.
      if (carried.length < keys.length)
        toast.error(boardText.carryFailed(keys.length - carried.length));
      if (carried.length === 0) return null;
      return myBoardApi.addMany(carried.map(ticketRefOf)).then(
        () => {
          // The original keys: a carried issue's linked row is stale too.
          announce(keys);
          return { requested, added: carried };
        },
        // A full board is refused with the server's own explanation.
        (err: unknown) => {
          toast.error(
            err instanceof ApiError && err.code === 'board-full'
              ? err.message
              : removalText.boardAddFailed,
          );
          return null;
        },
      );
    },
    [toast, selectedTeamId],
  );

  const remove = useCallback(
    (keys: string[], undoLabel?: string) =>
      myBoardApi.removeMany(keys.map(ticketRefOf)).then(
        () => {
          announce(keys);
          if (undoLabel) {
            toast.toast({
              message: boardText.removed(undoLabel),
              duration: 6000,
              action: { label: boardText.undo, onClick: () => void add(keys) },
            });
          }
          return true;
        },
        () => {
          toast.error(removalText.boardRemoveFailed);
          return false;
        },
      ),
    [add, toast],
  );

  return { add, remove };
}
