/**
 * Where "Bring your recent tickets from … Fetch" fills an empty My Board from
 * (#734): every source the member has connected, the main Redmine, other
 * Redmine servers and GitHub alike, picked in a dropdown. Up to
 * `STARTER_LIMIT` of each picked source's open assigned issues go on the
 * board, each as the ticket carrying it.
 *
 * The main Redmine is filled the way it always was (`assignedStarter.ts`); the
 * others come from what their source offers before anything is typed
 * (`sources.search` with no text), so a new source joins with its definition.
 *
 * What the member left unpicked is remembered in the browser, per user: a new
 * source starts picked.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

import { sourcesApi, type SourceSearchAnswer, type SourceSearchIssue } from '../../lib/api';
import { BOARD_ASSIGNED_SKIPPED_KEY } from '../../lib/constants';

import { STARTER_LIMIT } from './assignedStarter';

/** The main Redmine's id in the picker: it is filled through its own path. */
export const MAIN_SOURCE = 'main';

export interface AssignedSource {
  /** `MAIN_SOURCE`, or the server's host. */
  id: string;
  label: string;
}

const skippedKey = (userId: string) => `${BOARD_ASSIGNED_SKIPPED_KEY}:${userId}`;

// Storage can be unavailable (private mode): the choice then lasts for the visit.
function readSkipped(userId: string | null): Set<string> {
  if (!userId) return new Set();
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(skippedKey(userId)) ?? '[]');
    return new Set(Array.isArray(stored) ? stored.filter((id) => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

function writeSkipped(userId: string | null, skipped: Set<string>): void {
  if (!userId) return;
  try {
    localStorage.setItem(skippedKey(userId), JSON.stringify([...skipped]));
  } catch {
    // Nothing to do: the choice still holds for this visit.
  }
}

/** The host of `url`, or null. */
function hostOf(url: string | null): string | null {
  try {
    return url ? new URL(url).hostname : null;
  } catch {
    return null;
  }
}

/**
 * The member's connected sources and which are picked. `mainBaseUrl` is the
 * main Redmine's, when connected. Asked only while `enabled` (an empty board).
 */
export function useAssignedSources(
  userId: string | null,
  mainBaseUrl: string | null,
  enabled: boolean,
): {
  sources: AssignedSource[];
  picked: string[];
  setPicked: (ids: string[]) => void;
} {
  const [others, setOthers] = useState<AssignedSource[]>([]);
  const [skipped, setSkipped] = useState(() => readSkipped(userId));

  useEffect(() => setSkipped(readSkipped(userId)), [userId]);

  useEffect(() => {
    if (!enabled || !userId) return;
    let live = true;
    sourcesApi
      .list()
      .then(({ servers, github }) => {
        if (!live) return;
        setOthers([
          ...servers
            .filter((server) => server.connected && !server.main)
            .map((server) => ({ id: server.host, label: server.host })),
          ...(github.connected ? [{ id: github.host, label: 'GitHub' }] : []),
        ]);
      })
      // Without the list, only the main Redmine is offered.
      .catch(() => live && setOthers([]));
    return () => {
      live = false;
    };
  }, [enabled, userId]);

  const sources = useMemo(
    () => [
      ...(mainBaseUrl ? [{ id: MAIN_SOURCE, label: hostOf(mainBaseUrl) ?? 'Redmine' }] : []),
      ...others,
    ],
    [mainBaseUrl, others],
  );

  // What's left unpicked is what's remembered, so a source connected later starts picked.
  const setPicked = useCallback(
    (ids: string[]) => {
      const next = new Set(sources.map((source) => source.id).filter((id) => !ids.includes(id)));
      writeSkipped(userId, next);
      setSkipped(next);
    },
    [sources, userId],
  );

  const picked = useMemo(
    () => sources.map((source) => source.id).filter((id) => !skipped.has(id)),
    [sources, skipped],
  );

  return { sources, picked, setPicked };
}

/**
 * Up to `limit` assigned issues from each of `hosts`' answers that aren't on
 * the board yet: `onBoard` says whether an issue's ticket in the current team
 * already is.
 */
export function pickAssigned(
  answers: readonly SourceSearchAnswer[],
  hosts: readonly string[],
  onBoard: (issue: SourceSearchIssue) => boolean,
  limit = STARTER_LIMIT,
): Array<{ host: string; issue: SourceSearchIssue }> {
  return answers
    .filter((answer) => hosts.includes(answer.host) && !answer.failed)
    .flatMap((answer) =>
      answer.issues
        .filter((issue) => !onBoard(issue))
        .slice(0, limit)
        .map((issue) => ({ host: answer.host, issue })),
    );
}
