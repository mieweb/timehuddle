/**
 * useNotificationPrefs — the signed-in user's notification preferences (#784),
 * with setters that update the screen first and undo the change if the save
 * fails. Shared by Settings › Notifications and the Huddle bell.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  currentSessionKey,
  notificationPrefsApi,
  type HuddleTeamLevel,
  type NotificationPrefs,
  type NotificationPrefsPatch,
  type NotificationQuiet,
} from '../../lib/api';
import { NOTIFICATION_STRINGS, type NotificationDevice } from './notificationCopy';

/** The level a team has when the user never set one — matches the server's default. */
export const DEFAULT_TEAM_LEVEL: HuddleTeamLevel = 'mentions';

/** `patch` applied to `prefs` locally, the way the server will apply it. */
function applyPatch(prefs: NotificationPrefs, patch: NotificationPrefsPatch): NotificationPrefs {
  const events = { ...prefs.events };
  for (const [key, devices] of Object.entries(patch.events ?? {})) {
    events[key] = { ...events[key], ...devices };
  }
  return {
    ...prefs,
    events,
    teams: { ...prefs.teams, ...patch.teams },
    quiet: { ...prefs.quiet, ...patch.quiet },
  };
}

export function useNotificationPrefs() {
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    notificationPrefsApi
      .get()
      .then((loaded) => live && setPrefs(loaded))
      .catch(() => live && setError(NOTIFICATION_STRINGS.loadFailed));
    return () => {
      live = false;
    };
  }, []);

  // Saves go to the server one at a time, in the order they were made: sent
  // together, a slow earlier save could land after a later one and win.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  // The newest save per setting, so a failed older one can't undo a newer choice.
  const latest = useRef(new Map<string, number>());
  const counter = useRef(0);

  /** Save `patch` (which changes `field`); on failure put back `undo` and say so. */
  const save = useCallback(
    (field: string, patch: NotificationPrefsPatch, undo: NotificationPrefsPatch) => {
      const mine = ++counter.current;
      latest.current.set(field, mine);
      setPrefs((prev) => prev && applyPatch(prev, patch));
      setError(null);
      const session = currentSessionKey();
      queue.current = queue.current.then(() => {
        // Signed out, or someone else signed in, while this waited its turn:
        // the change belongs to the old account, so don't send it.
        if (currentSessionKey() !== session) return undefined;
        return notificationPrefsApi.update(patch).catch(() => {
          if (latest.current.get(field) !== mine) return;
          setPrefs((prev) => prev && applyPatch(prev, undo));
          setError(NOTIFICATION_STRINGS.saveFailed);
        });
      });
    },
    [],
  );

  const setEvent = useCallback(
    (key: string, device: NotificationDevice, on: boolean) =>
      save(
        `events.${key}.${device}`,
        { events: { [key]: { [device]: on } } },
        { events: { [key]: { [device]: !on } } },
      ),
    [save],
  );

  const teamLevel = useCallback(
    (teamId: string): HuddleTeamLevel => prefs?.teams[teamId] ?? DEFAULT_TEAM_LEVEL,
    [prefs],
  );

  const setTeamLevel = useCallback(
    (teamId: string, level: HuddleTeamLevel) =>
      save(
        `teams.${teamId}`,
        { teams: { [teamId]: level } },
        { teams: { [teamId]: teamLevel(teamId) } },
      ),
    [save, teamLevel],
  );

  const setQuiet = useCallback(
    (change: Partial<NotificationQuiet>) => {
      if (!prefs) return;
      const undo = Object.fromEntries(
        Object.keys(change).map((field) => [field, prefs.quiet[field as keyof NotificationQuiet]]),
      );
      save(`quiet.${Object.keys(change).sort().join(',')}`, { quiet: change }, { quiet: undo });
    },
    [prefs, save],
  );

  return { prefs, error, setEvent, teamLevel, setTeamLevel, setQuiet };
}
