/**
 * What the search bar's text finds on the member's other connected servers
 * (#734 step 8), asked beside the main Redmine and the member's own tickets so
 * none waits on another. Same timing as they use, and only the latest answer is
 * kept. Text and results live in memory only: a search term may be a patient's name.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { sourcesApi, type SourceSearchAnswer } from '../../../lib/api';

import { SEARCH_DEBOUNCE_MS, isCompleteQuery, shouldSearchServer } from './suggestions';

const NONE: SourceSearchAnswer[] = [];

export function useSourceSearch(userId: string | null, query: string) {
  const [servers, setServers] = useState(NONE);
  const [settled, setSettled] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const text = query.trim();
    const current = ++seq.current;
    setServers(NONE);
    setSettled(false);
    // With no text yet, a source may offer what's assigned to the member.
    if (!userId || (text && !shouldSearchServer(text))) return;
    const timer = window.setTimeout(
      () => {
        sourcesApi
          .search(text)
          .then((answer) => {
            if (current === seq.current) setServers(answer.servers);
          })
          // A failed ask shows nothing from these servers; the next keystroke asks again.
          .catch(() => undefined)
          .finally(() => {
            if (current === seq.current) setSettled(true);
          });
      },
      !text || isCompleteQuery(text) ? 0 : SEARCH_DEBOUNCE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [userId, query]);

  /** Remember the ticket an action just made, so the row acts on it from now on. */
  const noteTicket = useCallback(
    (host: string, url: string, ticket: { id: string; teamId: string }) => {
      setServers((prev) =>
        prev.map((server) =>
          server.host !== host
            ? server
            : {
                ...server,
                issues: server.issues.map((issue) =>
                  issue.url === url ? { ...issue, tickets: [...issue.tickets, ticket] } : issue,
                ),
              },
        ),
      );
    },
    [],
  );

  return { servers, settled, noteTicket };
}
