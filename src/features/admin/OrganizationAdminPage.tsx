import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Text } from '@mieweb/ui';
import React from 'react';

import { hasDefaultOrganizationAdminAccess } from '../../lib/organizationAccess';
import { useSession } from '../../lib/useSession';
import { AppPage } from '../../ui/AppPage';
import { useRouter } from '../../ui/router';

export const OrganizationAdminPage: React.FC = () => {
  const { user } = useSession();
  const { navigate } = useRouter();
  const canAccess = hasDefaultOrganizationAdminAccess(user);

  if (!canAccess) {
    return (
      <AppPage>
        <Card padding="lg" className="mx-auto max-w-2xl text-center">
          <CardHeader>
            <CardTitle>Organization Admin Unavailable</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Text variant="muted" size="sm">
              This page is restricted to default organization users with owner or admin role.
            </Text>
          </CardContent>
        </Card>
      </AppPage>
    );
  }

  return (
    <AppPage subtitle="Admin / Organization">
      <Card padding="lg" className="space-y-4">
        <CardHeader className="flex items-center justify-between gap-3">
          <div>
            <CardTitle>Organization Admin</CardTitle>
            <Text variant="muted" size="sm">
              Manage organization-level admin tools.
            </Text>
          </div>
          <Badge variant="default">Admin</Badge>
        </CardHeader>

        <CardContent className="space-y-4">
          <Text variant="muted" size="sm">
            Choose an admin area below.
          </Text>

          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => navigate('/app/admin/users')}>
              Members
            </Button>
            <Button variant="secondary" onClick={() => navigate('/app/admin/organization/settings')}>
              Organization Settings
            </Button>
          </div>
        </CardContent>
      </Card>
    </AppPage>
  );
};
