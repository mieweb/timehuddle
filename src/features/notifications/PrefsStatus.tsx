import { Spinner, Text } from '@mieweb/ui';
import React from 'react';

/** A notification-preferences card's spinner while loading, and its save/load error, announced. */
export const PrefsStatus: React.FC<{ loading: boolean; error: string | null }> = ({
  loading,
  error,
}) => (
  <>
    <div aria-live="polite" className="prefs-status-message empty:hidden">
      {error && (
        <Text size="sm" className="px-5 py-3 text-destructive">
          {error}
        </Text>
      )}
    </div>
    {loading && !error && (
      <div className="prefs-status-loading flex justify-center py-6">
        <Spinner size="md" />
      </div>
    )}
  </>
);
