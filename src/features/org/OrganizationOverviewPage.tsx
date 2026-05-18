import { Button, Card, CardContent, CardHeader, CardTitle, Text } from '@mieweb/ui';
import React, { useCallback, useEffect, useState } from 'react';

import { orgAdminApi, type AdminOrganization } from '../../lib/api';
import { hasDefaultOrganizationAdminAccess } from '../../lib/organizationAccess';
import { useSession } from '../../lib/useSession';
import { AppPage } from '../../ui/AppPage';
import { useRouter } from '../../ui/router';

export const OrganizationOverviewPage: React.FC = () => {
  const { user } = useSession();
  const { navigate } = useRouter();
  const canAccess = hasDefaultOrganizationAdminAccess(user);
  const [organization, setOrganization] = useState<AdminOrganization | null>(null);

  const loadOrganization = useCallback(async () => {
    try {
      const org = await orgAdminApi.getOrganization();
      setOrganization(org);
    } catch {
      // Silently handle error, display fallback text
    }
  }, []);

  useEffect(() => {
    if (!canAccess) return;
    void loadOrganization();
  }, [canAccess, loadOrganization]);

  if (!canAccess) {
    return (
      <AppPage>
        <Card padding="lg" className="mx-auto max-w-2xl text-center">
          <CardHeader>
            <CardTitle>Organization Admin Unavailable</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Text variant="muted" size="sm">
              This page is restricted to organization owners and admins.
            </Text>
          </CardContent>
        </Card>
      </AppPage>
    );
  }

  return (
    <AppPage>
      <Card padding="lg" className="space-y-4">
        <CardHeader className="">
          <div>
            <CardTitle>{organization?.name || 'Organization'} </CardTitle>
            <Text variant="muted" size="sm">
              Manage organization-level admin tools.
            </Text>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          <Text variant="muted" size="sm">
            Choose an admin area below.
          </Text>

          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => navigate('/org/members')}>
              Members
            </Button>
            <Button variant="secondary" onClick={() => navigate('/app/settings')}>
              Settings
            </Button>
          </div>
        </CardContent>
      </Card>
    </AppPage>
  );
};
