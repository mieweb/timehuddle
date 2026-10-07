/**
 * TeamContext — Shared selected-team state.
 *
 * Teams and clock events are fetched via REST from timecore.
 *
 * Provides:
 *   • teams            — all teams the user belongs to (REST)
 *   • teamsReady       — true once the first fetch completes
 *   • refetchTeams     — callable after mutations to refresh the list
 *   • selectedTeamId   — the URL's ?team= when present, else the last pick
 *                        persisted in localStorage (see src/ui/ROUTING.md)
 *   • teamAccess       — 'forbidden' when ?team= names a team the user isn't in
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
import {
  liveLocation,
  matchPath,
  useQueryParams,
  useRouter,
  withQuery,
  type QueryPatch,
} from '../ui/router';

const TEAM_KEY = 'app:selectedTeamId';
const ORG_KEY = 'app:selectedOrgId';
const ENTERPRISE_KEY = 'app:selectedEnterpriseId';

/**
 * The Teams page names its team in the path rather than in `?team=`. Resource
 * paths generally (a ticket, a profile, a team page) already name their own
 * scope, so they are absent from the allow-list below and never get stamped.
 */
const TEAM_PAGE = '/app/teams/:teamId';

/**
 * The pages whose content is actually scoped to the selected team. An
 * allow-list, not "every `/app/` page": stamping `?team=` onto Settings or
 * Release Notes put a team id — often a personal one — into links that have
 * nothing to do with a team, and the recipient got a no-access page.
 */
const TEAM_SCOPED_PATHS = new Set([
  '/app/activity',
  '/app/clock',
  '/app/dashboard',
  '/app/huddle',
  '/app/teams',
  '/app/tickets',
  '/app/work',
]);

/** Whether the selected team belongs in this path's `?team=`. */
export function carriesTeamScope(pathname: string): boolean {
  return TEAM_SCOPED_PATHS.has(pathname);
}

/**
 * `ok` — no team in the URL, or the user is a member of it.
 * `pending` — the URL names a team and the team list hasn't loaded yet.
 * `forbidden` — the URL names a team the user doesn't belong to (or that
 *   doesn't exist). Pages must show a no-access state, never another team.
 */
export type TeamAccess = 'ok' | 'pending' | 'forbidden';

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
  /** All teams the user belongs to, across every org (not scoped to selectedOrgId). */
  allTeams: Team[];
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
  /**
   * Selects a team and moves the URL with it. Pass `team` when it was just
   * created or joined, so it counts as the user's before the list refetches.
   */
  setSelectedTeamId: (id: string, team?: Team) => void;
  teamAccess: TeamAccess;
  /** 'forbidden' when `?org=` names an organization the user isn't in. */
  orgAccess: TeamAccess;
  isAdmin: boolean;
  activeClockEvent: ClockEvent | null;
  clockReady: boolean;
  refetchClock: () => void;
  currentTime: number;
}

