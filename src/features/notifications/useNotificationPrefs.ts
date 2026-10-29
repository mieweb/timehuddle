/**
 * useNotificationPrefs — the signed-in user's notification preferences (#784),
 * with setters that update the screen first and undo the change if the save
 * fails. Shared by Settings › Notifications and the Huddle bell.
 */
import { useCallback, useEffect, useState } from 'react';

import {
  notificationPrefsApi,
  type HuddleTeamLevel,
  type NotificationPrefs,
  type NotificationPrefsPatch,
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
  return { events, teams: { ...prefs.teams, ...patch.teams } };
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

  /** Save `patch`; on failure put back `undo` and say so. */
  const save = useCallback((patch: NotificationPrefsPatch, undo: NotificationPrefsPatch) => {
    setPrefs((prev) => prev && applyPatch(prev, patch));
    setError(null);
    notificationPrefsApi.update(patch).catch(() => {
      setPrefs((prev) => prev && applyPatch(prev, undo));
      setError(NOTIFICATION_STRINGS.saveFailed);
    });
  }, []);

  const setEvent = useCallback(
    (key: string, device: NotificationDevice, on: boolean) =>
      save({ events: { [key]: { [device]: on } } }, { events: { [key]: { [device]: !on } } }),
    [save],
  );

  const teamLevel = useCallback(
    (teamId: string): HuddleTeamLevel => prefs?.teams[teamId] ?? DEFAULT_TEAM_LEVEL,
    [prefs],
  );

  const setTeamLevel = useCallback(
    (teamId: string, level: HuddleTeamLevel) =>
      save({ teams: { [teamId]: level } }, { teams: { [teamId]: teamLevel(teamId) } }),
    [save, teamLevel],
  );

  return { prefs, error, setEvent, teamLevel, setTeamLevel };
}
