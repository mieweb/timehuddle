import { Button, Spinner, Text } from '@mieweb/ui';
import { useRefresh } from '../../lib/RefreshContext';
import React, { useCallback, useEffect, useState } from 'react';

import { ApiError, orgApi, type OrganizationAdminUser } from '../../lib/api';
import { useTeam } from '../../lib/TeamContext';
import { AppPage } from '../../ui/AppPage';

const OrganizationChart = React.lazy(() =>
  import('./OrganizationChart').then((mod) => ({ default: mod.OrganizationChart })),
);

export const OrganizationPage: React.FC = () => {
  const { selectedOrgId, organizations } = useTeam();
  const [organizationName, setOrganizationName] = useState<string | null>(null);
  const [displayUsers, setDisplayUsers] = useState<OrganizationAdminUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadOrganizationData = useCallback(async () => {
    if (!selectedOrgId) {
      setOrganizationName(null);
      setDisplayUsers([]);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const [org, members] = await Promise.all([
        orgApi.getOrganizationById(selectedOrgId),
        orgApi.listOrganizationUsers(selectedOrgId),
      ]);
      setOrganizationName(org.name);
      setDisplayUsers(members);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Failed to load organization chart data');
      }
    } finally {
      setLoading(false);
    }
  }, [selectedOrgId]);

  useEffect(() => {
    void loadOrganizationData();
  }, [loadOrganizationData]);

  useRefresh(loadOrganizationData);

  if (!organizationName && !loading) {
    const canRenderFromContext = organizations.length > 0;
    if (canRenderFromContext && !selectedOrgId) {
      return null;
    }

    return (
      <AppPage fill flush>
        <div className="flex h-full items-center justify-center px-6 text-center">
          <Text variant="muted" size="sm">
            No organization data available.
          </Text>
        </div>
      </AppPage>
    );
  }

  return (
    <AppPage fill flush>
      <div className="flex h-full min-h-0 w-full flex-col overflow-hidden">
        <div className="relative min-h-0 flex-1">
          {loading ? (
            <div className="flex h-full items-center justify-center">
              <Spinner size="lg" label="Loading organization chart" />
            </div>
          ) : (
            <React.Suspense
              fallback={
                <div className="flex h-full items-center justify-center">
                  <Spinner size="lg" label="Loading chart" />
                </div>
              }
            >
              <OrganizationChart
                organizationName={organizationName || 'Organization'}
                members={displayUsers.map((orgUser) => ({
                  id: orgUser.id,
                  name: orgUser.name,
                  email: orgUser.email,
                  username: orgUser.username,
                  image: orgUser.image ?? null,
                  role: orgUser.role,
                  reportsToUserId: orgUser.reportsToUserId || null,
                }))}
              />
            </React.Suspense>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-neutral-200 px-3 py-2 dark:border-neutral-700 md:px-4">
          {error && (
            <Text size="sm" className="me-auto text-red-700 dark:text-red-300">
              {error}
            </Text>
          )}
          <Text variant="muted" size="sm">
            Members: {displayUsers.length}
          </Text>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void loadOrganizationData()}
            disabled={loading}
          >
            Refresh
          </Button>
        </div>
      </div>
    </AppPage>
  );
};
