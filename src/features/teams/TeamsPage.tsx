/**
 * TeamsPage — Create, join, and manage teams.
 *
 * Features:
 *   • Create new team / Join existing with code
 *   • Team member list with admin controls
 *   • Copy team code, rename, delete team
 *   • Promote/demote admins, remove members, invite by email
 *   • Set member passwords (admin only)
 *   • Deep-link support: ?teamId=XXX
 *
 * The admin Timesheet view has moved to the Dashboard page's "Team" tab —
 * see AdminTimesheetPanel usage in DashboardPage.tsx.
 */
import {
  faCopy,
  faCrown,
  faEllipsisV,
  faGear,
  faKey,
  faPlus,
  faQrcode,
  faRightToBracket,
  faShareNodes,
  faShield,
  faTrash,
  faUserMinus,
  faUserPlus,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { QRCodeSVG } from 'qrcode.react';
import {
  Badge,
  Button,
  CardTitle,
  Dropdown,
  DropdownItem,
  DropdownSeparator,
  Input,
  Modal,
  ModalBody,
  ModalClose,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Spinner,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Text,
  Textarea,
} from '@mieweb/ui';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { teamApi, type TeamMember, type TeamInvitation } from '../../lib/api';
import { useTeam } from '../../lib/TeamContext';
import { useSession } from '../../lib/useSession';
import { useRefresh } from '../../lib/RefreshContext';
import { usePresence } from '../../lib/usePresence';
import { useRouter } from '../../ui/router';
import { AppPage } from '../../ui/AppPage';
import { PendingJoinRequests } from './PendingJoinRequests';
import { UserAvatar } from '../../ui/UserAvatar';
import { getDdpClient } from '../../lib/ddp';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function invitationStatusVariant(
  status: TeamInvitation['status'],
): 'warning' | 'success' | 'outline' | 'danger' {
  switch (status) {
    case 'pending':
      return 'warning';
    case 'accepted':
      return 'success';
    case 'delivery_failed':
      return 'danger';
    case 'expired':
    case 'revoked':
    default:
      return 'outline';
  }
}

// ─── TeamsPage ────────────────────────────────────────────────────────────────

export const TeamsPage: React.FC = () => {
  const { user } = useSession();
  const userId = user?.id ?? null;
  const { navigate, pathname } = useRouter();
  const {
    teams,
    pendingRequests,
    teamsReady,
    selectedOrgId,
    selectedTeamId,
    setSelectedTeamId,
    isAdmin,
    refetchTeams,
  } = useTeam();

  // Controlled via deep-link query params (?teamId=) — Members/Pending are
  // always visible together now, no tabs to switch between.
  const [urlCheckCounter, setUrlCheckCounter] = useState(0);

  // ── Parse deep-link query params whenever URL changes ──
  useEffect(() => {
    // Teams load asynchronously, and this effect consumes the query string
    // destructively (the replaceState below). Running before they arrive means
    // `teamId` can never match, so the team is silently dropped while the
    // params are stripped anyway — every later run then sees an empty search
    // and the deep link is lost for good, leaving the user on whichever team
    // sorts first instead of the linked one.
    if (!teamsReady) return;

    const params = new URLSearchParams(window.location.search);
    const teamId = params.get('teamId');
    const hasQuery = window.location.search.length > 0;

    if (teamId && teams.some((t) => t.id === teamId)) setSelectedTeamId(teamId);

    // Clean up query params from URL without triggering a navigation
    if (hasQuery) {
      const cleanUrl = window.location.pathname;
      window.history.replaceState(null, '', cleanUrl);
    }
  }, [pathname, urlCheckCounter, setSelectedTeamId, teams, teamsReady]);

  // ── Listen for navigation events (from navigate()) ──
  useEffect(() => {
    const handleUrlChange = () => setUrlCheckCounter((c) => c + 1);
    window.addEventListener('timehuddle:navigate', handleUrlChange);
    window.addEventListener('popstate', handleUrlChange);
    return () => {
      window.removeEventListener('timehuddle:navigate', handleUrlChange);
      window.removeEventListener('popstate', handleUrlChange);
    };
  }, []);

  // Fetch members for selected team
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const fetchMembers = useCallback(async (teamId: string | null) => {
    if (!teamId) {
      setMembers([]);
      return;
    }
    setMembersLoading(true);
    try {
      const data = await teamApi.getMembers(teamId);
      setMembers(data);
    } catch {
      setMembers([]);
    } finally {
      setMembersLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchMembers(selectedTeamId);
  }, [selectedTeamId, fetchMembers]);

  // ── Real-time team updates (Meteor DDP, oplog-backed) ──
  // Teams are already reactive via TeamContext, but we need to refetch members
  // when the team document changes (members/admins arrays updated)
  useEffect(() => {
    if (!selectedTeamId) return;

    const ddp = getDdpClient();

    const offChange = ddp.onCollectionChange('teams', () => {
      void fetchMembers(selectedTeamId);
    });

    return () => {
      offChange();
    };
  }, [selectedTeamId, fetchMembers]);

  // Pull-to-refresh: refetch members + teams
  useRefresh(
    useCallback(async () => {
      await Promise.all([fetchMembers(selectedTeamId), refetchTeams()]);
    }, [fetchMembers, selectedTeamId, refetchTeams]),
  );

  const selectedTeam = teams.find((t) => t.id === selectedTeamId) ?? null;

  // Team-switcher pill order: Personal always leads, the currently selected
  // team comes right after it (so switching teams never requires scrolling
  // back to find "where you are"), everything else keeps its original order.
  const orderedTeams = useMemo(() => {
    const rank = (t: (typeof teams)[number]) =>
      t.isPersonal ? 0 : t.id === selectedTeamId ? 1 : 2;
    return [...teams].sort((a, b) => rank(a) - rank(b));
  }, [teams, selectedTeamId]);

  // Count of pending join requests for the selected team (admin only)
  const pendingRequestCount = useMemo(
    () => (selectedTeamId ? pendingRequests.filter((r) => r.teamId === selectedTeamId).length : 0),
    [selectedTeamId, pendingRequests],
  );

  // `isAdmin` (from TeamContext) already covers org owners, who get full
  // team-admin authority on every team in their org.
  const canManageTeamSettings = isAdmin && !selectedTeam?.isPersonal;

  // Real-time online/offline presence for team members
  const memberIds = useMemo(() => members.map((m) => m.id), [members]);
  const onlineUsers = usePresence(memberIds);

  // Loading states for mutations
  const [createLoading, setCreateLoading] = useState(false);
  const [joinLoading, setJoinLoading] = useState(false);
  const [renameLoading, setRenameLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [removeLoading, setRemoveLoading] = useState(false);
  const [revokeLoadingId, setRevokeLoadingId] = useState<string | null>(null);

  // Team setting: require a daily Huddle plan to clock in/out
  const [requirePlanForClock, setRequirePlanForClock] = useState(false);
  const [savingPlanSetting, setSavingPlanSetting] = useState(false);

  // Team setting: auto-accept join requests (skip the pending-approval list)
  const [autoAcceptJoins, setAutoAcceptJoins] = useState(false);
  const [savingAutoAccept, setSavingAutoAccept] = useState(false);

  useEffect(() => {
    setRequirePlanForClock(selectedTeam?.settings?.requirePlanForClock ?? false);
  }, [selectedTeam?.id, selectedTeam?.settings?.requirePlanForClock]);

  useEffect(() => {
    setAutoAcceptJoins(selectedTeam?.settings?.autoAcceptJoins ?? false);
  }, [selectedTeam?.id, selectedTeam?.settings?.autoAcceptJoins]);

  // Pending/sent team invitations shown in the Team Settings modal
  const [invitations, setInvitations] = useState<TeamInvitation[]>([]);
  const [invitationsLoading, setInvitationsLoading] = useState(false);

  // Modal state
  const [modal, setModal] = useState<
    | null
    | 'create'
    | 'join'
    | 'delete'
    | 'invite'
    | 'settings'
    | 'share'
    | { type: 'invite-sent'; email: string }
    | { type: 'password'; memberId: string }
    | { type: 'remove'; memberId: string }
    | { type: 'created'; code: string }
    | { type: 'pending-request'; teamCode: string }
  >(null);

  // Inline team-name draft used by the "Team Settings" modal's rename field
  // (kept separate from `formValue`, which drives the create/join/invite forms).
  const [teamNameDraft, setTeamNameDraft] = useState('');
  useEffect(() => {
    if (modal === 'settings' && selectedTeam) setTeamNameDraft(selectedTeam.name);
  }, [modal, selectedTeam]);
  const inviteSentEmail =
    typeof modal === 'object' && modal?.type === 'invite-sent' ? modal.email : null;

  const [formValue, setFormValue] = useState('');
  const [createDescription, setCreateDescription] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const closeModal = () => {
    setModal(null);
    setFormValue('');
    setCreateDescription('');
    setFormError(null);
  };

  const membersById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);

  // ── Handlers ──

  const handleCreate = useCallback(async () => {
    if (!formValue.trim()) return;
    if (!selectedOrgId) {
      setFormError('Select an organization before creating a team.');
      return;
    }
    setCreateLoading(true);
    try {
      const team = await teamApi.createTeam({
        name: formValue.trim(),
        description: createDescription.trim() || undefined,
        orgId: selectedOrgId,
      });
      setSelectedTeamId(team.id);
      setModal({ type: 'created', code: team.code });
      setFormValue('');
      setCreateDescription('');
      refetchTeams();
    } catch (e: any) {
      setFormError(e.message || 'Failed to create team');
    } finally {
      setCreateLoading(false);
    }
  }, [formValue, createDescription, selectedOrgId, setSelectedTeamId, refetchTeams]);

  const handleJoin = useCallback(async () => {
    if (!formValue.trim()) return;
    setJoinLoading(true);
    try {
      const result = await teamApi.joinTeam(formValue.trim());

      if (result.status === 'pending') {
        closeModal();
        setModal({ type: 'pending-request', teamCode: formValue.trim() });
        refetchTeams();
      } else if (result.status === 'joined') {
        setSelectedTeamId(result.team.id);
        closeModal();
        refetchTeams();
      }
    } catch (e: any) {
      setFormError(e.message || 'Failed to join team');
    } finally {
      setJoinLoading(false);
    }
  }, [formValue, setSelectedTeamId, refetchTeams]);

  const handleRenameTeam = useCallback(async () => {
    const trimmed = teamNameDraft.trim();
    if (!trimmed || !selectedTeamId || trimmed === selectedTeam?.name) return;
    setRenameLoading(true);
    setFormError(null);
    try {
      await teamApi.renameTeam(selectedTeamId, trimmed);
      refetchTeams();
    } catch (e: any) {
      setFormError(e.message || 'Failed to rename');
    } finally {
      setRenameLoading(false);
    }
  }, [teamNameDraft, selectedTeamId, selectedTeam?.name, refetchTeams]);

  const handleDelete = useCallback(async () => {
    if (!selectedTeamId) return;
    setDeleteLoading(true);
    try {
      await teamApi.deleteTeam(selectedTeamId);
      closeModal();
      refetchTeams();
    } catch (e: any) {
      setFormError(e.message || 'Failed to delete');
    } finally {
      setDeleteLoading(false);
    }
  }, [selectedTeamId, refetchTeams]);

  const handleInvite = useCallback(async () => {
    if (!formValue.trim() || !selectedTeamId || inviteLoading) return;
    setInviteLoading(true);
    setFormError(null);
    try {
      const result = await teamApi.inviteMember(selectedTeamId, formValue.trim());
      if (result.status === 'pending') {
        setModal({ type: 'invite-sent', email: formValue.trim() });
      } else {
        closeModal();
        await fetchMembers(selectedTeamId);
      }
    } catch (e: any) {
      setFormError(e.message || 'Failed to invite');
    } finally {
      setInviteLoading(false);
    }
  }, [formValue, selectedTeamId, fetchMembers, inviteLoading]);

  // Fetch pending/sent invitations for the Team Settings modal
  const fetchInvitations = useCallback(async (teamId: string | null) => {
    if (!teamId) {
      setInvitations([]);
      return;
    }
    setInvitationsLoading(true);
    try {
      const data = await teamApi.getPendingInvitations(teamId);
      setInvitations(data);
    } catch {
      setInvitations([]);
    } finally {
      setInvitationsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (modal === 'settings') {
      void fetchInvitations(selectedTeamId);
    }
  }, [modal, selectedTeamId, fetchInvitations]);

  const handleRevokeInvitation = useCallback(
    async (invitationId: string) => {
      setRevokeLoadingId(invitationId);
      try {
        await teamApi.revokeInvitation(invitationId);
        await fetchInvitations(selectedTeamId);
      } catch (e: any) {
        setFormError(e.message || 'Failed to revoke invitation');
      } finally {
        setRevokeLoadingId(null);
      }
    },
    [selectedTeamId, fetchInvitations],
  );

  const handleSetPassword = useCallback(
    async (memberId: string) => {
      if (!formValue.trim() || !selectedTeamId) return;
      setPasswordLoading(true);
      try {
        await teamApi.setMemberPassword(selectedTeamId, memberId, formValue.trim());
        closeModal();
      } catch (e: any) {
        setFormError(e.message || 'Failed to set password');
      } finally {
        setPasswordLoading(false);
      }
    },
    [formValue, selectedTeamId],
  );

  const handleRemoveMember = useCallback(
    async (memberId: string) => {
      if (!selectedTeamId) return;
      setRemoveLoading(true);
      try {
        await teamApi.removeMember(selectedTeamId, memberId);
        closeModal();
        refetchTeams();
        await fetchMembers(selectedTeamId);
      } catch (e: any) {
        setFormError(e.message || 'Failed to remove member');
      } finally {
        setRemoveLoading(false);
      }
    },
    [selectedTeamId, refetchTeams, fetchMembers],
  );

  const copyCode = useCallback(() => {
    if (selectedTeam?.code) {
      navigator.clipboard.writeText(selectedTeam.code);
    }
  }, [selectedTeam]);

  // Shareable signup link encoded in the QR code — scanning it lands on the
  // signup page and auto-joins this team after account creation.
  const joinUrl = selectedTeam?.code
    ? `${window.location.origin}/app?mode=signup&join=${encodeURIComponent(selectedTeam.code)}`
    : '';

  const [linkCopied, setLinkCopied] = useState(false);
  const copyJoinLink = useCallback(() => {
    if (!joinUrl) return;
    navigator.clipboard
      .writeText(joinUrl)
      .then(() => {
        setLinkCopied(true);
        window.setTimeout(() => setLinkCopied(false), 2000);
      })
      .catch((err) => console.error('[TeamsPage] failed to copy join link:', err));
  }, [joinUrl]);

  const shareJoinLink = useCallback(() => {
    if (!joinUrl || !selectedTeam) return;
    void navigator
      .share({
        title: `Join ${selectedTeam.name} on TimeHuddle`,
        text: `Scan or open this link to join the ${selectedTeam.name} team on TimeHuddle.`,
        url: joinUrl,
      })
      .catch(() => {});
  }, [joinUrl, selectedTeam]);

  if (!teamsReady) {
    return (
      <div className="flex items-center justify-center p-12">
        <Spinner size="lg" label="Loading teams…" />
      </div>
    );
  }

  return (
    <AppPage
      titleActions={
        <div className="flex gap-2">
          <Button
            variant="primary"
            size="icon"
            onClick={() => setModal('create')}
            aria-label="Create Team"
          >
            <FontAwesomeIcon icon={faPlus} />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setModal('join')}
            aria-label="Join Team"
          >
            <FontAwesomeIcon icon={faRightToBracket} />
          </Button>
        </div>
      }
    >
      {/* ── Team switcher (horizontal-scroll pills) ─────────────────────── */}
      {/* Personal always leads; the currently selected team comes right
          after it so switching teams doesn't require scrolling back to find
          "where you are" — the rest keep their original order. */}
      {teams.length > 1 && (
        <div
          className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1"
          role="tablist"
          aria-label="Teams"
        >
          {orderedTeams.map((t) => {
            const isSelected = t.id === selectedTeamId;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={isSelected}
                onClick={() => setSelectedTeamId(t.id)}
                className={`shrink-0 whitespace-nowrap rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
                  isSelected
                    ? 'border-primary-600 bg-primary-600 text-primary-foreground'
                    : 'border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800'
                }`}
              >
                {t.isPersonal ? 'Personal' : t.name}
              </button>
            );
          })}
        </div>
      )}

      {/* Current team card */}
      {selectedTeam && (
        <div>
          {/* Team header */}
          <div className="flex flex-row items-center justify-between py-2">
            <div className="min-w-0">
              <CardTitle>
                {selectedTeam.isPersonal ? 'Personal Workspace' : selectedTeam.name}
              </CardTitle>
              {selectedTeam.description && (
                <Text variant="muted" size="sm" className="mt-1 max-w-xl">
                  {selectedTeam.description}
                </Text>
              )}
              {!selectedTeam.isPersonal && (
                <div className="mt-2 flex items-center gap-1">
                  <Badge variant="secondary" size="sm" className="font-mono tracking-widest">
                    {selectedTeam.code}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={copyCode}
                    aria-label="Copy team code"
                    title="Copy code"
                    className="h-6 w-6 text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100"
                  >
                    <FontAwesomeIcon icon={faCopy} className="text-[11px]" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setModal('share')}
                    aria-label="Share team invite link"
                    title="Share team"
                    className="h-6 w-6 text-neutral-400 hover:text-primary-600 dark:hover:text-primary-400"
                  >
                    <FontAwesomeIcon icon={faShareNodes} className="text-[11px]" />
                  </Button>
                </div>
              )}
            </div>
            {!selectedTeam.isPersonal && (
              <Button
                variant="outline"
                size="icon"
                onClick={() => setModal('settings')}
                aria-label="Team Settings"
              >
                <FontAwesomeIcon icon={faGear} className="text-xs" />
              </Button>
            )}
          </div>

          {/* ── Pending join requests (admins only, when there are any) ─── */}
          {!selectedTeam.isPersonal && isAdmin && pendingRequestCount > 0 && selectedTeamId && (
            <div className="mt-4 rounded-lg border border-neutral-100 p-4 dark:border-neutral-800">
              <Text
                variant="muted"
                size="xs"
                weight="semibold"
                className="mb-3 uppercase tracking-widest"
              >
                Pending requests ({pendingRequestCount})
              </Text>
              <PendingJoinRequests teamId={selectedTeamId} />
            </div>
          )}

          {/* ── Members ───────────────────────────────────────────────────── */}
          <div className="mt-4 rounded-lg border border-neutral-100 p-4 dark:border-neutral-800">
            <div className="mb-3 flex items-center justify-between">
              <Text
                variant="muted"
                size="xs"
                weight="semibold"
                className="uppercase tracking-widest"
              >
                Members ({selectedTeam.members.length})
              </Text>
              {isAdmin && !selectedTeam.isPersonal && (
                <Button variant="link" size="sm" onClick={() => setModal('invite')}>
                  <FontAwesomeIcon icon={faUserPlus} className="mr-1" />
                  Invite
                </Button>
              )}
            </div>
            {membersLoading ? (
              <div className="flex justify-center py-6">
                <Spinner size="sm" label="Loading members…" />
              </div>
            ) : null}
            <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {!membersLoading &&
                selectedTeam.members.map((memberId) => {
                  const m = membersById.get(memberId);
                  const name = m?.name ?? memberId;
                  const username = m?.username ?? null;
                  const email = m?.email ?? '';
                  const image = m?.image ?? null;
                  const isMemberAdmin = selectedTeam.admins.includes(memberId);
                  const isMe = memberId === userId;

                  return (
                    <li key={memberId} className="flex items-center gap-3 py-2.5">
                      <Button
                        variant="ghost"
                        onClick={() =>
                          navigate(
                            username ? `/app/profile/${username}` : `/app/profile/${memberId}`,
                          )
                        }
                        className="flex min-w-0 flex-1 items-center gap-3 text-left hover:opacity-80 focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
                        aria-label={`View ${name}'s profile`}
                      >
                        <div className="relative shrink-0">
                          <UserAvatar name={name} size="sm" src={image} />
                          {onlineUsers.has(memberId) && (
                            <span
                              className="absolute right-0 bottom-0 block h-2.5 w-2.5 rounded-full bg-green-500 ring-2 ring-white dark:ring-neutral-900"
                              aria-label={`${name} is online`}
                            />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <Text size="sm" weight="medium">
                            {name}
                            {isMe && (
                              <Text as="span" variant="muted" size="xs">
                                {' '}
                                (you)
                              </Text>
                            )}
                          </Text>
                          {username && (
                            <Text variant="muted" size="xs">
                              @{username}
                            </Text>
                          )}
                          {email && (
                            <Text variant="muted" size="xs">
                              {email}
                            </Text>
                          )}
                        </div>
                      </Button>
                      {isMemberAdmin && (
                        <Badge variant="warning" size="sm" icon={<FontAwesomeIcon icon={faCrown} />}>
                          Admin
                        </Badge>
                      )}
                      {isAdmin && !selectedTeam.isPersonal && (
                        <Dropdown
                          trigger={
                            <Button variant="ghost" size="icon" aria-label="Member actions">
                              <FontAwesomeIcon icon={faEllipsisV} className="text-xs" />
                            </Button>
                          }
                          placement="bottom-end"
                        >
                          {!isMe &&
                            (!isMemberAdmin ? (
                              <DropdownItem
                                icon={<FontAwesomeIcon icon={faShield} />}
                                onClick={() => {
                                  void teamApi
                                    .setMemberRole(selectedTeamId!, memberId, 'admin')
                                    .then(() => {
                                      refetchTeams();
                                      void fetchMembers(selectedTeamId);
                                    });
                                }}
                              >
                                Make Admin
                              </DropdownItem>
                            ) : (
                              <DropdownItem
                                icon={<FontAwesomeIcon icon={faShield} />}
                                onClick={() => {
                                  void teamApi
                                    .setMemberRole(selectedTeamId!, memberId, 'member')
                                    .then(() => {
                                      refetchTeams();
                                      void fetchMembers(selectedTeamId);
                                    });
                                }}
                              >
                                Remove Admin
                              </DropdownItem>
                            ))}
                          <DropdownItem
                            icon={<FontAwesomeIcon icon={faKey} />}
                            onClick={() => setModal({ type: 'password', memberId })}
                          >
                            Set Password
                          </DropdownItem>
                          {!isMe && (
                            <>
                              <DropdownSeparator />
                              <DropdownItem
                                icon={<FontAwesomeIcon icon={faUserMinus} />}
                                variant="danger"
                                onClick={() => setModal({ type: 'remove', memberId })}
                              >
                                Remove Member
                              </DropdownItem>
                            </>
                          )}
                        </Dropdown>
                      )}
                    </li>
                  );
                })}
            </ul>
          </div>

        </div>
      )}

      {/* ── Modals ── */}

      <Modal open={modal === 'create'} onOpenChange={(open) => !open && closeModal()} size="md">
        <ModalHeader>
          <ModalTitle>Create Team</ModalTitle>
          <ModalClose />
        </ModalHeader>
        <ModalBody>
          <div className="space-y-3">
            <Input
              label="Team name"
              hideLabel
              placeholder="Team name"
              value={formValue}
              onChange={(e) => setFormValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              error={formError ?? undefined}
              autoFocus
            />
            <Textarea
              aria-label="Team description"
              placeholder="Team description (optional)"
              value={createDescription}
              onChange={(e) => setCreateDescription(e.target.value)}
              rows={4}
              maxLength={500}
            />
          </div>
        </ModalBody>
        <ModalFooter>
          <Button
            variant="primary"
            fullWidth
            onClick={handleCreate}
            isLoading={createLoading}
            loadingText="Creating…"
            disabled={!selectedOrgId}
          >
            Create
          </Button>
        </ModalFooter>
      </Modal>

      <Modal open={modal === 'join'} onOpenChange={(open) => !open && closeModal()} size="md">
        <ModalHeader>
          <ModalTitle>Join Team</ModalTitle>
          <ModalClose />
        </ModalHeader>
        <ModalBody>
          <Input
            label="Team code"
            hideLabel
            placeholder="Enter team code"
            value={formValue}
            onChange={(e) => setFormValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
            error={formError ?? undefined}
            className="font-mono"
            autoFocus
          />
        </ModalBody>
        <ModalFooter>
          <Button
            variant="primary"
            fullWidth
            onClick={handleJoin}
            isLoading={joinLoading}
            loadingText="Joining…"
          >
            Join
          </Button>
        </ModalFooter>
      </Modal>

      <Modal open={modal === 'delete'} onOpenChange={(open) => !open && closeModal()} size="md">
        <ModalHeader>
          <ModalTitle>Delete Team</ModalTitle>
          <ModalClose />
        </ModalHeader>
        <ModalBody>
          <Text variant="muted" size="sm">
            Are you sure? This action cannot be undone. All team data will be permanently deleted.
          </Text>
          {formError && (
            <Text variant="destructive" size="xs" className="mt-2">
              {formError}
            </Text>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="outline" onClick={closeModal}>
            Cancel
          </Button>
          <Button variant="danger" onClick={handleDelete} isLoading={deleteLoading}>
            Delete
          </Button>
        </ModalFooter>
      </Modal>

      <Modal open={modal === 'invite'} onOpenChange={(open) => !open && closeModal()} size="md">
        <ModalHeader>
          <ModalTitle>Invite Member</ModalTitle>
          <ModalClose />
        </ModalHeader>
        <ModalBody>
          <Input
            label="Email"
            hideLabel
            type="email"
            placeholder="user@example.com"
            value={formValue}
            onChange={(e) => setFormValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleInvite()}
            error={formError ?? undefined}
            disabled={inviteLoading}
            autoFocus
          />
        </ModalBody>
        <ModalFooter>
          <Button
            variant="primary"
            fullWidth
            onClick={handleInvite}
            disabled={inviteLoading}
            isLoading={inviteLoading}
          >
            Send Invite
          </Button>
        </ModalFooter>
      </Modal>

      <Modal
        open={inviteSentEmail !== null}
        onOpenChange={(open) => !open && closeModal()}
        size="md"
      >
        <ModalHeader>
          <ModalTitle>Invitation Sent</ModalTitle>
          <ModalClose />
        </ModalHeader>
        <ModalBody>
          <Text variant="muted" size="sm" role="status" aria-live="polite">
            {inviteSentEmail ? `A secure account setup link was sent to ${inviteSentEmail}.` : ''}
          </Text>
        </ModalBody>
        <ModalFooter>
          <Button variant="primary" fullWidth onClick={closeModal}>
            Done
          </Button>
        </ModalFooter>
      </Modal>

      <Modal open={modal === 'settings'} onOpenChange={(open) => !open && closeModal()} size="lg">
        <ModalHeader>
          <ModalTitle>Team Settings</ModalTitle>
          <ModalClose />
        </ModalHeader>
        <ModalBody>
          <Text
            variant="muted"
            size="xs"
            weight="semibold"
            className="mb-3 uppercase tracking-widest"
          >
            Team
          </Text>
          <div className="mb-3 flex items-center gap-2">
            <Button
              variant="link"
              size="sm"
              onClick={() => setModal('share')}
              aria-label="Share team QR code"
            >
              <FontAwesomeIcon icon={faQrcode} className="mr-1" />
              Share
            </Button>
          </div>
          {canManageTeamSettings && (
            <div className="mb-6 flex items-end gap-2">
              <Input
                label="Team name"
                value={teamNameDraft}
                onChange={(e) => setTeamNameDraft(e.target.value)}
                onBlur={handleRenameTeam}
                onKeyDown={(e) => e.key === 'Enter' && handleRenameTeam()}
                disabled={renameLoading}
                className="flex-1"
              />
              <Button
                variant="danger"
                size="icon"
                onClick={() => setModal('delete')}
                aria-label="Delete team"
              >
                <FontAwesomeIcon icon={faTrash} className="text-xs" />
              </Button>
            </div>
          )}
          {!canManageTeamSettings && <div className="mb-6" />}
          {canManageTeamSettings && (
            <>
              <Text
                variant="muted"
                size="xs"
                weight="semibold"
                className="mb-3 uppercase tracking-widest"
              >
                Clock
              </Text>
          <div className="team-setting-plan-for-clock mb-6 flex items-center justify-between gap-4">
            <div>
              <Text size="sm" weight="medium">
                Require a plan for every clock-in/out
              </Text>
              <Text variant="muted" size="xs">
                Members post a plan to start each session, and add a wrap-up to it before clocking
                out — one Huddle post per session.
              </Text>
            </div>
            <Switch
              checked={requirePlanForClock}
              disabled={savingPlanSetting || !selectedTeamId}
              aria-label="Toggle requiring a plan for every clock-in and out"
              onCheckedChange={async (checked) => {
                if (!selectedTeamId) return;
                const previous = requirePlanForClock;
                setRequirePlanForClock(checked);
                setSavingPlanSetting(true);
                setFormError(null);
                try {
                  await teamApi.updateSettings(selectedTeamId, { requirePlanForClock: checked });
                  refetchTeams();
                } catch (e: any) {
                  setRequirePlanForClock(previous);
                  setFormError(e.message || 'Failed to update setting');
                } finally {
                  setSavingPlanSetting(false);
                }
              }}
            />
          </div>
          {formError && (
            <Text variant="destructive" size="xs" className="mb-4">
              {formError}
            </Text>
          )}
          <Text
            variant="muted"
            size="xs"
            weight="semibold"
            className="mb-3 uppercase tracking-widest"
          >
            Membership
          </Text>
          <div className="team-setting-auto-accept mb-6 flex items-center justify-between gap-4">
            <div>
              <Text size="sm" weight="medium">
                Auto-accept join requests
              </Text>
              <Text variant="muted" size="xs">
                Anyone joining with the team code is added immediately — no pending approval from an
                admin.
              </Text>
            </div>
            <Switch
              checked={autoAcceptJoins}
              disabled={savingAutoAccept || !selectedTeamId}
              aria-label="Toggle auto-accepting join requests"
              onCheckedChange={async (checked) => {
                if (!selectedTeamId) return;
                const previous = autoAcceptJoins;
                setAutoAcceptJoins(checked);
                setSavingAutoAccept(true);
                setFormError(null);
                try {
                  await teamApi.updateSettings(selectedTeamId, { autoAcceptJoins: checked });
                  refetchTeams();
                } catch (e: any) {
                  setAutoAcceptJoins(previous);
                  setFormError(e.message || 'Failed to update setting');
                } finally {
                  setSavingAutoAccept(false);
                }
              }}
            />
          </div>
          <Text
            variant="muted"
            size="xs"
            weight="semibold"
            className="mb-3 uppercase tracking-widest"
          >
            Invitations
          </Text>
          {invitationsLoading ? (
            <div className="flex justify-center py-6">
              <Spinner size="sm" label="Loading invitations…" />
            </div>
          ) : (
            <Table responsive>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Sent</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead className="w-32">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invitations.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell>{inv.email}</TableCell>
                    <TableCell>
                      <Badge variant={invitationStatusVariant(inv.status)}>{inv.status}</Badge>
                    </TableCell>
                    <TableCell>{new Date(inv.createdAt).toLocaleDateString()}</TableCell>
                    <TableCell>{new Date(inv.expiresAt).toLocaleDateString()}</TableCell>
                    <TableCell>
                      {inv.status === 'pending' && (
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => void handleRevokeInvitation(inv.id)}
                          disabled={revokeLoadingId === inv.id}
                          isLoading={revokeLoadingId === inv.id}
                          aria-label={`Revoke invitation for ${inv.email}`}
                        >
                          Revoke
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {invitations.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5}>
                      <Text size="sm" variant="muted" className="py-2">
                        No invitations have been sent for this team.
                      </Text>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
            </>
          )}
        </ModalBody>
      </Modal>

      <Modal
        open={typeof modal === 'object' && modal !== null && modal.type === 'password'}
        onOpenChange={(open) => !open && closeModal()}
        size="md"
      >
        <ModalHeader>
          <ModalTitle>Set Member Password</ModalTitle>
          <ModalClose />
        </ModalHeader>
        <ModalBody>
          <Input
            label="New password"
            hideLabel
            type="password"
            placeholder="New password (min 6 chars)"
            value={formValue}
            onChange={(e) => setFormValue(e.target.value)}
            onKeyDown={(e) =>
              e.key === 'Enter' &&
              typeof modal === 'object' &&
              modal !== null &&
              modal.type === 'password' &&
              handleSetPassword(modal.memberId)
            }
            error={formError ?? undefined}
            autoFocus
          />
        </ModalBody>
        <ModalFooter>
          <Button
            variant="primary"
            fullWidth
            onClick={() =>
              typeof modal === 'object' &&
              modal !== null &&
              modal.type === 'password' &&
              handleSetPassword(modal.memberId)
            }
            isLoading={passwordLoading}
          >
            Set Password
          </Button>
        </ModalFooter>
      </Modal>

      <Modal
        open={typeof modal === 'object' && modal !== null && modal.type === 'remove'}
        onOpenChange={(open) => !open && closeModal()}
        size="md"
      >
        <ModalHeader>
          <ModalTitle>Remove Member</ModalTitle>
          <ModalClose />
        </ModalHeader>
        <ModalBody>
          <Text variant="muted" size="sm">
            Remove this member from the team? They can rejoin using the team code.
          </Text>
          {formError && (
            <Text variant="destructive" size="xs" className="mt-2">
              {formError}
            </Text>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="outline" onClick={closeModal}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() =>
              typeof modal === 'object' &&
              modal !== null &&
              modal.type === 'remove' &&
              handleRemoveMember(modal.memberId)
            }
            isLoading={removeLoading}
          >
            Remove
          </Button>
        </ModalFooter>
      </Modal>

      <Modal
        open={typeof modal === 'object' && modal !== null && modal.type === 'created'}
        onOpenChange={(open) => !open && closeModal()}
        size="md"
      >
        <ModalHeader>
          <ModalTitle>Team Created!</ModalTitle>
          <ModalClose />
        </ModalHeader>
        <ModalBody>
          <Text variant="muted" size="sm">
            Share this code with your team members so they can join:
          </Text>
          <div className="mt-3 flex items-center justify-center gap-2 rounded-lg bg-neutral-100 p-3 dark:bg-neutral-800">
            <Text size="lg" weight="bold" className="font-mono">
              {typeof modal === 'object' && modal !== null && modal.type === 'created'
                ? modal.code
                : ''}
            </Text>
            <Button
              variant="ghost"
              size="icon"
              onClick={() =>
                typeof modal === 'object' &&
                modal !== null &&
                modal.type === 'created' &&
                navigator.clipboard.writeText(modal.code)
              }
              aria-label="Copy code"
            >
              <FontAwesomeIcon icon={faCopy} />
            </Button>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="primary" fullWidth onClick={closeModal}>
            Done
          </Button>
        </ModalFooter>
      </Modal>

      <Modal
        open={typeof modal === 'object' && modal !== null && modal.type === 'pending-request'}
        onOpenChange={(open) => !open && closeModal()}
        size="md"
      >
        <ModalHeader>
          <ModalTitle>Join Request Sent</ModalTitle>
          <ModalClose />
        </ModalHeader>
        <ModalBody>
          <div className="space-y-3">
            <Text size="sm">
              Your request to join team{' '}
              <Text as="span" weight="semibold" className="font-mono">
                {typeof modal === 'object' && modal !== null && modal.type === 'pending-request'
                  ? modal.teamCode
                  : ''}
              </Text>{' '}
              has been sent to the team admins.
            </Text>
            <Text size="sm" variant="muted">
              You&apos;ll receive a notification when your request is reviewed. The team will appear
              in your teams list with a &quot;Pending&quot; badge.
            </Text>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="primary" fullWidth onClick={closeModal}>
            Got it
          </Button>
        </ModalFooter>
      </Modal>

      {/* Share team via QR code */}
      <Modal open={modal === 'share'} onOpenChange={(open) => !open && closeModal()} size="md">
        <ModalHeader>
          <ModalTitle>Share Team</ModalTitle>
          <ModalClose />
        </ModalHeader>
        <ModalBody>
          <div className="flex flex-col items-center gap-4">
            <Text variant="muted" size="sm" className="text-center">
              Scan this QR code to create an account and join{' '}
              <Text as="span" weight="semibold">
                {selectedTeam?.name}
              </Text>{' '}
              automatically.
            </Text>
            <div
              className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-neutral-200"
              role="img"
              aria-label={`QR code to join team ${selectedTeam?.name ?? ''}`}
              data-testid="team-share-qr"
            >
              {joinUrl && <QRCodeSVG value={joinUrl} size={220} marginSize={1} />}
            </div>
            <div className="w-full rounded-lg bg-neutral-100 p-3 dark:bg-neutral-800">
              <Text
                size="xs"
                className="break-all font-mono text-neutral-600 dark:text-neutral-300"
                data-testid="team-share-link"
              >
                {joinUrl}
              </Text>
            </div>
          </div>
        </ModalBody>
        <ModalFooter>
          <div className="flex w-full gap-2">
            <Button
              variant="outline"
              fullWidth
              onClick={copyJoinLink}
              leftIcon={<FontAwesomeIcon icon={faCopy} />}
            >
              {linkCopied ? 'Copied!' : 'Copy Link'}
            </Button>
            {typeof navigator !== 'undefined' && 'share' in navigator && (
              <Button variant="primary" fullWidth onClick={shareJoinLink}>
                Share…
              </Button>
            )}
          </div>
        </ModalFooter>
      </Modal>
    </AppPage>
  );
};
