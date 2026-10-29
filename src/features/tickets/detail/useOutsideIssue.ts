/**
 * The outside issue a ticket carries (#757), read once for the whole ticket
 * page: the Linked issue section, the status, priority and description, and
 * the Activity card all draw from the same record.
 *
 * Read and written with the viewer's own key. A viewer whose key can't read the
 * issue (not connected, another server, refused, or can't see it) is `denied`,
 * and the page shows them no part of the ticket (#788): its title is the
 * issue's subject.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  ApiError,
  outsideIssueKey,
  ticketApi,
  type OutsideEdits,
  type OutsideIssue,
} from '../../../lib/api';

export type OutsideState =
  | { kind: 'none' }
  | { kind: 'loading' }
  | { kind: 'loaded'; issue: OutsideIssue }
  | { kind: 'denied' }
  | { kind: 'unreachable' };

/** The answers that mean the viewer's own key can't read the issue. */
const DENIED_CODES = new Set([
  'not-connected',
  'other-server',
  'custom-instance',
  'invalid-key',
  'forbidden',
  'gone',
]);

/** Anything but a refusal (an outage, a rate limit) says nothing about access. */
function failedState(err: unknown): OutsideState {
  const code = err instanceof ApiError ? err.code : undefined;
  return code && DENIED_CODES.has(code) ? { kind: 'denied' } : { kind: 'unreachable' };
}

/**
 * `linkedKey` changes when the ticket's link does (`source:id`), and is null
 * for a ticket that carries nothing. `write` sends edits as of `basedOn`, the
 * issue and its `dates.updated` when the edit was opened (the one on screen
 * when omitted), and resolves to the fields the source stored differently; a
 * refusal (`stale`, `no-permission`, …) is thrown as an `ApiError` for the page
 * to show.
 *
 * Only the newest request may change what is shown: an answer that arrives
 * after another read or a write, or after the page moved to another ticket or
 * link, is dropped.
 *
 * The server reads whatever the ticket carries now, so a teammate's relink can
 * answer with another issue than `linkedKey`. That record is never shown: the
 * state stays `loading` (nothing editable) and `onRelinked` asks the page to
 * read the ticket again, whose new `linkedKey` reads the issue afresh.
 */
export function useOutsideIssue(
  ticketId: string,
  linkedKey: string | null,
  onRelinked: () => void,
) {
  const [state, setState] = useState<OutsideState>({ kind: linkedKey ? 'loading' : 'none' });
  const latest = useRef(0);
  const relinked = useRef(onRelinked);
  relinked.current = onRelinked;

  /** Read the issue again; resolves to whether that worked, for `useBackgroundRefresh`. */
  const reload = useCallback(async () => {
    if (!linkedKey) return true;
    const request = ++latest.current;
    try {
      const issue = await ticketApi.outsideIssue(ticketId);
      if (request !== latest.current) return true;
      // `source:id`, as `ticketKey` builds `linkedKey`.
      if (`${issue.kind}:${issue.record.ref?.key ?? ''}` !== linkedKey) {
        setState({ kind: 'loading' });
        relinked.current();
        return false;
      }
      setState({ kind: 'loaded', issue });
      return true;
    } catch (err) {
      // An issue already shown stays shown through a failed background read.
      const failed = failedState(err);
      if (request === latest.current) {
        setState((prev) =>
          failed.kind === 'unreachable' && prev.kind === 'loaded' ? prev : failed,
        );
      }
      return false;
    }
  }, [ticketId, linkedKey]);

  useEffect(() => {
    if (!linkedKey) {
      latest.current += 1;
      setState({ kind: 'none' });
      return;
    }
    setState({ kind: 'loading' });
    void reload();
  }, [linkedKey, reload]);

  const write = useCallback(
    async (
      edits: OutsideEdits,
      basedOn?: { issue: string; updated: string },
    ): Promise<string[]> => {
      if (state.kind !== 'loaded') return [];
      const { issue } = state;
      const request = ++latest.current;
      const result = await ticketApi.writeOutside(
        ticketId,
        basedOn ?? { issue: outsideIssueKey(issue), updated: issue.record.dates.updated ?? '' },
        edits,
      );
      if (request === latest.current) {
        setState({
          kind: 'loaded',
          issue: { ...issue, record: result.record, choices: result.choices },
        });
      }
      return result.mismatches;
    },
    [state, ticketId],
  );

  return { state, reload, write };
}
