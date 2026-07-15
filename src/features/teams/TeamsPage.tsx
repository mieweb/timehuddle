/**
 * TeamsPage — Create, join, and manage teams.
 *
 * Features:
 *   • Create new team / Join existing with code
 *   • Team member list with admin controls
 *   • Copy team code, rename, delete team
 *   • Promote/demote admins, remove members, invite by email
 *   • Set member passwords (admin only)
 *   • Deep-link support: ?tab=timesheet&teamId=XXX&memberId=YYY
 */
import {
  faCopy,
  faCrown,
  faEllipsisV,
  faKey,
  faPen,
  faPlus,
  faRightToBracket,
  faShield,
  faTrash,
  faUserMinus,
  faUserPlus,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Text,
  Textarea,
} from '@mieweb/ui';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { teamApi, type TeamMember } from '../../lib/api';
import { useTeam } from '../../lib/TeamContext';
import { useSession } from '../../lib/useSession';
import { useRefresh } from '../../lib/RefreshContext';
import { usePresence } from '../../lib/usePresence';
import { useRouter } from '../../ui/router';
import { AppPage } from '../../ui/AppPage';
import { AdminTimesheetPanel } from './AdminTimesheetPanel';
import { PendingJoinRequests } from './PendingJoinRequests';
import { UserAvatar } from '../../ui/UserAvatar';
import { getDdpClient } from '../../lib/ddp';

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

  // Controlled tab value so deep-links can set the initial tab
  const [activeTab, setActiveTab] = useState<string>('members');
  const [initialMemberId, setInitialMemberId] = useState<string>('');
  const [urlCheckCounter, setUrlCheckCounter] = useState(0);

  // ── Parse deep-link query params whenever URL changes ──
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get('tab');
    const memberId = params.get('memberId');
    const teamId = params.get('teamId');

    if (tab === 'timesheet') setActiveTab('timesheet');
    if (memberId) setInitialMemberId(memberId);
    if (teamId && teams.some((t) => t.id === teamId)) setSelectedTeamId(teamId);

    // Clean up query params from URL without triggering a navigation
    if (tab || memberId || teamId) {
      const cleanUrl = window.location.pathname;
      window.history.replaceState(null, '', cleanUrl);
    }
  }, [pathname, urlCheckCounter, setSelectedTeamId, teams]);

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

  // Count of pending join requests for the selected team (admin only)
  const pendingRequestCount = useMemo(
    () => (selectedTeamId ? pendingRequests.filter((r) => r.teamId === selectedTeamId).length : 0),
    [selectedTeamId, pendingRequests],
  );

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

  // Modal state
  const [modal, setModal] = useState<
    | null
    | 'create'
    | 'join'
    | 'rename'
    | 'delete'
    | 'invite'
    | { type: 'password'; memberId: string }
    | { type: 'remove'; memberId: string }
    | { type: 'created'; code: string }
    | { type: 'pending-request'; teamCode: string }
  >(null);

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

  const handleRename = useCallback(async () => {
    if (!formValue.trim() || !selectedTeamId) return;
    setRenameLoading(true);
    try {
      await teamApi.renameTeam(selectedTeamId, formValue.trim());
      closeModal();
      refetchTeams();
    } catch (e: any) {
      setFormError(e.message || 'Failed to rename');
    } finally {
      setRenameLoading(false);
    }
  }, [formValue, selectedTeamId, refetchTeams]);

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
    if (!formValue.trim() || !selectedTeamId) return;
    setInviteLoading(true);
    try {
      await teamApi.inviteMember(selectedTeamId, formValue.trim());
      closeModal();
      await fetchMembers(selectedTeamId);
    } catch (e: any) {
      setFormError(e.message || 'Failed to invite');
    } finally {
      setInviteLoading(false);
    }
  }, [formValue, selectedTeamId, fetchMembers]);

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

  if (!teamsReady) {
    return (
      <div className="flex items-center justify-center p-12">
        <Spinner size="lg" label="Loading teams…" />
      </div>
    );
  }

  return (
    <AppPage>
      {/* Header actions */}
      <div className="space-y-3">
        <div className="flex gap-3">
          <Button
            variant="primary"
            fullWidth
            leftIcon={<FontAwesomeIcon icon={faPlus} />}
            onClick={() => setModal('create')}
          >
            Create Team
          </Button>
          <Button
            variant="outline"
            fullWidth
            leftIcon={<FontAwesomeIcon icon={faRightToBracket} />}
            onClick={() => setModal('join')}
          >
            Join Team
          </Button>
        </div>
      </div>

      {/* Current team card */}
      {selectedTeam && (
        <div>
          {/* Team header */}
          <div className="flex flex-row items-center justify-between py-2">
            <div>
              <CardTitle>
                {selectedTeam.isPersonal ? 'Personal Workspace' : selectedTeam.name}
              </CardTitle>
              {selectedTeam.description && (
                <Text variant="muted" size="sm" className="mt-1 max-w-xl">
                  {selectedTeam.description}
                </Text>
              )}
              {!selectedTeam.isPersonal && (
                <div className="mt-1 flex items-center gap-2">
                  <Badge variant="secondary" size="sm">
                    {selectedTeam.code}
                  </Badge>
                  <Button variant="link" size="sm" onClick={copyCode}>
                    <FontAwesomeIcon icon={faCopy} className="mr-1" />
                    Copy
                  </Button>
                </div>
              )}
            </div>
            {isAdmin && !selectedTeam.isPersonal && (
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => {
                    setFormValue(selectedTeam.name);
                    setModal('rename');
                  }}
                  aria-label="Rename"
                >
                  <FontAwesomeIcon icon={faPen} className="text-xs" />
                </Button>
                <Button
                  variant="danger"
                  size="icon"
                  onClick={() => setModal('delete')}
                  aria-label="Delete"
                >
                  <FontAwesomeIcon icon={faTrash} className="text-xs" />
                </Button>
              </div>
            )}
          </div>

          {/* Tabs: Members | Pending | Timesheet — controlled so deep-links can set initial tab */}
          <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-2">
            <TabsList className="w-full">
              <TabsTrigger value="members" className="flex-1">
                Members
              </TabsTrigger>
              {!selectedTeam.isPersonal && isAdmin && pendingRequestCount > 0 && (
                <TabsTrigger value="pending" className="flex-1">
                  Pending ({pendingRequestCount})
                </TabsTrigger>
              )}
              {!selectedTeam.isPersonal && isAdmin && (
                <TabsTrigger value="timesheet" className="flex-1">
                  Timesheet
                </TabsTrigger>
              )}
            </TabsList>

            <TabsContent value="members">
              <div className="py-1">
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
                            <Badge
                              variant="warning"
                              size="sm"
                              icon={<FontAwesomeIcon icon={faCrown} />}
                            >
                              Admin
                            </Badge>
                          )}
                          {isAdmin && !isMe && !selectedTeam.isPersonal && (
                            <Dropdown
                              trigger={
                                <Button variant="ghost" size="icon" aria-label="Member actions">
                                  <FontAwesomeIcon icon={faEllipsisV} className="text-xs" />
                                </Button>
                              }
                              placement="bottom-end"
                            >
                              {!isMemberAdmin ? (
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
                              )}
                              <DropdownItem
                                icon={<FontAwesomeIcon icon={faKey} />}
                                onClick={() => setModal({ type: 'password', memberId })}
                              >
                                Set Password
                              </DropdownItem>
                              <DropdownSeparator />
                              <DropdownItem
                                icon={<FontAwesomeIcon icon={faUserMinus} />}
                                variant="danger"
                                onClick={() => setModal({ type: 'remove', memberId })}
                              >
                                Remove Member
                              </DropdownItem>
                            </Dropdown>
                          )}
                        </li>
                      );
                    })}
                </ul>
              </div>
            </TabsContent>

            {!selectedTeam.isPersonal && isAdmin && selectedTeamId && (
              <TabsContent value="pending">
                <PendingJoinRequests teamId={selectedTeamId} />
              </TabsContent>
            )}

            {!selectedTeam.isPersonal && isAdmin && (
              <TabsContent value="timesheet">
                <AdminTimesheetPanel
                  members={members}
                  selectedTeamId={selectedTeamId}
                  teams={teams}
                  initialMemberId={initialMemberId}
                />
              </TabsContent>
            )}
          </Tabs>
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

      <Modal open={modal === 'rename'} onOpenChange={(open) => !open && closeModal()} size="md">
        <ModalHeader>
          <ModalTitle>Rename Team</ModalTitle>
          <ModalClose />
        </ModalHeader>
        <ModalBody>
          <Input
            label="New name"
            hideLabel
            value={formValue}
            onChange={(e) => setFormValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleRename()}
            error={formError ?? undefined}
            autoFocus
          />
        </ModalBody>
        <ModalFooter>
          <Button variant="primary" fullWidth onClick={handleRename} isLoading={renameLoading}>
            Save
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
            autoFocus
          />
        </ModalBody>
        <ModalFooter>
          <Button variant="primary" fullWidth onClick={handleInvite} isLoading={inviteLoading}>
            Send Invite
          </Button>
        </ModalFooter>
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
    </AppPage>
  );
};
