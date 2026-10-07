import { Button, Skeleton, Text } from '@mieweb/ui';
import { useRefresh } from '../../lib/RefreshContext';
import React, { useCallback, useEffect, useState } from 'react';

import { ApiError, orgApi, type OrganizationAdminUser } from '../../lib/api';
import { useTeam } from '../../lib/TeamContext';
import { useLatestRequest } from '../../lib/useLatestRequest';
import { useScopeChange } from '../../lib/useScopeChange';
import { AppPage } from '../../ui/AppPage';
import { LoadFailedBoundary } from '../../ui/LoadFailedBoundary';
import { LoadingRegion } from '../../ui/PageSkeleton';

const OrganizationChart = React.lazy(() =>
  import('./OrganizationChart').then((mod) => ({ default: mod.OrganizationChart })),
);

export const OrganizationPage: React.FC = () => {
  const { selectedOrgId, organizations } = useTeam();
  const [organizationName, setOrganizationName] = useState<string | null>(null);
  const [displayUsers, setDisplayUsers] = useState<OrganizationAdminUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isNewOrg = useScopeChange();
  // A load for the org just left can still be in flight on return; only the
  // newest may write, and selecting no org retires it too.
  const beginLoad = useLatestRequest();
  const loadOrganizationData = useCallback(async () => {
    const isLatest = beginLoad();
    if (!selectedOrgId) {
      isNewOrg(null);
      setOrganizationName(null);
      setDisplayUsers([]);
      setError(null);
      setLoading(false);
      return;
    }

    // Kept mounted: a return reloads quietly behind the chart shown; only a new
    // org clears the old one's and shows the loading state.
    if (isNewOrg(selectedOrgId)) {
      setOrganizationName(null);
      setDisplayUsers([]);
      setLoading(true);
    }
    setError(null);
    try {
      const [org, members] = await Promise.all([
        orgApi.getOrganizationById(selectedOrgId),
        orgApi.listOrganizationUsers(selectedOrgId),
      ]);
      if (!isLatest()) return;
      setOrganizationName(org.name);
      setDisplayUsers(members);
    } catch (err) {
      if (!isLatest()) return;
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Failed to load organization chart data');
      }
    } finally {
      if (isLatest()) setLoading(false);
    }
  }, [selectedOrgId, isNewOrg, beginLoad]);

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
            <OrganizationChartSkeleton />
          ) : (
            <LoadFailedBoundary>
              <React.Suspense fallback={<OrganizationChartSkeleton />}>
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
            </LoadFailedBoundary>
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

/** A root card over a row of reports, in the chart's place while it loads. */
const OrganizationChartSkeleton: React.FC = () => (
  <LoadingRegion
    label="Loading organization chart…"
    className="org-chart-skeleton h-full items-center justify-center"
  >
    <div className="org-chart-skeleton-tree flex flex-col items-center gap-8">
      <Skeleton width={180} height={64} className="rounded-xl" />
      <div className="org-chart-skeleton-reports flex gap-6">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} width={150} height={56} className="rounded-xl" />
        ))}
      </div>
    </div>
  </LoadingRegion>
);
