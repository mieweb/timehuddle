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
  useRef,
  useState,
} from 'react';

import {
  teamApi,
  orgApi,
  enterpriseApi,
  clockApi,
  type Team,
  type ClockEvent,
  type TeamJoinRequest,
} from './api';
import { getDdpClient, ddpDocToClockEvent, ddpDocToTeam } from './ddp';
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
  const username = user?.username ?? null;

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
        setPendingRequests(result.pendingRequests ?? []);
      })
      .catch(() => {})
      .finally(() => setTeamsReady(true));
  }, []);

  const refetchEnterprises = useCallback(() => {
    if (!userId) {
      setEnterprises([]);
      return Promise.resolve();
    }
    return enterpriseApi
      .list()
      .then(setEnterprises)
      .catch(() => {});
  }, [userId]);

  const refetchOrganizations = useCallback(() => {
    if (!userId) {
      setOrganizations([]);
      return Promise.resolve();
    }
    return orgApi
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
  }, [refetchOrganizations, teamsReady, username]);

  // Retry org fetch once if empty — handles race condition where
  // Accounts.onLogin auto-join hasn't completed when the first fetch fires.
  const orgRetryDone = useRef(false);
  useEffect(() => {
    if (!userId) {
      orgRetryDone.current = false;
      return;
    }
    if (organizations.length > 0 || orgRetryDone.current) return;
    orgRetryDone.current = true;
    const timer = setTimeout(refetchOrganizations, 1500);
    return () => clearTimeout(timer);
  }, [userId, organizations.length, refetchOrganizations]);

  // Real-time DDP subscription for team updates (replaces WebSocket)
  useEffect(() => {
    if (!userId) return;
    const ddp = getDdpClient();

    const applyLiveDocs = () => {
      const liveTeams = ddp.docs('teams').map(ddpDocToTeam);
      setTeams(
        liveTeams.sort((a, b) => {
          if (a.isPersonal !== b.isPersonal) return a.isPersonal ? -1 : 1;
          return a.name.localeCompare(b.name);
        }),
      );
    };

    const offChange = ddp.onCollectionChange('teams', applyLiveDocs);
    const unsubscribe = ddp.subscribe('teams.byUser', [], () => {
      applyLiveDocs();
      setTeamsReady(true);
    });

    return () => {
      offChange();
      unsubscribe();
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

    // Validate that selectedEnterpriseId is in the current enterprise list
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

  // ── Clock events via Meteor DDP (real-time) + REST fallback ─────────────

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

  // Initial fetch (fallback if the DDP connection fails)
  useEffect(() => {
    // Wait for token to be available before fetching
    if (localStorage.getItem('meteor_resume_token')) {
      void refetchClock();
    }
  }, [refetchClock]);

  // Real-time clock updates via the oplog-backed `clock.liveForTeams`
  // publication: any writer (Fastify REST, Meteor methods, Agenda auto
  // clock-out) pushes changes here — no server-side broadcast code.
  useEffect(() => {
    if (!userId || !selectedTeamId) {
      return;
    }

    const ddp = getDdpClient();

    const applyLiveDocs = () => {
      const userEvent =
        ddp
          .docs('clockevents')
          .map(ddpDocToClockEvent)
          .find((e) => e.userId === userId && e.teamId === selectedTeamId && !e.endTime) ?? null;
      if (userEvent) {
        setActiveClockEvent(userEvent);
        setClockReady(true);
      } else {
        // No active event for the selected team — clear only if the previous
        // event was for this team; a cross-team active event (from the REST
        // fallback) must survive.
        setActiveClockEvent((prev) => (prev && prev.teamId === selectedTeamId ? null : prev));
      }
    };

    const offChange = ddp.onCollectionChange('clockevents', applyLiveDocs);
    const unsubscribe = ddp.subscribe('clock.liveForTeams', [[selectedTeamId]], () => {
      applyLiveDocs();
      // Only refetch if we have a valid token — avoids 500 errors when
      // the subscription ready fires before auth is fully established
      if (localStorage.getItem('meteor_resume_token')) {
        void refetchClock();
      }
    });

    return () => {
      offChange();
      unsubscribe();
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
