/**
 * Putting tickets on My Board and taking them off, shared by every place that
 * offers it: the Tickets tables, the search suggestions and both ticket pages.
 *
 * Tickets are named by key (`${sourceId}:${id}`, as `UnifiedTicket.key`). Each
 * write tells the rest of the app with `tickets:refetch`, which every board
 * reader already listens for (`useMyBoardKeys`), so a caller only updates its
 * own state if it wants to be ahead of that read.
 */
import { useToast } from '@mieweb/ui';
import { useCallback } from 'react';

import { ApiError, myBoardApi } from '../../lib/api';

import { boardText } from './boardStrings';
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

export interface BoardActions {
  /** Resolves to whether the tickets were added; a failure is toasted. */
  add: (keys: string[]) => Promise<boolean>;
  /**
   * Resolves to whether the tickets were removed; a failure is toasted. With
   * `undoLabel` (the ticket's name) the removal is confirmed in a toast that
   * can put it back: for one ticket taken off with a single press.
   */
  remove: (keys: string[], undoLabel?: string) => Promise<boolean>;
}

export function useBoardActions(): BoardActions {
  const toast = useToast();

  const add = useCallback(
    (keys: string[]) =>
      myBoardApi.addMany(keys.map(ticketRefOf)).then(
        () => {
          announce(keys);
          return true;
        },
        // A full board is refused with the server's own explanation.
        (err: unknown) => {
          toast.error(
            err instanceof ApiError && err.code === 'board-full'
              ? err.message
              : removalText.boardAddFailed,
          );
          return false;
        },
      ),
    [toast],
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
