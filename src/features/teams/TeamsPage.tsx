/**
 * TeamsPage — Create, join, and manage teams.
 *
 * Features:
 *   • Create new team / Join existing with code
 *   • Team member list with admin controls
 *   • Copy team code, rename, delete team
 *   • Promote/demote admins, remove members, invite by email
 *   • Set member passwords (admin only)
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
  Avatar,
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
  Select,
  Spinner,
  Text,
} from '@mieweb/ui';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { teamApi, type TeamMember } from '../../lib/api';
import { useTeam } from '../../lib/TeamContext';
import { useSession } from '../../lib/useSession';
import { useRouter } from '../../ui/router';
const TeamChart = React.lazy(() => import('./TeamChart').then((m) => ({ default: m.TeamChart })));

// ─── TeamsPage ────────────────────────────────────────────────────────────────

export const TeamsPage: React.FC = () => {
  const { user } = useSession();
  const userId = user?.id ?? null;
  const { navigate } = useRouter();
  const { teams, teamsReady, selectedTeamId, setSelectedTeamId, isAdmin, refetchTeams } = useTeam();

  // Fetch members for selected team
  const [members, setMembers] = useState<TeamMember[]>([]);
  const fetchMembers = useCallback(async (teamId: string | null) => {
    if (!teamId) {
      setMembers([]);
      return;
    }
    try {
      const data = await teamApi.getMembers(teamId);
      setMembers(data);
    } catch {
      setMembers([]);
    }
  }, []);

  useEffect(() => {
    void fetchMembers(selectedTeamId);
  }, [selectedTeamId, fetchMembers]);

  const selectedTeam = teams.find((t) => t.id === selectedTeamId) ?? null;

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

  const teamOptions = useMemo(
    () =>
      teams.map((t) => ({
        value: t.id,
        label: t.isPersonal ? 'Personal Workspace' : t.name,
      })),
    [teams],
  );

  const membersById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);

  // ── Handlers ──

  const handleCreate = useCallback(async () => {
    if (!formValue.trim()) return;
    setCreateLoading(true);
    try {
      const team = await teamApi.createTeam({
        name: formValue.trim(),
        description: createDescription.trim() || undefined,
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
  }, [formValue, createDescription, setSelectedTeamId, refetchTeams]);

  const handleJoin = useCallback(async () => {
    if (!formValue.trim()) return;
    setJoinLoading(true);
    try {
      const team = await teamApi.joinTeam(formValue.trim());
      setSelectedTeamId(team.id);
      closeModal();
      refetchTeams();
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
    <div className="w-full space-y-4 px-3 py-3">
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
        {/* Team switcher — full width below buttons on mobile */}
        {teams.length > 1 && (
          <Select
            label="Switch team"
            hideLabel={false}
            options={teamOptions}
            value={selectedTeamId ?? ''}
            onValueChange={setSelectedTeamId}
          />
        )}
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

          {/* Members list */}
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
            <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {selectedTeam.members.map((memberId) => {
                const m = membersById.get(memberId);
                const name = m?.name ?? memberId;
                const email = m?.email ?? '';
                const isMemberAdmin = selectedTeam.admins.includes(memberId);
                const isMe = memberId === userId;

                return (
                  <li key={memberId} className="flex items-center gap-3 py-2.5">
                    <button
                      type="button"
                      onClick={() => navigate(`/app/profile/${memberId}`)}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
                      aria-label={`View ${name}'s profile`}
                    >
                      <Avatar name={name} size="sm" />
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
                        {email && (
                          <Text variant="muted" size="xs">
                            {email}
                          </Text>
                        )}
                      </div>
                    </button>
                    {isMemberAdmin && (
                      <Badge variant="warning" size="sm" icon={<FontAwesomeIcon icon={faCrown} />}>
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
        </div>
      )}

      {/* Chart */}
      {selectedTeam && !selectedTeam.isPersonal && (
        <div className="overflow-hidden">
          <div className="py-2">
            <CardTitle>Chart</CardTitle>
          </div>
          <div className="overflow-x-auto">
            <React.Suspense
              fallback={
                <div className="flex items-center justify-center p-8">
                  <Spinner size="lg" label="Loading chart…" />
                </div>
              }
            >
              <TeamChart
                teamName={selectedTeam.name}
                members={selectedTeam.members.map((memberId) => {
                  const m = membersById.get(memberId);
                  return {
                    id: memberId,
                    name: m?.name ?? memberId,
                    email: m?.email,
                    isAdmin: selectedTeam.admins.includes(memberId),
                  };
                })}
              />
            </React.Suspense>
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
            <textarea
              aria-label="Team description"
              placeholder="Team description (optional)"
              value={createDescription}
              onChange={(e) => setCreateDescription(e.target.value)}
              rows={4}
              maxLength={500}
              className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100"
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
    </div>
  );
};
