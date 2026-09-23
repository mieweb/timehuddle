/**
 * useRedmineStatus — whether the signed-in user has a Redmine account linked.
 *
 * `TicketsPage` stays mounted behind every route to preserve its state
 * (AppLayout.tsx), so it never remounts when the user links an account in
 * Settings and navigates back. Without a signal it would keep rendering as if
 * no account existed until the window was reloaded — issue #562.
 *
 * Settings therefore broadcasts `redmine:changed` after connecting and after
 * disconnecting, carrying the fresh status it already has in hand. Listeners
 * apply that payload directly, so the signal costs no extra round trip; a
 * dispatch without a usable payload falls back to fetching the status.
 *
 * Two contracts worth knowing:
 *
 *   - **`null` means "unknown", not "disconnected".** The initial fetch has not
 *     landed, or it failed. Callers that render a "you are not connected"
 *     message must check `connected === false`, never `!connected`.
 *   - The fetch is keyed on the user id. Signing out does not reload the page,
 *     so without that key a second user would inherit the first user's status —
 *     the same reason `redmineSource` keys its list cache by user id.
 */
import { useCallback, useEffect, useState } from 'react';

import { redmineApi, type RedmineStatus } from './api';
import { useSession } from './useSession';

/** Broadcast when a Redmine account is linked or unlinked. */
export const REDMINE_CHANGED = 'redmine:changed';

/** Tell the app the Redmine link changed, passing the status Settings just got back. */
export function notifyRedmineChanged(status: RedmineStatus): void {
  window.dispatchEvent(new CustomEvent(REDMINE_CHANGED, { detail: status }));
}

/** Narrow an event payload that crossed an untyped `CustomEvent` boundary. */
function asStatus(detail: unknown): RedmineStatus | null {
  if (typeof detail !== 'object' || detail === null) return null;
  return typeof (detail as RedmineStatus).connected === 'boolean'
    ? (detail as RedmineStatus)
    : null;
}

export function useRedmineStatus(): RedmineStatus | null {
  const { user } = useSession();
  const userId = user?.id ?? null;
  const [status, setStatus] = useState<RedmineStatus | null>(null);

  const load = useCallback(async () => {
    try {
      setStatus(await redmineApi.status());
    } catch {
      // An unlinked or unreachable Redmine is ordinary here, not an error worth
      // surfacing: `null` leaves callers showing nothing rather than the wrong
      // thing.
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    if (!userId) {
      setStatus(null);
      return;
    }
    let cancelled = false;
    redmineApi
      .status()
      .then((next) => {
        if (!cancelled) setStatus(next);
      })
      .catch(() => {
        if (!cancelled) setStatus(null);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  useEffect(() => {
    const onChanged = (event: Event) => {
      const next = asStatus((event as CustomEvent).detail);
      if (next) setStatus(next);
      else void load();
    };
    window.addEventListener(REDMINE_CHANGED, onChanged);
    return () => window.removeEventListener(REDMINE_CHANGED, onChanged);
  }, [load]);

  return status;
}
