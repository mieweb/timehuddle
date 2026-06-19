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
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import {
  teamApi,
  orgApi,
  enterpriseApi,
  clockApi,
  type Team,
  type ClockEvent,
  type TeamJoinRequest,
} from './api';
import { useSession } from './useSession';

const TEAM_KEY = 'app:selectedTeamId';
const ORG_KEY = 'app:selectedOrgId';
const ENTERPRISE_KEY = 'app:selectedEnterpriseId';

function getUserTeamKey(userId: string): string {
  return `${TEAM_KEY}:${userId}`;
}

function getUserOrgKey(userId: string): string {
  return `${ORG_KEY}:${userId}`;
}

function getUserEnterpriseKey(userId: string): string {
  return `${ENTERPRISE_KEY}:${userId}`;
}

type EnterpriseSummary = {
  id: string;
  name: string;
  slug: string;
  role: 'owner' | 'admin';
};

export interface TeamContextValue {
  teams: Team[];
  pendingRequests: TeamJoinRequest[];
  enterprises: EnterpriseSummary[];
  organizations: Array<{
    id: string;
    enterpriseId: string | null;
    name: string;
    slug: string;
    allowAutoJoin: boolean;
    role: 'owner' | 'admin' | 'member' | null;
  }>;
  teamsReady: boolean;
  refetchTeams: () => void;
  refetchEnterprises: () => void;
  refetchOrganizations: () => void;
  selectedEnterpriseId: string | null;
  setSelectedEnterpriseId: (id: string) => void;
  selectedOrgId: string | null;
  setSelectedOrgId: (id: string) => void;
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
  pendingRequests: [],
  teams: [],
  enterprises: [],
  organizations: [],
  teamsReady: false,
  refetchTeams: () => {},
  refetchEnterprises: () => {},
  refetchOrganizations: () => {},
  selectedEnterpriseId: null,
  setSelectedEnterpriseId: () => {},
  selectedOrgId: null,
  setSelectedOrgId: () => {},
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
  const [pendingRequests, setPendingRequests] = useState<TeamJoinRequest[]>([]);
  const [enterprises, setEnterprises] = useState<EnterpriseSummary[]>([]);
  const [organizations, setOrganizations] = useState<
    Array<{
      id: string;
      enterpriseId: string | null;
      name: string;
      slug: string;
      allowAutoJoin: boolean;
      role: 'owner' | 'admin' | 'member' | null;
    }>
  >([]);
  const [teamsReady, setTeamsReady] = useState(false);

  const refetchTeams = useCallback(() => {
    teamApi
      .getTeams()
      .then((result) => {
        setTeams(result.teams);
        setPendingRequests(result.pendingRequests);
      })
      .catch(() => {})
      .finally(() => setTeamsReady(true));
  }, []);

  const refetchEnterprises = useCallback(() => {
    if (!userId) {
      setEnterprises([]);
      return;
    }
    enterpriseApi
      .list()
      .then(setEnterprises)
      .catch(() => {});
  }, [userId]);

  const refetchOrganizations = useCallback(() => {
    if (!userId) {
      setOrganizations([]);
      return;
    }
    orgApi
      .listOrganizations()
      .then(setOrganizations)
      .catch(() => {});
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    // Ensure a personal workspace exists (idempotent), then load teams
    teamApi
      .ensurePersonal()
      .catch(() => {})
      .finally(() => refetchTeams());
  }, [userId, refetchTeams]);

  useEffect(() => {
    refetchEnterprises();
  }, [refetchEnterprises]);

  useEffect(() => {
    refetchOrganizations();
  }, [refetchOrganizations, teamsReady]);

