/**
 * CreateTeamModal — the one "Create Team" form, shared by the Teams page's
 * + button and the header switcher's "+ New team" action.
 *
 * Creates the team in the currently selected organization, selects it, and
 * refetches teams. What happens next is the caller's call via `onCreated` —
 * the Teams page shows the team-code modal, the switcher just closes.
 */
import {
  Button,
  Input,
  ModalBody,
  ModalClose,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Textarea,
} from '@mieweb/ui';
import { AppModal } from '@ui/AppModal';
import React, { useCallback, useEffect, useRef, useState } from 'react';

import type { Team } from '../../lib/api';
import { teamApi } from '../../lib/api';
import { useTeam } from '../../lib/TeamContext';

interface CreateTeamModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (team: Team) => void;
}

export const CreateTeamModal: React.FC<CreateTeamModalProps> = ({
  open,
  onOpenChange,
  onCreated,
}) => {
  const { selectedOrgId, setSelectedTeamId, refetchTeams } = useTeam();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // The library Modal's focus trap moves focus to its first focusable element
  // (the close button), overriding `autoFocus`. This effect runs after the
  // trap's, so the name field wins.
  useEffect(() => {
    if (open) nameInputRef.current?.focus();
  }, [open]);

  const resetForm = () => {
    setName('');
    setDescription('');
    setError(null);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) resetForm();
    onOpenChange(next);
  };

  const handleCreate = useCallback(async () => {
    if (!name.trim()) return;
    if (!selectedOrgId) {
      setError('Select an organization before creating a team.');
      return;
    }
    setLoading(true);
    try {
      const team = await teamApi.createTeam({
        name: name.trim(),
        description: description.trim() || undefined,
        orgId: selectedOrgId,
      });
      setSelectedTeamId(team.id, team);
      resetForm();
      onCreated(team);
      refetchTeams();
    } catch (e: any) {
      setError(e.message || 'Failed to create team');
    } finally {
      setLoading(false);
    }
  }, [name, description, selectedOrgId, setSelectedTeamId, refetchTeams, onCreated]);

  return (
    <AppModal open={open} onOpenChange={handleOpenChange} size="md">
      <ModalHeader>
        <ModalTitle>Create Team</ModalTitle>
        <ModalClose />
      </ModalHeader>
      <ModalBody>
        <div className="create-team-form space-y-3">
          <Input
            ref={nameInputRef}
            label="Team name"
            hideLabel
            placeholder="Team name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            error={error ?? undefined}
          />
          <Textarea
            aria-label="Team description"
            placeholder="Team description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
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
          isLoading={loading}
          loadingText="Creating…"
          disabled={!selectedOrgId}
        >
          Create
        </Button>
      </ModalFooter>
    </AppModal>
  );
};
