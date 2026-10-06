/**
 * The signed-in user's My Board membership, as identity only: `${sourceId}:${id}`
 * keys matching `UnifiedTicket.key`. Display fields are resolved by filtering
 * the loaded tickets, never snapshotted server-side (Core Model Data Discipline).
 *
 * The Tickets page stays mounted behind other routes and across a sign-in as
 * someone else, and it opens on My Board. So the board belongs to one user at
 * a time here: it is emptied the moment the user changes, and an answer that
 * was asked for the previous user is dropped.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { myBoardApi } from '../../lib/api';

const keyOf = (entry: { sourceId: string; ticketId: string }) =>
  `${entry.sourceId}:${entry.ticketId}`;

export interface MyBoardKeys {
  boardKeys: Set<string>;
  /** For optimistic updates after a move to or from the board. */
  setBoardKeys: React.Dispatch<React.SetStateAction<Set<string>>>;
  /** Huddle board entries the server says the user can no longer see. */
  unavailableHuddleKeys: Set<string>;
  /** Read the board again. A failed read keeps the board as it was. */
  loadBoard: () => void;
  /**
   * False until this user's first read has answered, one way or the other.
   * Until then an empty `boardKeys` means "not known yet", not "nothing on it".
   */
  boardLoaded: boolean;
}

export function useMyBoardKeys(userId: string | null): MyBoardKeys {
  const [boardKeys, setBoardKeys] = useState<Set<string>>(new Set());
  const [unavailableHuddleKeys, setUnavailableHuddleKeys] = useState<Set<string>>(new Set());
  const [boardLoaded, setBoardLoaded] = useState(false);

  // Reads are numbered so only the latest one is kept; a change of user retires
  // whatever is in flight.
  const latestRead = useRef(0);
  const loadedFor = useRef(userId);

  const loadBoard = useCallback(() => {
    const read = ++latestRead.current;
    void myBoardApi
      .list()
      .then((entries) => {
        if (read !== latestRead.current) return;
        setBoardKeys(new Set(entries.map(keyOf)));
        setUnavailableHuddleKeys(new Set(entries.filter((e) => e.unavailable).map(keyOf)));
      })
      .catch(() => {})
      .finally(() => {
        if (read === latestRead.current) setBoardLoaded(true);
      });
  }, []);

  // Reloaded on tickets:refetch too: a timer start (from anywhere, including
  // one that waited for a clock-in) can add a ticket to the board.
  useEffect(() => {
    if (loadedFor.current !== userId) {
      loadedFor.current = userId;
      setBoardKeys(new Set());
      setUnavailableHuddleKeys(new Set());
      setBoardLoaded(false);
    }
    loadBoard();
    window.addEventListener('tickets:refetch', loadBoard);
    return () => window.removeEventListener('tickets:refetch', loadBoard);
  }, [loadBoard, userId]);

  return { boardKeys, setBoardKeys, unavailableHuddleKeys, loadBoard, boardLoaded };
}
