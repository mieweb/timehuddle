/**
 * DashboardPage — Team overview dashboard (mobile-first, scrollable).
 *
 * Sections (stacked vertically for Capacitor):
 *   1. Quick stats: Hours today, Open tickets, Closed today, High priority
 *   2. Team members: Online/offline, clocked-in status, today's hours
 *   3. Active tickets: Only tickets with running timers, with the person who started each
 *   4. Time logged today: Per-member bar with hours
 *
 * A Me/Team toggle scopes the stats. It is hidden on a personal workspace,
 * where both tabs would show the same numbers.
 *
 * Both tabs offer a "Timesheet" view. "Me" holds the personal timesheet — the
 * app's only one since the standalone /app/timesheet route was retired. "Team"
 * holds the admin timesheet (admins only), which moved here from the Teams page
 * to keep Teams focused on membership/settings and keep time-tracking data
 * alongside the rest of the team's activity.
 *   • Deep-link support: ?tab=timesheet&teamId=XXX&memberId=YYY  (Team)
 *                        ?view=timesheet                          (Me)
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
  faComments,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Spinner, Text } from '@mieweb/ui';
import React, { useCallback, useEffect, useState } from 'react';

import {
  ticketApi,
  type Ticket,
  teamApi,
  type TeamMember,
  teamDashboardApi,
  type TeamMemberClockStatus,
  type TeamRunningTimer,
  type HuddlePost,
} from '../../lib/api';
import { useSession } from '../../lib/useSession';
import { useTeam } from '../../lib/TeamContext';
import { useRefresh } from '../../lib/RefreshContext';
import { getDdpClient } from '../../lib/ddp';
import { formatDuration, formatTimer, getActiveClockSeconds } from '../../lib/timeUtils';
import { useRouter } from '../../ui/router';
import { AppPage } from '../../ui/AppPage';
import { UserAvatar } from '../../ui/UserAvatar';
import { ClockStrand } from '../../ui/ClockStrand';
import { WorkspaceGreeting } from '../../ui/WorkspaceGreeting';
import { PersonalTimesheetPanel } from '../clock/PersonalTimesheetPanel';
import { roundDurationSecondsForDisplay } from '../clock/timesheetUtils';
import { AdminTimesheetPanel } from '../teams/AdminTimesheetPanel';

const profilePath = (member: TeamMemberClockStatus) =>
  `/app/profile/${member.username ?? member.userId}`;

// ─── DashboardPage ────────────────────────────────────────────────────────────

export const DashboardPage: React.FC = () => {
  const { user } = useSession();
  const { navigate } = useRouter();
  const {
    teams,
    allTeams,
    teamsReady,
    activeClockEvent,
    currentTime,
    selectedTeamId,
    setSelectedTeamId,
    setSelectedOrgId,
    isAdmin,
  } = useTeam();

  const selectedTeam = teams.find((t) => t.id === selectedTeamId) ?? null;
  const teamAdminIds = new Set(selectedTeam?.admins ?? []);
  const isPersonalWorkspace = Boolean(selectedTeam?.isPersonal);
  const canViewTimesheet = isAdmin && !isPersonalWorkspace;

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [memberStatuses, setMemberStatuses] = useState<TeamMemberClockStatus[]>([]);
  const [runningTimers, setRunningTimers] = useState<TeamRunningTimer[]>([]);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<'overview' | 'timesheet'>('overview');
  const [initialMemberId, setInitialMemberId] = useState<string>('');
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);

  // ── Deep-link support ──
  //   ?tab=timesheet&teamId=&memberId=  → Team → Timesheet (admin, from notifications)
  //   ?view=timesheet                   → Me → Timesheet (the retired /app/timesheet URL)
  useEffect(() => {
    if (!teamsReady) return;
    const params = new URLSearchParams(window.location.search);
    const deepTab = params.get('tab');
    const deepView = params.get('view');
    const memberId = params.get('memberId');
    const teamId = params.get('teamId');

    if (deepTab === 'timesheet' || deepView === 'timesheet') {
      setView('timesheet');
    }
    if (memberId) setInitialMemberId(memberId);
    if (teamId) {
      const inScope = teams.find((t) => t.id === teamId);
      const crossOrg = !inScope && allTeams.find((t) => t.id === teamId);
      if (inScope) {
        setSelectedTeamId(teamId);
      } else if (crossOrg) {
        // Team is in a different org — switch org first so the team becomes visible
        setSelectedOrgId(crossOrg.orgId);
        setSelectedTeamId(teamId);
      }
    }

    if (deepTab || deepView || memberId || teamId) {
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, [teamsReady, teams, allTeams, setSelectedTeamId, setSelectedOrgId]);

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

  // ── Recent activity — everyone's published plan/wrap-up posts for this
  // team, live via the same DDP publication the Huddle feed uses. Clicking
  // one jumps straight to that post in the feed. Teams only — a personal
  // workspace has no "everyone" to show activity for.
  const [recentPosts, setRecentPosts] = useState<HuddlePost[]>([]);
  useEffect(() => {
    if (!selectedTeamId || isPersonalWorkspace) {
      setRecentPosts([]);
      return;
    }
    const ddp = getDdpClient();
    const syncPosts = () => {
      const docs = ddp.docs('huddlePosts');
      const teamPosts = docs
        .filter((p) => p.teamId === selectedTeamId && p.status !== 'draft')
        .map((p) => ({ ...p, id: (p.id ?? p._id) as string }) as unknown as HuddlePost)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 10);
      setRecentPosts(teamPosts);
    };
    syncPosts();
    const offChange = ddp.onCollectionChange('huddlePosts', syncPosts);
    const unsubscribe = ddp.subscribe('huddlePosts.byTeam', [selectedTeamId], syncPosts);
    return () => {
      offChange();
      unsubscribe();
      setRecentPosts([]);
    };
  }, [selectedTeamId, isPersonalWorkspace]);

  const goToPost = (postId: string) => navigate(`/app/huddle?postId=${postId}`);

  const formatPostTimestamp = (date: string) => {
    const diffMs = Date.now() - new Date(date).getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);
    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return new Date(date).toLocaleDateString();
  };

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

    >
      <WorkspaceGreeting
        note={
          isPersonalWorkspace
            ? 'Everything below is just your own activity.'
            : "Everything below is this team's activity."
        }
        trailing={
          activeClockEvent && (
            /* Folded in here rather than given its own card: a running shift is
               a status, not a section, and a full-width alert pushed the actual
               dashboard below the fold. */
            <div className="flex items-center gap-3 rounded-xl bg-white/70 px-3 py-2 shadow-sm dark:bg-white/5">
              <ClockStrand active={!activeClockEvent.isPaused} className="h-7 w-12 shrink-0" />
              <div className="min-w-0">
                <Text variant="muted" size="xs">
                  {activeClockEvent.isPaused ? 'On break' : 'Session active'}
                </Text>
                <Text size="sm" weight="semibold" className="font-mono tabular-nums">
                  {formatTimer(getActiveClockSeconds(activeClockEvent, currentTime))}
                </Text>
              </div>
              <Button
                variant="primary"
                size="sm"
                className="shrink-0 rounded-full"
                rightIcon={<FontAwesomeIcon icon={faArrowRight} />}
                onClick={() => navigate('/app/clock')}
              >
                View
              </Button>
            </div>
          )
        }
      />

      {/* ── Overview / Timesheet toggle ──────────────────────────────── */}
      <div className="inline-flex rounded-full bg-neutral-100 p-1 dark:bg-neutral-800">
        <button
          type="button"
          onClick={() => setView('overview')}
          aria-pressed={view === 'overview'}
          className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
            view === 'overview'
              ? 'bg-white text-neutral-900 shadow-sm dark:bg-neutral-700 dark:text-neutral-100'
              : 'text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300'
          }`}
        >
          Overview
        </button>
        <button
          type="button"
          onClick={() => setView('timesheet')}
          aria-pressed={view === 'timesheet'}
          className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
            view === 'timesheet'
              ? 'bg-white text-neutral-900 shadow-sm dark:bg-neutral-700 dark:text-neutral-100'
              : 'text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300'
          }`}
        >
          Timesheet
        </button>
      </div>

      {/* ── Timesheet view: admin panel for admins, personal panel for everyone else ── */}
      {view === 'timesheet' && (
        canViewTimesheet && selectedTeamId ? (
          <AdminTimesheetPanel
            members={teamMembers}
            selectedTeamId={selectedTeamId}
            teams={teams}
            initialMemberId={initialMemberId}
          />
        ) : (
          <PersonalTimesheetPanel />
        )
      )}

      {view === 'overview' && (
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
                    {formatDuration(roundDurationSecondsForDisplay(todayTotalSeconds))}
                  </Text>
                  {membersClocked.length > 0 && (
                    <Text
                      variant="muted"
                      size="xs"
                      className="mt-0.5 text-green-600 dark:text-green-400"
                    >
                      ↑ {membersClocked.length} active
                    </Text>
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
                    {String(openTickets.length)}
                  </Text>
                  {unassignedOpen.length > 0 && (
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
                    {String(closedToday.length)}
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
                    {String(highPriority.filter((t) => t.status !== 'closed' && t.status !== 'done').length)}
                  </Text>
                  {overdue.length > 0 && (
                    <Text variant="muted" size="xs" className="mt-0.5">
                      {overdue.length} overdue
                    </Text>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* ── Team members ─────────────────────────────────────────────────── */}
          {!isPersonalWorkspace && (
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
                {runningTimers.length > 0 && (
                  <Badge variant="secondary" size="sm">
                    {runningTimers.length} running
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
              ) : runningTimers.length === 0 ? (
                <div className="px-5 py-6 text-center">
                  <Text variant="muted" size="sm">
                    No active timers right now
                  </Text>
                </div>
              ) : (
                <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
                  {runningTimers.map((timer) => {
                    const ticket = tickets.find((t) => t.id === timer.ticketId);
                    const elapsedSec = Math.floor((currentTime - timer.startTime) / 1000);
                    const priorityColor =
                      ticket?.priority === 'high' || ticket?.priority === 'urgent'
                        ? 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400'
                        : ticket?.priority === 'medium'
                          ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400'
                          : 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400';
                    return (
                      <li key={timer.timerId}>
                        <button
                          type="button"
                          onClick={() => navigate(`/app/tickets/${timer.ticketId}`)}
                          className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-800/60"
                          aria-label={`View ticket: ${timer.ticketTitle}`}
                        >
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
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* ── Time logged today ────────────────────────────────────────────── */}
          {!isPersonalWorkspace && memberStatuses.some((m) => m.todaySeconds > 0) && (
            <Card padding="none">
              <CardHeader className="flex flex-row items-center justify-between px-5 py-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <FontAwesomeIcon icon={faClock} className="text-neutral-400" />
                  Time logged today
                  <span className="ml-1 rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
                    {formatDuration(roundDurationSecondsForDisplay(todayTotalSeconds))} total
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

          {/* ── Recent activity — everyone's plan/wrap-up posts (teams only,
               not the personal workspace, which has no "everyone") ──────── */}
          {!isPersonalWorkspace && (
            <Card padding="none">
              <CardHeader className="flex flex-row items-center justify-between px-5 py-4">
                <CardTitle className="flex items-center gap-2 text-base">
                  <FontAwesomeIcon icon={faComments} className="text-neutral-400" />
                  Recent activity
                </CardTitle>
                <Button variant="link" size="sm" onClick={() => navigate('/app/huddle')}>
                  View all →
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                {recentPosts.length === 0 ? (
                  <div className="px-5 py-8 text-center">
                    <Text variant="muted" size="sm">
                      No plan posts or clock-ins yet
                    </Text>
                  </div>
                ) : (
                  <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
                    {recentPosts.map((post) => (
                      <li key={post.id}>
                        <button
                          type="button"
                          onClick={() => goToPost(post.id)}
                          aria-label={`View ${post.userName}'s post`}
                          className="flex w-full items-start gap-3 px-5 py-4 text-left transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-800/60"
                        >
                          <div className="mt-0.5 shrink-0">
                            <UserAvatar name={post.userName} size="md" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <Text size="sm" weight="semibold" className="leading-snug">
                              {post.userName}
                            </Text>
                            <Text
                              size="sm"
                              variant="muted"
                              className="mt-0.5 leading-snug text-neutral-500 dark:text-neutral-400"
                            >
                              {post.clockEventId
                                ? 'Posted their plan & clocked in'
                                : 'Shared an update'}
                            </Text>
                            {post.content.text && (
                              <Text
                                size="sm"
                                className="mt-1.5 line-clamp-2 leading-snug text-neutral-700 dark:text-neutral-300"
                              >
                                {post.content.text}
                              </Text>
                            )}
                          </div>
                          <Text
                            variant="muted"
                            size="xs"
                            className="mt-0.5 shrink-0 whitespace-nowrap"
                          >
                            {formatPostTimestamp(post.createdAt)}
                          </Text>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
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
