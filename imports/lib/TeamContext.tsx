/**
 * TeamContext — Shared selected-team state.
 *
 * Teams and clock events are fetched via REST from timecore.
 *
 * Provides:
 *   • teams            — all teams the user belongs to (REST)
 *   • teamsReady       — true once the first fetch completes
 *   • refetchTeams     — callable after mutations to refresh the list
 *   • selectedTeamId   — persisted in localStorage
 *   • activeClockEvent — the user's current open clock event (REST)
 *   • clockReady       — true once the first clock fetch completes
 *   • refetchClock     — callable after clock mutations to refresh
 *   • currentTime      — ticks every second for live timers
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { teamApi, clockApi, type Team, type ClockEvent } from './api';
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
  activeClockEvent: ClockEvent | null;
  clockReady: boolean;
  refetchClock: () => void;
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
  refetchClock: () => {},
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

  // ── Clock events via REST ───────────────────────────────────────────────────

  const [activeClockEvent, setActiveClockEvent] = useState<ClockEvent | null>(null);
  const [clockReady, setClockReady] = useState(false);

  const refetchClock = useCallback(async () => {
    if (!userId) {
      setActiveClockEvent(null);
      setClockReady(true);
      return;
    }
    try {
      const event = await clockApi.getActive();
      setActiveClockEvent(event);
    } catch {
      setActiveClockEvent(null);
    } finally {
      setClockReady(true);
    }
  }, [userId]);

  useEffect(() => {
    void refetchClock();
  }, [refetchClock, selectedTeamId]);

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
      clockReady,
      refetchClock,
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
      clockReady,
      refetchClock,
      currentTime,
    ],
  );

  return <TeamCtx.Provider value={value}>{children}</TeamCtx.Provider>;
};
