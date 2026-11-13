/**
 * A member's own list of ticket keys for My Board, by name: its order
 * (`board-order`) and what is pinned to its top (`board-pinned`).
 *
 * Prototype: kept in this device's storage, so it does not follow the member
 * to another device yet. The backend is its next home; callers only see the
 * keys and their setter, so moving it there changes nothing outside this file.
 */
import { useCallback, useEffect, useState } from 'react';

export type SavedKeyListName = 'board-order' | 'board-pinned';

const storageKey = (name: SavedKeyListName, userId: string) => `timehuddle:${name}:${userId}`;

function read(name: SavedKeyListName, userId: string | null): string[] {
  if (!userId) return [];
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey(name, userId)) ?? '[]');
    return Array.isArray(saved) ? saved.filter((key) => typeof key === 'string') : [];
  } catch {
    return [];
  }
}

export function useSavedKeyList(name: SavedKeyListName, userId: string | null) {
  const [keys, setKeysState] = useState<string[]>(() => read(name, userId));

  // Signing in as someone else reads their list.
  useEffect(() => setKeysState(read(name, userId)), [name, userId]);

  const setKeys = useCallback(
    (update: (prev: string[]) => string[]) => {
      setKeysState((prev) => {
        const next = update(prev);
        if (userId) {
          try {
            localStorage.setItem(storageKey(name, userId), JSON.stringify(next));
          } catch {
            // Storage refused (private mode, full): the list lasts the session.
          }
        }
        return next;
      });
    },
    [name, userId],
  );

  return [keys, setKeys] as const;
}
