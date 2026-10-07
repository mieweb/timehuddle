/**
 * useScopeChange — tell a load for a new scope from a reload of the same one.
 *
 * A page kept mounted behind others (src/ui/ROUTING.md) re-runs every effect
 * each time it is shown again, so its loads re-run too. Only a real change of
 * scope (team, org, user, week) should clear what is on screen or show a
 * loading state; a return should reload quietly behind the data already shown.
 *
 * Returns a function to call at the start of each load with the scope it is
 * for: true the first time it sees that scope, false on a repeat.
 */
import { useCallback, useRef } from 'react';

export function useScopeChange(): (scope: string | null) => boolean {
  const loadedFor = useRef<string | null | undefined>(undefined);
  return useCallback((scope: string | null) => {
    if (loadedFor.current === scope) return false;
    loadedFor.current = scope;
    return true;
  }, []);
}
