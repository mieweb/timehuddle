/**
 * How the two dialogs that send time name an entry's issue: by its outside ID
 * (`PM0-1`), so two servers' issues of the same number are told apart, or
 * `#1` on a server the organization has given no prefix.
 */
import { useCallback } from 'react';

import type { SourcePrefix } from '../../lib/api';
import { useTeam } from '../../lib/TeamContext';
import { carriedRefOf } from '../tickets/ticketIds';

/** The bare hostname of `url`, or null. */
function hostOfUrl(url: string | null | undefined): string | null {
  try {
    return url ? new URL(url).hostname : null;
  } catch {
    return null;
  }
}

/** `PM0-1` for issue 1 on `host`, or on the main Redmine at `mainBaseUrl` without one. */
export function entryRefOf(
  ticketId: string,
  host: string | undefined,
  mainBaseUrl: string | null | undefined,
  prefixes: readonly SourcePrefix[],
): string {
  return carriedRefOf({ id: ticketId, host }, prefixes, hostOfUrl(mainBaseUrl)) ?? `#${ticketId}`;
}

/** `entryRefOf`, with the prefixes of the team being viewed. */
export function useEntryRef(
  mainBaseUrl: string | null | undefined,
): (ticketId: string, host?: string) => string {
  const { teams, selectedTeamId } = useTeam();
  const prefixes = teams?.find((team) => team.id === selectedTeamId)?.sourcePrefixes;
  return useCallback(
    (ticketId, host) => entryRefOf(ticketId, host, mainBaseUrl, prefixes ?? []),
    [mainBaseUrl, prefixes],
  );
}
