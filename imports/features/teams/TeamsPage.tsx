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
import { Meteor } from 'meteor/meteor';
import { useFind, useSubscribe } from 'meteor/react-meteor-data';
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
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
import React, { useCallback, useMemo, useState } from 'react';

import { useTeam } from '../../lib/TeamContext';
import { useMethod } from '../../lib/useMethod';
import { Teams } from './api';
import { TeamChart } from './TeamChart';

// ─── TeamsPage ────────────────────────────────────────────────────────────────

export const TeamsPage: React.FC = () => {
  const userId = Meteor.userId();
  const { teams, teamsReady, selectedTeamId, setSelectedTeamId, isAdmin } = useTeam();

  // Subscribe to team members
  useSubscribe('teamMembers', selectedTeamId ?? '');

  const members = useFind(
    () => Meteor.users.find({}, { fields: { 'emails.address': 1, profile: 1 } }),
    [selectedTeamId],
  );

  const selectedTeam = teams.find((t) => t._id === selectedTeamId) ?? null;

  // Methods
  const createTeam = useMethod<[{ name: string; description?: string }], { teamId: string; code: string }>('teams.create');
  const joinTeam = useMethod<[{ teamCode: string }], string>('teams.join');
  const updateName = useMethod<[{ teamId: string; newName: string }]>('teams.updateName');
  const deleteTeam = useMethod<[string]>('teams.delete');
  const addAdmin = useMethod<[{ teamId: string; userId: string }]>('teams.addAdmin');
  const removeAdmin = useMethod<[{ teamId: string; userId: string }]>('teams.removeAdmin');
  const removeMember = useMethod<[{ teamId: string; userId: string }]>('teams.removeMember');
  const inviteMember = useMethod<[{ teamId: string; email: string }], string>('teams.invite');
  const setPassword = useMethod<[{ teamId: string; userId: string; newPassword: string }]>('teams.setMemberPassword');

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

  const [menuOpen, setMenuOpen] = useState<string | null>(null);

  const teamOptions = useMemo(
    () =>
      teams.map((t) => ({
        value: t._id!,
        label: t.isPersonal ? 'Personal Workspace' : t.name,
      })),
    [teams],
  );

  // ── Handlers ──

  const handleCreate = useCallback(async () => {
    if (!formValue.trim()) return;
    try {
      const result = await createTeam.call({
        name: formValue.trim(),
        description: createDescription.trim() || undefined,
      });
      setSelectedTeamId(result.teamId);
      setModal({ type: 'created', code: result.code });
      setFormValue('');
      setCreateDescription('');
    } catch (e: any) {
      setFormError(e.reason || 'Failed to create team');
    }
  }, [formValue, createDescription, createTeam, setSelectedTeamId]);

  const handleJoin = useCallback(async () => {
    if (!formValue.trim()) return;
    try {
      const teamId = await joinTeam.call({ teamCode: formValue.trim() });
      setSelectedTeamId(teamId);
      closeModal();
    } catch (e: any) {
      setFormError(e.reason || 'Failed to join team');
    }
  }, [formValue, joinTeam, setSelectedTeamId]);

  const handleRename = useCallback(async () => {
    if (!formValue.trim() || !selectedTeamId) return;
    try {
      await updateName.call({ teamId: selectedTeamId, newName: formValue.trim() });
      closeModal();
    } catch (e: any) {
      setFormError(e.reason || 'Failed to rename');
    }
  }, [formValue, selectedTeamId, updateName]);

  const handleDelete = useCallback(async () => {
    if (!selectedTeamId) return;
    try {
      await deleteTeam.call(selectedTeamId);
      closeModal();
    } catch (e: any) {
      setFormError(e.reason || 'Failed to delete');
    }
  }, [selectedTeamId, deleteTeam]);

  const handleInvite = useCallback(async () => {
    if (!formValue.trim() || !selectedTeamId) return;
    try {
      await inviteMember.call({ teamId: selectedTeamId, email: formValue.trim() });
      closeModal();
    } catch (e: any) {
      setFormError(e.reason || 'Failed to invite');
    }
  }, [formValue, selectedTeamId, inviteMember]);

  const handleSetPassword = useCallback(async (memberId: string) => {
    if (!formValue.trim() || !selectedTeamId) return;
    try {
      await setPassword.call({ teamId: selectedTeamId, userId: memberId, newPassword: formValue.trim() });
      closeModal();
    } catch (e: any) {
      setFormError(e.reason || 'Failed to set password');
    }
  }, [formValue, selectedTeamId, setPassword]);

  const handleRemoveMember = useCallback(async (memberId: string) => {
    if (!selectedTeamId) return;
    try {
      await removeMember.call({ teamId: selectedTeamId, userId: memberId });
      closeModal();
    } catch (e: any) {
      setFormError(e.reason || 'Failed to remove member');
    }
  }, [selectedTeamId, removeMember]);

  const copyCode = useCallback(() => {
    if (selectedTeam?.code) {
      navigator.clipboard.writeText(selectedTeam.code);
    }
  }, [selectedTeam]);

  const getName = (u: Meteor.User) => {
    const p = u.profile as { firstName?: string; lastName?: string } | undefined;
    if (p?.firstName || p?.lastName) return [p.firstName, p.lastName].filter(Boolean).join(' ');
    return u.emails?.[0]?.address?.split('@')[0] ?? 'Unknown';
  };

  if (!teamsReady) {
    return (
      <div className="flex items-center justify-center p-12">
        <Spinner size="lg" label="Loading teams…" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 md:p-6">
      {/* Header actions */}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="primary"
          leftIcon={<FontAwesomeIcon icon={faPlus} />}
          onClick={() => setModal('create')}
        >
          Create Team
        </Button>
        <Button
          variant="outline"
          leftIcon={<FontAwesomeIcon icon={faRightToBracket} />}
          onClick={() => setModal('join')}
        >
          Join Team
        </Button>
        {/* Team switcher */}
        {teams.length > 1 && (
          <div className="ml-auto">
            <Select
              label="Team"
              hideLabel
              size="sm"
              options={teamOptions}
              value={selectedTeamId ?? ''}
              onValueChange={setSelectedTeamId}
            />
          </div>
        )}
      </div>

      {/* Current team card */}
      {selectedTeam && (
        <Card padding="none">
          {/* Team header */}
          <CardHeader className="flex flex-row items-center justify-between px-5 py-4">
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
                  <Badge variant="secondary" size="sm">{selectedTeam.code}</Badge>
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
                  onClick={() => { setFormValue(selectedTeam.name); setModal('rename'); }}
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
          </CardHeader>

          {/* Members list */}
          <CardContent className="px-5 py-3">
            <div className="mb-3 flex items-center justify-between">
              <Text variant="muted" size="xs" weight="semibold" className="uppercase tracking-widest">
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
                const user = members.find((u) => u._id === memberId);
                const name = user ? getName(user) : memberId;
                const email = user?.emails?.[0]?.address ?? '';
                const isMemberAdmin = selectedTeam.admins.includes(memberId);
                const isMe = memberId === userId;

                return (
                  <li key={memberId} className="flex items-center gap-3 py-2.5">
                    <Avatar name={name} size="sm" />
                    <div className="min-w-0 flex-1">
                      <Text size="sm" weight="medium">
                        {name} {isMe && <Text as="span" variant="muted" size="xs">(you)</Text>}
                      </Text>
                      {email && <Text variant="muted" size="xs">{email}</Text>}
                    </div>
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
                            onClick={() => addAdmin.call({ teamId: selectedTeamId!, userId: memberId })}
                          >
                            Make Admin
                          </DropdownItem>
                        ) : (
                          <DropdownItem
                            icon={<FontAwesomeIcon icon={faShield} />}
                            onClick={() => removeAdmin.call({ teamId: selectedTeamId!, userId: memberId })}
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
          </CardContent>
        </Card>
      )}

      {/* Chart */}
      {selectedTeam && !selectedTeam.isPersonal && (
        <Card padding="none">
          <CardHeader className="px-5 py-4">
            <CardTitle>Chart</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <TeamChart
              teamName={selectedTeam.name}
              members={selectedTeam.members.map((memberId) => {
                const user = members.find((u) => u._id === memberId);
                return {
                  id: memberId,
                  name: user ? getName(user) : memberId,
                  email: user?.emails?.[0]?.address,
                  isAdmin: selectedTeam.admins.includes(memberId),
                };
              })}
            />
          </CardContent>
        </Card>
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
            isLoading={createTeam.loading}
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
            isLoading={joinTeam.loading}
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
          <Button
            variant="primary"
            fullWidth
            onClick={handleRename}
            isLoading={updateName.loading}
          >
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
          {formError && <Text variant="destructive" size="xs" className="mt-2">{formError}</Text>}
        </ModalBody>
        <ModalFooter>
          <Button variant="outline" onClick={closeModal}>Cancel</Button>
          <Button
            variant="danger"
            onClick={handleDelete}
            isLoading={deleteTeam.loading}
          >
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
          <Button
            variant="primary"
            fullWidth
            onClick={handleInvite}
            isLoading={inviteMember.loading}
          >
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
            isLoading={setPassword.loading}
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
          {formError && <Text variant="destructive" size="xs" className="mt-2">{formError}</Text>}
        </ModalBody>
        <ModalFooter>
          <Button variant="outline" onClick={closeModal}>Cancel</Button>
          <Button
            variant="danger"
            onClick={() =>
              typeof modal === 'object' &&
              modal !== null &&
              modal.type === 'remove' &&
              handleRemoveMember(modal.memberId)
            }
            isLoading={removeMember.loading}
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
              {typeof modal === 'object' && modal !== null && modal.type === 'created' ? modal.code : ''}
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
          <Button variant="primary" fullWidth onClick={closeModal}>Done</Button>
        </ModalFooter>
      </Modal>
    </div>
  );
};
