/**
 * DashboardPage — Team overview dashboard (mobile-first, scrollable).
 *
 * Sections (stacked vertically for Capacitor):
 *   1. Quick stats: Hours today, Open tickets, Closed today, High priority
 *   2. Team members: Online/offline, clocked-in status, today's hours
 *   3. Active tickets: Only tickets with running timers, with the person who started each
 *   4. Time logged today: Per-member bar with hours
 *
 * The "Team" tab also offers a "Timesheet" view (admins only) — the
 * admin timesheet moved here from the Teams page to keep Teams focused on
 * membership/settings and keep time-tracking data alongside the rest of the
 * team's activity.
 *   • Deep-link support: ?tab=timesheet&teamId=XXX&memberId=YYY
 */
import {
  faClock,
  faTicket,
  faCheckCircle,
  faExclamationTriangle,
  faPlay,
  faUsers,
  faArrowRight,
  faPlus,
  faRightToBracket,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Spinner,
  Text,
} from '@mieweb/ui';
import React, { useCallback, useEffect, useState } from 'react';

import {
  ticketApi,
  type Ticket,
  teamApi,
  type TeamMember,
  type TimecoreUser,
  teamDashboardApi,
  type TeamMemberClockStatus,
  type TeamRunningTimer,
} from '../../lib/api';
import { useSession } from '../../lib/useSession';
import { useTeam } from '../../lib/TeamContext';
import { useRefresh } from '../../lib/RefreshContext';
import { formatDuration, formatTimer } from '../../lib/timeUtils';
import { useRouter } from '../../ui/router';
import { AppPage } from '../../ui/AppPage';
import { UserAvatar } from '../../ui/UserAvatar';
import { AdminTimesheetPanel } from '../teams/AdminTimesheetPanel';

const profilePath = (member: TeamMemberClockStatus) =>
  `/app/profile/${member.username ?? member.userId}`;

const userToTeamMember = (user: TimecoreUser): TeamMember => ({
  id: user.id,
  name: user.name,
  email: user.email,
  username: user.username,
  image: user.image ?? null,
});

// ─── DashboardPage ────────────────────────────────────────────────────────────