const TeamCtx = createContext<TeamContextValue>({
  pendingRequests: [],
  teams: [],
  allTeams: [],
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
  teamAccess: 'ok',
  orgAccess: 'ok',
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

  // True once the authoritative org fetch resolves; gates the session seed.
  const orgsLoadedRef = useRef(false);
  // The same fact as state, because `orgAccess` below is read during render.
  const [orgsReady, setOrgsReady] = useState(false);

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
      orgsLoadedRef.current = false;
      setOrgsReady(false);
      return Promise.resolve();
    }
    return orgApi
      .listOrganizations()
      .then((orgs) => {
        orgsLoadedRef.current = true;
        setOrganizations(orgs);
      })
      .catch(() => {})
      .finally(() => setOrgsReady(true));
  }, [userId]);

  // Seed from the session's already-loaded org list so the header scope shows
  // the organization immediately, and still shows it if the independent fetch
  // is slow or fails. Only applies until the independent fetch resolves, so it
  // never masks a genuine "removed from all orgs" result.
  const sessionOrgs = user?.organizations;
  useEffect(() => {
    if (orgsLoadedRef.current || !sessionOrgs?.length) return;
    setOrganizations((prev) => (prev.length > 0 ? prev : sessionOrgs));
  }, [sessionOrgs]);

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

    // The subscription streams team docs in one at a time. Publishing each
    // intermediate state would repeatedly replace `teams` with a partial list,
    // and the "pick first available" effects below would treat the still-absent
    // selected team as gone and silently reset the selection. Hold updates
    // until the subscription signals ready, then track changes live.
    //
    // The same race happens again after a reconnect (e.g. an idle websocket
    // timing out): the client drops all cached docs and re-streams them one
    // by one, so `subReady` must be reset the instant the socket drops and
    // only flip back on once the re-subscription's `ready` arrives — otherwise
    // a stray partial list (often just the personal team) briefly overwrites
    // `teams` and silently switches the user's selection back to Personal.
    let subReady = false;

    const applyLiveDocs = () => {
      if (!subReady) return;
      const liveTeams = ddp.docs('teams').map(ddpDocToTeam);
      setTeams(
        liveTeams.sort((a, b) => {
          if (a.isPersonal !== b.isPersonal) return a.isPersonal ? -1 : 1;
          return a.name.localeCompare(b.name);
        }),
      );
    };

    const offDisconnect = ddp.onDisconnect(() => {
      subReady = false;
    });
    const offChange = ddp.onCollectionChange('teams', applyLiveDocs);
    const unsubscribe = ddp.subscribe('teams.byUser', [], () => {
      subReady = true;
      applyLiveDocs();
      setTeamsReady(true);
    });

    return () => {
      offDisconnect();
      offChange();
      unsubscribe();
    };
  }, [userId]);

  // ── Selected team ───────────────────────────────────────────────────────────

  // The last pick, persisted per user. Only a fallback: the URL wins.
  const [storedTeamId, setStoredTeamId] = useState<string | null>(null);
  const [selectedEnterpriseId, _setSelectedEnterpriseId] = useState<string | null>(null);
  const [storedOrgId, setStoredOrgId] = useState<string | null>(null);

  // Which user's persisted selection has been read back into state. The
  // "pick first available" effects below must not run before this matches
  // `userId` — on the commit where `userId` first resolves they would still
  // see the pre-restore `null` and overwrite the saved selection.
  const [restoredForUser, setRestoredForUser] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!userId) {
      setStoredTeamId(null);
      setStoredOrgId(null);
      setRestoredForUser(null);
      return;
    }

    // Backward compatibility: fall back to the legacy global key once.
    const scoped = localStorage.getItem(getUserTeamKey(userId));
    const legacy = localStorage.getItem(TEAM_KEY);
    setStoredTeamId(scoped ?? legacy);

    const scopedEnterprise = localStorage.getItem(getUserEnterpriseKey(userId));
    const legacyEnterprise = localStorage.getItem(ENTERPRISE_KEY);
    _setSelectedEnterpriseId(scopedEnterprise ?? legacyEnterprise);

    const scopedOrg = localStorage.getItem(getUserOrgKey(userId));
    const legacyOrg = localStorage.getItem(ORG_KEY);
    setStoredOrgId(scopedOrg ?? legacyOrg);

    setRestoredForUser(userId);
  }, [userId]);

  // ── Scope from the URL ──────────────────────────────────────────────────────
  // `/app/teams/:teamId`, `?team=` (legacy alias `?teamId=`) and `?org=`
  // override the stored pick. A URL team also implies its org, so a link into
  // another org's team opens in that org without the page having to switch it.

  const { pathname, replace } = useRouter();
  const { params, setParams } = useQueryParams();
  const pathTeamId = matchPath(TEAM_PAGE, pathname)?.teamId ?? null;
  const urlTeamId =
    pathTeamId ??
    (carriesTeamScope(pathname) ? params.get('team') || params.get('teamId') || null : null);
  const urlOrgId = params.get('org') || null;
  const teamsLoaded = teamsReady && teams.length > 0;
  const urlTeam = urlTeamId ? (teams.find((t) => t.id === urlTeamId) ?? null) : null;

  const selectedTeamId = urlTeamId ?? storedTeamId;
  const selectedOrgId = urlTeam?.orgId ?? urlOrgId ?? storedOrgId;
  const teamAccess: TeamAccess =
    !urlTeamId || urlTeam ? 'ok' : teamsLoaded ? 'forbidden' : 'pending';

  // `?org=` only speaks for itself when no URL team already implies an org.
  // Like a URL team, an org the user isn't in is never swapped for one they
  // are in — the page says so instead, or every org link would silently open
  // the reader's own org with no scoped teams in it.
  const orgIsFromUrl = !!urlOrgId && !urlTeamId;
  const orgAccess: TeamAccess = !orgIsFromUrl
    ? 'ok'
    : organizations.some((org) => org.id === urlOrgId)
      ? 'ok'
      : orgsReady
        ? 'forbidden'
        : 'pending';

  /** Makes `id` (and its org) the persisted fallback for URLs without `?team=`. */
  const rememberTeam = useCallback(
    (id: string, orgId: string | undefined) => {
      setStoredTeamId(id);
      if (orgId) setStoredOrgId(orgId);
      if (!userId || typeof window === 'undefined') return;
      localStorage.setItem(getUserTeamKey(userId), id);
      if (orgId) localStorage.setItem(getUserOrgKey(userId), orgId);
    },
    [userId],
  );

  const setSelectedTeamId = useCallback(
    (id: string, team?: Team) => {
      // A just-created or just-joined team isn't in the list until the next
      // fetch; without this its URL would read as forbidden in the meantime.
      if (team && !teams.some((t) => t.id === team.id)) setTeams((prev) => [...prev, team]);
      const orgId = team?.orgId ?? teams.find((t) => t.id === id)?.orgId;
      rememberTeam(id, orgId);

      // A URL that names the scope must follow the pick, or the URL would keep
      // overriding it. An `?org=` that no longer matches the team is dropped.
      if (pathTeamId) {
        replace(withQuery(`/app/teams/${id}`, liveLocation().search, {}));
      } else if (urlTeamId || urlOrgId || carriesTeamScope(pathname)) {
        const patch: QueryPatch = { team: id, teamId: null };
        if (urlOrgId && orgId !== urlOrgId) patch.org = null;
        setParams(patch);
      }
    },
    [teams, rememberTeam, pathTeamId, urlTeamId, urlOrgId, pathname, replace, setParams],
  );

  // A team opened from a link becomes the remembered one too, so following a
  // sidebar link (which carries no `?team=`) stays on it.
  useEffect(() => {
    if (!urlTeam || restoredForUser !== userId || urlTeam.id === storedTeamId) return;
    rememberTeam(urlTeam.id, urlTeam.orgId);
  }, [urlTeam, restoredForUser, userId, storedTeamId, rememberTeam]);

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
      setStoredOrgId(id);
      if (userId && typeof window !== 'undefined') {
        localStorage.setItem(getUserOrgKey(userId), id);
      }
      // The URL's team belongs to the old org, so it goes; the "pick first
      // available" effect then selects a team in the new org.
      if (pathTeamId) {
        replace(withQuery('/app/teams', liveLocation().search, {}));
      } else if (urlTeamId || urlOrgId) {
        setParams({ team: null, teamId: null, org: urlOrgId ? id : null });
      }
    },
    [userId, pathTeamId, urlTeamId, urlOrgId, replace, setParams],
  );

  useEffect(() => {
    if (!userId || restoredForUser !== userId || enterprises.length === 0) {
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
  }, [enterprises, selectedEnterpriseId, setSelectedEnterpriseId, userId, restoredForUser]);

  const scopedTeams = useMemo(
    () => (selectedOrgId ? teams.filter((team) => team.orgId === selectedOrgId) : teams),
    [teams, selectedOrgId],
  );

  useEffect(() => {
    if (!userId || restoredForUser !== userId || organizations.length === 0) return;
    // An org named by the URL is never silently swapped for another.
    if (urlTeamId || urlOrgId) return;

    const hasSelectedOrg = selectedOrgId
      ? organizations.some((org) => org.id === selectedOrgId)
      : false;
    if (!hasSelectedOrg) {
      setSelectedOrgId(organizations[0].id);
    }
  }, [
    organizations,
    selectedOrgId,
    setSelectedOrgId,
    userId,
    restoredForUser,
    urlTeamId,
    urlOrgId,
  ]);

  // Ensure selected team belongs to the current user; otherwise pick first available.
  // A team named by the URL is never replaced: if the user can't see it,
  // `teamAccess` says so and the page shows a no-access state instead.
  useEffect(() => {
    if (!userId || restoredForUser !== userId || scopedTeams.length === 0) return;
    if (urlTeamId) return;

    const hasSelected = selectedTeamId
      ? scopedTeams.some((team) => team.id === selectedTeamId)
      : false;

    if (!hasSelected) {
      setSelectedTeamId(scopedTeams[0].id);
    }
  }, [selectedTeamId, scopedTeams, setSelectedTeamId, userId, restoredForUser, urlTeamId]);

  const selectedTeam = useMemo(
    () => scopedTeams.find((t) => t.id === selectedTeamId) ?? null,
    [scopedTeams, selectedTeamId],
  );

  // Stamp the selected team onto team-scoped URLs that lack it (sidebar links,
  // notifications, a bare /app/dashboard) and normalise `?teamId=` to `?team=`,
  // so every link copied from the address bar reopens the same team. A bare
  // /app/teams goes to the selected team's own page instead.
  useEffect(() => {
    // Only a team that's in scope: right after an org switch the stored team
    // still belongs to the old org until "pick first available" replaces it.
    if (!selectedTeam) return;
    if (pathname === '/app/teams') {
      replace(
        withQuery(`/app/teams/${selectedTeam.id}`, liveLocation().search, {
          team: null,
          teamId: null,
        }),
      );
      return;
    }
    if (!carriesTeamScope(pathname)) return;
    if (params.get('team') === selectedTeam.id && !params.has('teamId')) return;
    setParams({ team: selectedTeam.id, teamId: null });
  }, [selectedTeam, pathname, params, replace, setParams]);

  const isAdmin = useMemo(() => {
    if (!userId || !selectedTeam) return false;
    if (selectedTeam.admins.includes(userId)) return true;
    // Org owners get full team-admin authority on every team in their org.
    const org = organizations.find((o) => o.id === selectedTeam.orgId);
    return org?.role === 'owner';
  }, [userId, selectedTeam, organizations]);

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
      allTeams: teams,
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
      teamAccess,
      orgAccess,
      isAdmin,
      activeClockEvent,
      clockReady,
      refetchClock,
      currentTime,
    }),
    [
      scopedTeams,
      teams,
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
      teamAccess,
      orgAccess,
      isAdmin,
      activeClockEvent,
      clockReady,
      refetchClock,
      currentTime,
    ],
  );

  return <TeamCtx.Provider value={value}>{children}</TeamCtx.Provider>;
};
