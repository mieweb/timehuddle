/**
 * The outside issue a ticket carries (#757), read once for the whole ticket
 * page: the Linked issue section, the status, priority and description, and
 * the Activity card all draw from the same record.
 *
 * Read and written with the viewer's own key, so a viewer who hasn't connected
 * the source, or can't see the issue, gets a state saying why, and the page
 * shows the ticket as TimeHuddle has it.
 */
import { useCallback, useEffect, useState } from 'react';

import { ApiError, ticketApi, type OutsideEdits, type OutsideIssue } from '../../../lib/api';

export type OutsideState =
  | { kind: 'none' }
  | { kind: 'loading' }
  | { kind: 'loaded'; issue: OutsideIssue }
  | { kind: 'not-connected' }
  | { kind: 'other-server' }
  | { kind: 'unavailable' };

function failedState(err: unknown): OutsideState {
  const code = err instanceof ApiError ? err.code : undefined;
  if (code === 'not-connected') return { kind: 'not-connected' };
  if (code === 'other-server' || code === 'custom-instance') return { kind: 'other-server' };
  return { kind: 'unavailable' };
}

/**
 * `linkedKey` changes when the ticket's link does (`source:id`), and is null
 * for a ticket that carries nothing. `write` sends edits as of the record the
 * viewer is looking at, and resolves to the fields the source stored
 * differently; a refusal (`stale`, `no-permission`, …) is thrown as an
 * `ApiError` for the page to show.
 */
export function useOutsideIssue(ticketId: string, linkedKey: string | null) {
  const [state, setState] = useState<OutsideState>({ kind: linkedKey ? 'loading' : 'none' });

  /** Read the issue again; resolves to whether that worked, for `useBackgroundRefresh`. */
  const reload = useCallback(async () => {
    if (!linkedKey) return true;
    try {
      setState({ kind: 'loaded', issue: await ticketApi.outsideIssue(ticketId) });
      return true;
    } catch (err) {
      setState(failedState(err));
      return false;
    }
  }, [ticketId, linkedKey]);

  useEffect(() => {
    if (!linkedKey) {
      setState({ kind: 'none' });
      return;
    }
    setState({ kind: 'loading' });
    void reload();
  }, [linkedKey, reload]);

  const write = useCallback(
    async (edits: OutsideEdits): Promise<string[]> => {
      if (state.kind !== 'loaded') return [];
      const { issue } = state;
      const result = await ticketApi.writeOutside(
        ticketId,
        issue.record.dates.updated ?? '',
        edits,
      );
      setState({
        kind: 'loaded',
        issue: { ...issue, record: result.record, choices: result.choices },
      });
      return result.mismatches;
    },
    [state, ticketId],
  );

  return { state, reload, write };
}
