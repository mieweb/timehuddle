/**
 * TeamContext — Shared selected-team state.
 *
 * Teams are now fetched via REST from timecore (Phase 3).
 * Clock events still use Meteor subscriptions (Phase 5 will migrate them).
 *
 * Provides:
 *   • teams           — all teams the user belongs to (REST)
 *   • teamsReady      — true once the first fetch completes
 *   • refetchTeams    — callable after mutations to refresh the list
 *   • selectedTeamId  — persisted in localStorage
 *   • activeClockEvent — the user's current open clock event (still Meteor)
 *   • currentTime     — ticks every second for live timers
 */
import { useFind, useSubscribe } from 'meteor/react-meteor-data';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import type { ClockEventDoc } from '../features/clock/schema';
import { ClockEvents } from '../features/clock/api';
import { teamApi, type Team } from './api';
import { useSession } from './useSession';

const TEAM_KEY = 'app:selectedTeamId';

export interface TeamContextValue {
  teams: Team[];
  teamsReady: boolean;
  refetchTeams: () => void;
  selectedTeamId: string | null;
  selectedTeam: Team | null;
  setSelectedTeamId: (id: string) => void;
  isAdmin: boolean;
  activeClockEvent: ClockEventDoc | null;
  clockReady: boolean;
  currentTime: number;
}

const TeamCtx = createContext<TeamContextValue>({
  teams: [],
  teamsReady: false,
  refetchTeams: () => {},
  selectedTeamId: null,
  selectedTeam: null,
  setSelectedTeamId: () => {},
  isAdmin: false,
  activeClockEvent: null,
  clockReady: false,
  currentTime: Date.now(),
});

export const useTeam = () => useContext(TeamCtx);

export const TeamProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useSession();
  const userId = user?.id ?? null;

  // ── Teams via REST ──────────────────────────────────────────────────────────

  const [teams, setTeams] = useState<Team[]>([]);
  const [teamsReady, setTeamsReady] = useState(false);

  const refetchTeams = useCallback(() => {
    teamApi
      .getTeams()
      .then(setTeams)
      .catch(() => {})
      .finally(() => setTeamsReady(true));
  }, []);

  useEffect(() => {
    if (!userId) return;
    // Ensure a personal workspace exists (idempotent), then load teams
    teamApi
      .ensurePersonal()
      .catch(() => {})
      .finally(() => refetchTeams());
  }, [userId, refetchTeams]);

  // ── Selected team ───────────────────────────────────────────────────────────

  const [selectedTeamId, _setSelectedTeamId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(TEAM_KEY);
  });

  const setSelectedTeamId = useCallback((id: string) => {
    _setSelectedTeamId(id);
    localStorage.setItem(TEAM_KEY, id);
  }, []);

  // Auto-select first team when none selected
  useEffect(() => {
    if (!selectedTeamId && teams.length > 0) {
      setSelectedTeamId(teams[0].id);
    }
  }, [selectedTeamId, teams, setSelectedTeamId]);

  const selectedTeam = useMemo(
    () => teams.find((t) => t.id === selectedTeamId) ?? null,
    [teams, selectedTeamId],
  );

  const isAdmin = useMemo(
    () => !!(userId && selectedTeam?.admins.includes(userId)),
    [userId, selectedTeam],
  );

  // ── Clock events (still Meteor — Phase 5) ──────────────────────────────────

  const clockLoading = useSubscribe('clockEventsForUser');

  const activeClockEvent =
    useFind(
      () =>
        ClockEvents.find(
          { userId: userId ?? '__none__', teamId: selectedTeamId ?? '__none__', endTime: null },
          { limit: 1 },
        ),
      [userId, selectedTeamId],
    )?.[0] ?? null;

  // ── Live timer ──────────────────────────────────────────────────────────────

  const [currentTime, setCurrentTime] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setCurrentTime(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // ── Context value ───────────────────────────────────────────────────────────

  const value = useMemo<TeamContextValue>(
    () => ({
      teams,
      teamsReady,
      refetchTeams,
      selectedTeamId,
      selectedTeam,
      setSelectedTeamId,
      isAdmin,
      activeClockEvent,
      clockReady: !clockLoading(),
      currentTime,
    }),
    [
      teams,
      teamsReady,
      refetchTeams,
      selectedTeamId,
      selectedTeam,
      setSelectedTeamId,
      isAdmin,
      activeClockEvent,
      clockLoading,
      currentTime,
    ],
  );

  return <TeamCtx.Provider value={value}>{children}</TeamCtx.Provider>;
};
