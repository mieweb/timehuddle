import React, { useId, useState } from 'react';

import { enterpriseApi } from '../lib/api';
import { useSession } from '../lib/useSession';
import { useTeam } from '../lib/TeamContext';
import { Button, Text } from '@mieweb/ui';

type Props = {
  onTaken: () => void;
};

export const InstallerModal: React.FC<Props> = ({ onTaken }) => {
  const { refetch: _refetch } = useSession();
  const { refetchEnterprises: _refetchEnterprises, refetchOrganizations: _refetchOrganizations } =
    useTeam();
  const labelId = useId();
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelId}
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-2xl dark:bg-neutral-900">
        <div className="mb-6 space-y-2">
          <h2
            id={labelId}
            className="text-2xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50"
          >
            Complete Initial Setup
          </h2>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            Finish setup for your default enterprise and organization so administration can be
            enabled.
          </p>
        </div>

        {error && (
          <Text variant="destructive" size="xs" weight="medium" as="div" role="alert">
            {error}
          </Text>
        )}

        <div className="mt-4">
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
        </div>
      </div>
    </div>
  );
};