export const DashboardPage: React.FC = () => {
  const { user } = useSession();
  const { navigate } = useRouter();
  const {
    teams,
    teamsReady,
    activeClockEvent,
    currentTime,
    selectedTeamId,
    setSelectedTeamId,
    isAdmin,
  } = useTeam();

  const selectedTeam = teams.find((t) => t.id === selectedTeamId) ?? null;
  const teamAdminIds = new Set(selectedTeam?.admins ?? []);
  const canViewTimesheet = isAdmin && !selectedTeam?.isPersonal;

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [memberStatuses, setMemberStatuses] = useState<TeamMemberClockStatus[]>([]);
  const [runningTimers, setRunningTimers] = useState<TeamRunningTimer[]>([]);
  const [loading, setLoading] = useState(false);
  // "Me" is the default — a personal-team user sees their own numbers
  // immediately, and can switch to "Team" to see everyone (even if that's
  // still just themselves on a personal team; the tab is never hidden).
  const [tab, setTab] = useState<'me' | 'team'>('me');

  // "Overview" vs "Timesheet" sub-view for the "Me" tab.
  const [meView, setMeView] = useState<'overview' | 'timesheet'>('overview');

  // "Overview" vs "Timesheet" — only relevant on the "Team" tab for admins.
  // The admin timesheet lives here (moved from the Teams page) so Teams can
  // stay focused on membership/settings.
  const [teamView, setTeamView] = useState<'overview' | 'timesheet'>('overview');
  const [initialMemberId, setInitialMemberId] = useState<string>('');
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);

  // ── Deep-link support: ?tab=timesheet&teamId=&memberId= ──
  useEffect(() => {
    if (!teamsReady) return;
    const params = new URLSearchParams(window.location.search);
    const deepTab = params.get('tab');
    const memberId = params.get('memberId');
    const teamId = params.get('teamId');

    if (deepTab === 'timesheet') {
      setTab('team');
      setTeamView('timesheet');
    }
    if (memberId) setInitialMemberId(memberId);
    if (teamId && teams.some((t) => t.id === teamId)) setSelectedTeamId(teamId);

    if (deepTab || memberId || teamId) {
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, [teamsReady, teams, setSelectedTeamId]);

  // Members list (needed by the admin Timesheet view only)
  useEffect(() => {
    if (!selectedTeamId || !canViewTimesheet) {
      setTeamMembers([]);
      return;
    }
    let cancelled = false;
    teamApi
      .getMembers(selectedTeamId)
      .then((data) => {
        if (!cancelled) setTeamMembers(data);
      })
      .catch(() => {
        if (!cancelled) setTeamMembers([]);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedTeamId, canViewTimesheet]);

  // Fall back to "overview" if the user loses admin access or timesheet
  // isn't applicable to the currently selected team (e.g. switched to a
  // personal workspace).
  useEffect(() => {
    if (!canViewTimesheet && teamView === 'timesheet') setTeamView('overview');
  }, [canViewTimesheet, teamView]);

  const fetchData = useCallback(async () => {
    if (!user || !selectedTeamId) return;
    setLoading(true);
    try {
      const [t, m, r] = await Promise.all([
        ticketApi.getTickets(selectedTeamId).catch(() => [] as Ticket[]),
        teamDashboardApi
          .getTeamClockStatus(selectedTeamId)
          .catch(() => [] as TeamMemberClockStatus[]),
        teamDashboardApi.getTeamRunningTimers(selectedTeamId).catch(() => [] as TeamRunningTimer[]),
      ]);
      setTickets(t);
      setMemberStatuses(m);
      setRunningTimers(r);
    } finally {
      setLoading(false);
    }
  }, [user, selectedTeamId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useRefresh(fetchData);

  // ─── Derived stats ───────────────────────────────────────────────────────────

  const openTickets = tickets.filter((t) => t.status !== 'closed' && t.status !== 'done');
  const closedToday = tickets.filter((t) => {
    if (t.status !== 'closed' && t.status !== 'done') return false;
    if (!t.updatedAt) return false;
    const updated = new Date(t.updatedAt);
    const today = new Date();
    return (
      updated.getFullYear() === today.getFullYear() &&
      updated.getMonth() === today.getMonth() &&
      updated.getDate() === today.getDate()
    );
  });
  const highPriority = tickets.filter((t) => t.priority === 'high' || t.priority === 'urgent');
  const overdue = highPriority.filter((t) => t.status !== 'closed' && t.status !== 'done');
  const unassignedOpen = openTickets.filter((t) => !t.assignedTo);

  const todayTotalSeconds = memberStatuses.reduce((sum, m) => sum + m.todaySeconds, 0);
  const membersClocked = memberStatuses.filter((m) => m.isClockedIn);

  // ── "Me" tab: the same shapes, scoped to the signed-in user only ──────────
  const myStatus = memberStatuses.find((m) => m.userId === user?.id) ?? null;
  const myTickets = tickets.filter((t) => user && t.assignedTo.includes(user.id));
  const myOpenTickets = myTickets.filter((t) => t.status !== 'closed' && t.status !== 'done');
  const myClosedToday = myTickets.filter((t) => {
    if (t.status !== 'closed' && t.status !== 'done') return false;
    if (!t.updatedAt) return false;
    const updated = new Date(t.updatedAt);
    const today = new Date();
    return (
      updated.getFullYear() === today.getFullYear() &&
      updated.getMonth() === today.getMonth() &&
      updated.getDate() === today.getDate()
    );
  });
  const myHighPriority = myTickets.filter((t) => t.priority === 'high' || t.priority === 'urgent');
  const myOverdue = myHighPriority.filter((t) => t.status !== 'closed' && t.status !== 'done');
  const myRunningTimers = runningTimers.filter((t) => t.userId === user?.id);
  const visibleRunningTimers = tab === 'me' ? myRunningTimers : runningTimers;

  // Sort members: admins first, then clocked-in, then by hours
  const sortedMembers = [...memberStatuses].sort((a, b) => {
    const aIsAdmin = teamAdminIds.has(a.userId);
    const bIsAdmin = teamAdminIds.has(b.userId);
    if (aIsAdmin && !bIsAdmin) return -1;
    if (!aIsAdmin && bIsAdmin) return 1;
    if (a.isClockedIn && !b.isClockedIn) return -1;
    if (!a.isClockedIn && b.isClockedIn) return 1;
    return b.todaySeconds - a.todaySeconds;
  });

  const maxMemberSeconds = Math.max(...memberStatuses.map((m) => m.todaySeconds), 1);

  const isFirstTime = teams.length <= 1 && teams.every((t) => t.isPersonal);

  if (!teamsReady) {
    return (
      <div className="flex items-center justify-center p-12">
        <Spinner size="lg" label="Loading dashboard…" />
      </div>
    );
  }

  return (
    <AppPage
      titleActions={
        <div className="inline-flex rounded-full bg-neutral-100 p-1 dark:bg-neutral-800">
          <button
            type="button"
            onClick={() => setTab('me')}
            aria-pressed={tab === 'me'}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
              tab === 'me'
                ? 'bg-white text-neutral-900 shadow-sm dark:bg-neutral-700 dark:text-neutral-100'
                : 'text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300'
            }`}
          >
            Me
          </button>
          <button
            type="button"
            onClick={() => setTab('team')}
            aria-pressed={tab === 'team'}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
              tab === 'team'
                ? 'bg-white text-neutral-900 shadow-sm dark:bg-neutral-700 dark:text-neutral-100'
                : 'text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300'
            }`}
          >
            Team
          </button>
        </div>
      }
    >
      {/* ── Me / Timesheet toggle ─────────────────────────────────────── */}
      {tab === 'me' && (
        <div className="inline-flex rounded-full bg-neutral-100 p-1 dark:bg-neutral-800">
          <button
            type="button"
            onClick={() => setMeView('overview')}
            aria-pressed={meView === 'overview'}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
              meView === 'overview'
                ? 'bg-white text-neutral-900 shadow-sm dark:bg-neutral-700 dark:text-neutral-100'
                : 'text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300'
            }`}
          >
            Overview
          </button>
          <button
            type="button"
            onClick={() => setMeView('timesheet')}
            aria-pressed={meView === 'timesheet'}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
              meView === 'timesheet'
                ? 'bg-white text-neutral-900 shadow-sm dark:bg-neutral-700 dark:text-neutral-100'
                : 'text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300'
            }`}
          >
            Timesheet
          </button>
        </div>
      )}

      {/* ── Me Timesheet view ────────────────────────────────────────────── */}
      {tab === 'me' && meView === 'timesheet' && user && selectedTeamId && (
        <AdminTimesheetPanel
          members={[userToTeamMember(user)]}
          selectedTeamId={selectedTeamId}
          teams={teams}
          initialMemberId={user.id}
        />
      )}

      {/* ── Team / Timesheet toggle (admins, non-personal teams only) ───── */}
      {tab === 'team' && canViewTimesheet && (
        <div className="inline-flex rounded-full bg-neutral-100 p-1 dark:bg-neutral-800">
          <button
            type="button"
            onClick={() => setTeamView('overview')}
            aria-pressed={teamView === 'overview'}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
              teamView === 'overview'
                ? 'bg-white text-neutral-900 shadow-sm dark:bg-neutral-700 dark:text-neutral-100'
                : 'text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300'
            }`}
          >
            Overview
          </button>
          <button
            type="button"
            onClick={() => setTeamView('timesheet')}
            aria-pressed={teamView === 'timesheet'}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
              teamView === 'timesheet'
                ? 'bg-white text-neutral-900 shadow-sm dark:bg-neutral-700 dark:text-neutral-100'
                : 'text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300'
            }`}
          >
            Timesheet
          </button>
        </div>
      )}

      {/* ── Timesheet view (admins only) — replaces the overview below ──── */}
      {tab === 'team' && canViewTimesheet && teamView === 'timesheet' && selectedTeamId && (
        <AdminTimesheetPanel
          members={teamMembers}
          selectedTeamId={selectedTeamId}
          teams={teams}
          initialMemberId={initialMemberId}
        />
      )}

      {(tab === 'me' ? meView === 'overview' : teamView === 'overview') && (
        <>
          {/* ── First-time welcome ──────────────────────────────────────────── */}
          {isFirstTime && (
            <Card variant="outlined" padding="lg" className="text-center">
              <CardContent>
                <Text as="h2" size="lg" weight="semibold">
                  Welcome to TimeHuddle
                </Text>
                <Text variant="muted" size="sm" className="mt-2">
                  Get started by creating or joining a team, then clock in to start tracking time.
                </Text>
                <div className="mt-6 flex flex-wrap justify-center gap-3">
                  <Button
                    variant="primary"
                    leftIcon={<FontAwesomeIcon icon={faPlus} />}
                    onClick={() => navigate('/app/teams')}
                  >
                    Create Team
                  </Button>
                  <Button
                    variant="outline"
                    leftIcon={<FontAwesomeIcon icon={faRightToBracket} />}
                    onClick={() => navigate('/app/teams')}
                  >
                    Join Team
                  </Button>
                  <Button
                    variant="outline"
                    leftIcon={<FontAwesomeIcon icon={faClock} />}
                    onClick={() => navigate('/app/clock')}
                  >
                    Track Solo
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* ── Active session banner ───────────────────────────────────────── */}
          {activeClockEvent && (
            <Alert variant="success">
              <AlertTitle>
                <span className="flex items-center gap-2">
                  <span className="h-3 w-3 animate-pulse rounded-full bg-green-500 shrink-0" />
                  Session Active
                </span>
              </AlertTitle>
              <AlertDescription>
                {formatTimer(Math.floor((currentTime - activeClockEvent.startTime) / 1000))} elapsed
              </AlertDescription>
              <Button
                variant="primary"
                size="sm"
                className="mt-2"
                rightIcon={<FontAwesomeIcon icon={faArrowRight} />}
                onClick={() => navigate('/app/clock')}
              >
                View
              </Button>
            </Alert>
          )}

          {/* ── Quick stats ─────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {/* Hours today */}
            <Card padding="sm">
              <CardContent className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-400">
                  <FontAwesomeIcon icon={faClock} className="text-sm" />
                </div>
                <div>
                  <Text variant="muted" size="xs">
                    Hours today
                  </Text>
                  <Text size="lg" weight="semibold">
                    {(
                      (tab === 'me' ? (myStatus?.todaySeconds ?? 0) : todayTotalSeconds) / 3600
                    ).toFixed(1)}
                  </Text>
                  {tab === 'me' ? (
                    myStatus?.isClockedIn && (
                      <Text
                        variant="muted"
                        size="xs"
                        className="mt-0.5 text-green-600 dark:text-green-400"
                      >
                        ↑ clocked in
                      </Text>
                    )
                  ) : (
                    <>
                      {membersClocked.length > 0 && (
                        <Text
                          variant="muted"
                          size="xs"
                          className="mt-0.5 text-green-600 dark:text-green-400"
                        >
                          ↑ {membersClocked.length} active
                        </Text>
                      )}
                    </>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Open tickets */}
            <Card padding="sm">
              <CardContent className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-600 dark:bg-violet-950/50 dark:text-violet-400">
                  <FontAwesomeIcon icon={faTicket} className="text-sm" />
                </div>
                <div>
                  <Text variant="muted" size="xs">
                    Open tickets
                  </Text>
                  <Text size="lg" weight="semibold">
                    {String(tab === 'me' ? myOpenTickets.length : openTickets.length)}
                  </Text>
                  {tab === 'team' && unassignedOpen.length > 0 && (
                    <Text variant="muted" size="xs" className="mt-0.5">
                      {unassignedOpen.length} unassigned
                    </Text>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Closed today */}
            <Card padding="sm">
              <CardContent className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-green-50 text-green-600 dark:bg-green-950/50 dark:text-green-400">
                  <FontAwesomeIcon icon={faCheckCircle} className="text-sm" />
                </div>
                <div>
                  <Text variant="muted" size="xs">
                    Closed today
                  </Text>
                  <Text size="lg" weight="semibold">
                    {String(tab === 'me' ? myClosedToday.length : closedToday.length)}
                  </Text>
                </div>
              </CardContent>
            </Card>

            {/* High priority */}
            <Card padding="sm">
              <CardContent className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-50 text-red-600 dark:bg-red-950/50 dark:text-red-400">
                  <FontAwesomeIcon icon={faExclamationTriangle} className="text-sm" />
                </div>
                <div>
                  <Text variant="muted" size="xs">
                    High priority
                  </Text>
                  <Text size="lg" weight="semibold" className="text-red-600 dark:text-red-400">
                    {String(
                      tab === 'me'
                        ? myHighPriority.filter((t) => t.status !== 'closed' && t.status !== 'done')
                            .length
                        : highPriority.filter((t) => t.status !== 'closed' && t.status !== 'done')
                            .length,
                    )}
                  </Text>
                  {(tab === 'me' ? myOverdue.length : overdue.length) > 0 && (
                    <Text variant="muted" size="xs" className="mt-0.5">
                      {tab === 'me' ? myOverdue.length : overdue.length} overdue
                    </Text>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* ── Team members ─────────────────────────────────────────────────── */}
          {tab === 'team' && (
            <Card padding="none">
              <CardHeader className="flex flex-row items-center justify-between px-5 py-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <FontAwesomeIcon icon={faUsers} className="text-neutral-400" />
                  Team
                </CardTitle>
                {loading && <Spinner size="sm" />}
              </CardHeader>
              <CardContent className="p-0">
                {sortedMembers.length === 0 ? (
                  <div className="px-5 py-4 text-center">
                    <Text variant="muted" size="sm">
                      No members found
                    </Text>
                  </div>
                ) : (
                  <>
                    {membersClocked.length > 0 && (
                      <div className="px-5 pb-1 pt-2">
                        <Text
                          variant="muted"
                          size="xs"
                          weight="medium"
                          className="uppercase tracking-wide"
                        >
                          Online · {membersClocked.length}
                        </Text>
                      </div>
                    )}
                    <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
                      {sortedMembers
                        .filter((m) => m.isClockedIn)
                        .map((member) => (
                          <MemberRow
                            key={member.userId}
                            member={member}
                            currentTime={currentTime}
                            isAdmin={teamAdminIds.has(member.userId)}
                            onNavigate={() => navigate(profilePath(member))}
                          />
                        ))}
                    </ul>
                    {sortedMembers.some((m) => !m.isClockedIn) && (
                      <>
                        <div className="px-5 pb-1 pt-3">
                          <Text
                            variant="muted"
                            size="xs"
                            weight="medium"
                            className="uppercase tracking-wide"
                          >
                            Offline · {sortedMembers.filter((m) => !m.isClockedIn).length}
                          </Text>
                        </div>
                        <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
                          {sortedMembers
                            .filter((m) => !m.isClockedIn)
                            .map((member) => (
                              <MemberRow
                                key={member.userId}
                                member={member}
                                currentTime={currentTime}
                                isAdmin={teamAdminIds.has(member.userId)}
                                onNavigate={() => navigate(profilePath(member))}
                              />
                            ))}
                        </ul>
                      </>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          )}

          {/* ── Active tickets (with running timers) ─────────────────────────── */}
          <Card padding="none">
            <CardHeader className="flex flex-row items-center justify-between px-5 py-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <FontAwesomeIcon icon={faPlay} className="text-green-500" />
                Active tickets
                {visibleRunningTimers.length > 0 && (
                  <Badge variant="secondary" size="sm">
                    {visibleRunningTimers.length} running
                  </Badge>
                )}
              </CardTitle>
              <Button variant="link" size="sm" onClick={() => navigate('/app/tickets')}>
                View all →
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              {loading ? (
                <div className="flex justify-center py-6">
                  <Spinner size="sm" />
                </div>
              ) : visibleRunningTimers.length === 0 ? (
                <div className="px-5 py-6 text-center">
                  <Text variant="muted" size="sm">
                    No active timers right now
                  </Text>
                </div>
              ) : (
                <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
                  {visibleRunningTimers.map((timer) => {
                    const ticket = tickets.find((t) => t.id === timer.ticketId);
                    const elapsedSec = Math.floor((currentTime - timer.startTime) / 1000);
                    const priorityColor =
                      ticket?.priority === 'high' || ticket?.priority === 'urgent'
                        ? 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400'
                        : ticket?.priority === 'medium'
                          ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400'
                          : 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400';
                    return (
                      <li key={timer.timerId} className="flex items-center gap-3 px-5 py-3">
                        {ticket?.priority && (
                          <span
                            className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-medium capitalize ${priorityColor}`}
                          >
                            {ticket.priority === 'urgent'
                              ? 'High'
                              : ticket.priority.charAt(0).toUpperCase() + ticket.priority.slice(1)}
                          </span>
                        )}
                        <div className="min-w-0 flex-1">
                          <Text size="sm" weight="medium" className="truncate">
                            {timer.ticketTitle}
                          </Text>
                          <div className="mt-0.5 flex items-center gap-1.5">
                            <UserAvatar name={timer.userName} src={timer.userImage} size="xs" />
                            <Text variant="muted" size="xs">
                              {timer.userName}
                            </Text>
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <Text
                            size="xs"
                            weight="medium"
                            className="font-mono text-green-600 dark:text-green-400"
                          >
                            {formatTimer(elapsedSec)}
                          </Text>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* ── Time logged today ────────────────────────────────────────────── */}
          {tab === 'team' && memberStatuses.some((m) => m.todaySeconds > 0) && (
            <Card padding="none">
              <CardHeader className="flex flex-row items-center justify-between px-5 py-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <FontAwesomeIcon icon={faClock} className="text-neutral-400" />
                  Time logged today
                  <span className="ml-1 rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
                    {(todayTotalSeconds / 3600).toFixed(1)}h total
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
                  {sortedMembers
                    .filter((m) => m.todaySeconds > 0 || m.isClockedIn)
                    .map((member) => {
                      const barPct = Math.round((member.todaySeconds / maxMemberSeconds) * 100);
                      return (
                        <li key={member.userId} className="flex items-center gap-3 px-5 py-3">
                          <Button
                            variant="ghost"
                            onClick={() => navigate(profilePath(member))}
                            className="flex min-w-0 flex-1 items-center gap-3 text-left hover:opacity-80 focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
                            aria-label={`View ${member.name}'s profile`}
                          >
                            <UserAvatar name={member.name} src={member.image} size="sm" />
                            <div className="min-w-0 flex-1">
                              <Text size="sm" weight="medium">
                                {member.name.split(' ')[0]}
                                {member.name.split(' ')[1]
                                  ? ` ${member.name.split(' ')[1][0]}.`
                                  : ''}
                              </Text>
                              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
                                <div
                                  className={`h-full rounded-full transition-all ${member.isClockedIn ? 'bg-blue-500' : 'bg-neutral-300 dark:bg-neutral-600'}`}
                                  style={{ width: `${barPct}%` }}
                                />
                              </div>
                            </div>
                          </Button>
                          <Text size="sm" weight="medium" className="shrink-0 tabular-nums">
                            {formatDuration(member.todaySeconds)}
                          </Text>
                          {member.isClockedIn && (
                            <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-green-500" />
                          )}
                        </li>
                      );
                    })}
                </ul>
                <div className="border-t border-neutral-100 px-5 py-2 dark:border-neutral-800">
                  <Text variant="muted" size="xs">
                    {membersClocked.length} member{membersClocked.length !== 1 ? 's' : ''} currently
                    tracking
                  </Text>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </AppPage>
  );
};

// ─── MemberRow ────────────────────────────────────────────────────────────────

interface MemberRowProps {
  member: TeamMemberClockStatus;
  currentTime: number;
  isAdmin?: boolean;
  onNavigate: () => void;
}

const MemberRow: React.FC<MemberRowProps> = ({ member, currentTime, isAdmin, onNavigate }) => {
  const sessionSeconds =
    member.isClockedIn && member.activeClockStart
      ? Math.floor((currentTime - member.activeClockStart) / 1000)
      : member.todaySeconds;

  return (
    <li className="flex items-center gap-3 px-5 py-3">
      <Button
        variant="ghost"
        onClick={onNavigate}
        className="flex min-w-0 flex-1 items-center gap-3 text-left hover:opacity-80 focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
        aria-label={`View ${member.name}'s profile`}
      >
        <div className="relative shrink-0">
          <UserAvatar name={member.name} src={member.image} size="sm" />
          <span
            className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white dark:border-neutral-900 ${
              member.isClockedIn ? 'bg-green-500' : 'bg-neutral-300 dark:bg-neutral-600'
            }`}
            aria-hidden="true"
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <Text size="sm" weight="medium" className="truncate">
              {member.name}
            </Text>
            {isAdmin && (
              <span className="shrink-0 rounded px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-violet-100 text-violet-700 dark:bg-violet-950/50 dark:text-violet-400">
                Admin
              </span>
            )}
            {member.isOnBreak && (
              <span className="shrink-0 rounded px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400">
                On Break
              </span>
            )}
          </div>
          <Text variant="muted" size="xs">
            {member.isClockedIn
              ? member.isOnBreak
                ? 'On break'
                : 'Clocked in'
              : member.todaySeconds > 0
                ? 'Clocked out'
                : 'Not tracked today'}
          </Text>
        </div>
      </Button>
      {sessionSeconds > 0 && (
        <Text size="sm" weight="medium" className="shrink-0 tabular-nums">
          {formatDuration(sessionSeconds)}
        </Text>
      )}
    </li>
  );
};
