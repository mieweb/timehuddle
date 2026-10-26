/**
 * Whether ticket rows show a ticket's TimeHuddle ID (`THX-20`) after the
 * outside ID it goes by (`RM0-214`). Off by default: the outside ID leads,
 * and a ticket with none shows its TimeHuddle ID either way (#689).
 *
 * A per-viewer convenience, so it lives in this browser only. Every list on
 * the page reads the same value, so Tickets and My Board stay in step.
 */
import { useCallback, useSyncExternalStore } from 'react';

const STORAGE_KEY = 'tickets:showHuddleIds';
const listeners = new Set<() => void>();

function read(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

let current = read();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useShowHuddleIds(): [boolean, (show: boolean) => void] {
  const show = useSyncExternalStore(subscribe, () => current);
  const setShow = useCallback((next: boolean) => {
    current = next;
    try {
      if (next) localStorage.setItem(STORAGE_KEY, '1');
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Storage can be off (a private window); the choice still holds for this visit.
    }
    listeners.forEach((listener) => listener());
  }, []);
  return [show, setShow];
}