  // Real-time WebSocket connection for team updates
  useEffect(() => {
    if (!userId) return;

    const ws = teamApi.openLiveStream();

    ws.onmessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'snapshot') {
          // Initial snapshot: replace teams and pending requests state
          const newTeams = data.teams as Team[];
          const newPendingRequests = (data.pendingRequests ?? []) as TeamJoinRequest[];
          setTeams(newTeams);
          setPendingRequests(newPendingRequests);
          setTeamsReady(true);
        } else if (data.type === 'update') {
          // Real-time team update — upsert by id
          const updatedTeam = data.team as Team;
          setTeams((prev) => {
            const idx = prev.findIndex((t) => t.id === updatedTeam.id);
            if (idx >= 0) {
              const copy = [...prev];
              copy[idx] = updatedTeam;
              return copy;
            }
            return [...prev, updatedTeam];
          });
        } else if (data.type === 'delete') {
          // Team deleted — remove from state
          setTeams((prev) => prev.filter((t) => t.id !== data.teamId));
        } else if (data.type === 'pending-requests') {
          // Real-time pending requests update
          const newPendingRequests = data.pendingRequests as TeamJoinRequest[];
          setPendingRequests(newPendingRequests);
        }
      } catch (err) {
        console.warn('Failed to parse teams WebSocket message:', err);
      }
    };

    // Cleanup: close WebSocket when userId changes or component unmounts
    return () => {
      ws.close();
    };
  }, [userId]);

  // ── Selected team ───────────────────────────────────────────────────────────

  const [selectedTeamId, _setSelectedTeamId] = useState<string | null>(null);
  const [selectedEnterpriseId, _setSelectedEnterpriseId] = useState<string | null>(null);
  const [selectedOrgId, _setSelectedOrgId] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!userId) {
      _setSelectedTeamId(null);
      _setSelectedOrgId(null);
      return;
    }

    // Backward compatibility: fall back to the legacy global key once.
    const scoped = localStorage.getItem(getUserTeamKey(userId));
    const legacy = localStorage.getItem(TEAM_KEY);
    _setSelectedTeamId(scoped ?? legacy);

    const scopedEnterprise = localStorage.getItem(getUserEnterpriseKey(userId));
    const legacyEnterprise = localStorage.getItem(ENTERPRISE_KEY);
    _setSelectedEnterpriseId(scopedEnterprise ?? legacyEnterprise);

    const scopedOrg = localStorage.getItem(getUserOrgKey(userId));
    const legacyOrg = localStorage.getItem(ORG_KEY);
    _setSelectedOrgId(scopedOrg ?? legacyOrg);
  }, [userId]);

  const setSelectedTeamId = useCallback(
    (id: string) => {
      _setSelectedTeamId(id);
      if (!userId || typeof window === 'undefined') return;
      localStorage.setItem(getUserTeamKey(userId), id);
    },
    [userId],
  );

  const setSelectedEnterpriseId = useCallback(
    (id: string) => {
      _setSelectedEnterpriseId(id);
      if (!userId || typeof window === 'undefined') return;
      localStorage.setItem(getUserEnterpriseKey(userId), id);
    },
    [userId],
  );

  const setSelectedOrgId = useCallback(
    (id: string) => {
      _setSelectedOrgId(id);
      if (!userId || typeof window === 'undefined') return;
      localStorage.setItem(getUserOrgKey(userId), id);
    },
    [userId],
  );

  useEffect(() => {
    if (!userId || enterprises.length === 0) {
      if (userId && enterprises.length === 0) {
        _setSelectedEnterpriseId(null);
      }
      return;
    }

    const hasSelectedEnterprise = selectedEnterpriseId
      ? enterprises.some((enterprise) => enterprise.id === selectedEnterpriseId)
      : false;
    if (!hasSelectedEnterprise) {
      setSelectedEnterpriseId(enterprises[0].id);
    }
  }, [enterprises, selectedEnterpriseId, setSelectedEnterpriseId, userId]);

  const scopedTeams = useMemo(
    () => (selectedOrgId ? teams.filter((team) => team.orgId === selectedOrgId) : teams),
    [teams, selectedOrgId],
  );

  useEffect(() => {
    if (!userId || organizations.length === 0) return;

    const hasSelectedOrg = selectedOrgId
      ? organizations.some((org) => org.id === selectedOrgId)
      : false;
    if (!hasSelectedOrg) {
      setSelectedOrgId(organizations[0].id);
    }
  }, [organizations, selectedOrgId, setSelectedOrgId, userId]);

  // Ensure selected team belongs to the current user; otherwise pick first available.
  useEffect(() => {
    if (!userId || scopedTeams.length === 0) return;

    const hasSelected = selectedTeamId
      ? scopedTeams.some((team) => team.id === selectedTeamId)
      : false;

    if (!hasSelected) {
      setSelectedTeamId(scopedTeams[0].id);
    }
  }, [selectedTeamId, scopedTeams, setSelectedTeamId, userId]);

  const selectedTeam = useMemo(
    () => scopedTeams.find((t) => t.id === selectedTeamId) ?? null,
    [scopedTeams, selectedTeamId],
  );

  const isAdmin = useMemo(
    () => !!(userId && selectedTeam?.admins.includes(userId)),
    [userId, selectedTeam],
  );

  // ── Clock events via WebSocket (real-time) + REST fallback ─────────────────

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

  // Initial fetch (fallback if WebSocket connection fails)
  useEffect(() => {
    void refetchClock();
  }, [refetchClock]);

  // Real-time WebSocket connection for clock updates
  useEffect(() => {
    if (!userId || !selectedTeamId) {
      return;
    }

    const ws = clockApi.openLiveStream([selectedTeamId]);

    ws.onmessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'snapshot') {
          // Initial snapshot: find the current user's active event from the array
          const userEvent =
            data.events?.find(
              (e: ClockEvent) => e.userId === userId && e.teamId === selectedTeamId && !e.endTime,
            ) ?? null;
          if (userEvent) {
            setActiveClockEvent(userEvent);
            setClockReady(true);
          } else {
            // No active event for the selected team — check globally via REST,
            // since the user may be clocked in to a different team.
            void refetchClock();
          }
        } else if (data.type === 'update') {
          // Real-time update: apply if it's for the current user
          const updatedEvent = data.event as ClockEvent | null;
          if (
            updatedEvent &&
            updatedEvent.userId === userId &&
            updatedEvent.teamId === selectedTeamId
          ) {
            setActiveClockEvent(updatedEvent);
          } else if (!updatedEvent) {
            // Clock out (event is null) — clear active event if it was for this user/team
            setActiveClockEvent((prev) => {
              if (prev && prev.teamId === data.teamId) {
                return null;
              }
              return prev;
            });
          }
        }
      } catch (err) {
        // Ignore malformed messages
        console.warn('Failed to parse clock WebSocket message:', err);
      }
    };

    // Cleanup: close WebSocket connection when team changes or component unmounts
    return () => {
      ws.close();
    };
  }, [userId, selectedTeamId, refetchClock]);

  // ── Live timer ──────────────────────────────────────────────────────────────

  const [currentTime, setCurrentTime] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setCurrentTime(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // ── Context value ───────────────────────────────────────────────────────────

  const value = useMemo<TeamContextValue>(
    () => ({
      teams: scopedTeams,
      pendingRequests,
      enterprises,
      organizations,
      teamsReady,
      refetchTeams,
      refetchEnterprises,
      refetchOrganizations,
      selectedEnterpriseId,
      setSelectedEnterpriseId,
      selectedOrgId,
      setSelectedOrgId,
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
      scopedTeams,
      pendingRequests,
      enterprises,
      organizations,
      teamsReady,
      refetchTeams,
      refetchEnterprises,
      refetchOrganizations,
      selectedEnterpriseId,
      setSelectedEnterpriseId,
      selectedOrgId,
      setSelectedOrgId,
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
