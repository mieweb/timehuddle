import React, { useState } from 'react';

import { enterpriseApi } from '../lib/api';
import { useSession } from '../lib/useSession';
import { useTeam } from '../lib/TeamContext';
import { Button, ModalBody, ModalFooter, ModalHeader, ModalTitle, Text } from '@mieweb/ui';
import { AppModal } from './AppModal';

type Props = {
  onTaken: () => void;
};

export const InstallerModal: React.FC<Props> = ({ onTaken }) => {
  const { refetch: _refetch } = useSession();
  const { refetchEnterprises: _refetchEnterprises, refetchOrganizations: _refetchOrganizations } =
    useTeam();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleTakeOwnership = async () => {
    if (loading) return;
    setLoading(true);
    setError(null);

    try {
      await enterpriseApi.takeOwnership();
      onTaken();
      // Use full page reload to ensure all context providers fetch fresh data
      window.location.href = '/app/enterprise';
    } catch (err) {
      setError((err as Error).message || 'Unable to complete initial setup');
      setLoading(false);
    }
  };

  return (
    /* A setup gate, not a dismissible dialog: there is no close affordance and
       the user cannot proceed until ownership is taken. */
    <AppModal
      open
      onOpenChange={() => {}}
      size="md"
      closeOnOverlayClick={false}
      closeOnEscape={false}
    >
      <ModalHeader>
        <ModalTitle>Complete Initial Setup</ModalTitle>
      </ModalHeader>

      <ModalBody className="space-y-4">
        <Text as="p" variant="muted" size="sm">
          Finish setup for your default enterprise and organization so administration can be
          enabled.
        </Text>

        {error && (
          <Text variant="destructive" size="xs" weight="medium" as="div" role="alert">
            {error}
          </Text>
        )}
      </ModalBody>

      <ModalFooter>
        <Button
          variant="primary"
          fullWidth
          type="button"
          onClick={handleTakeOwnership}
          isLoading={loading}
          loadingText="Completing setup..."
        >
          Complete Setup
        </Button>
      </ModalFooter>
    </AppModal>
  );
};
