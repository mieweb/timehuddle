import { Button, Card, CardContent, CardHeader, CardTitle, Input, Spinner, Text } from '@mieweb/ui';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { ApiError, orgAdminApi, type AdminOrganization } from '../../lib/api';
import { hasDefaultOrganizationAdminAccess } from '../../lib/organizationAccess';
import { useSession } from '../../lib/useSession';
import { AppPage } from '../../ui/AppPage';

export const OrganizationSettingsPage: React.FC = () => {
  const { user } = useSession();
  const canAccess = hasDefaultOrganizationAdminAccess(user);
  const [organization, setOrganization] = useState<AdminOrganization | null>(null);
  const [nameValue, setNameValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadOrganization = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const org = await orgAdminApi.getOrganization();
      setOrganization(org);
      setNameValue(org.name);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Failed to load organization details');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!canAccess) return;
    void loadOrganization();
  }, [canAccess, loadOrganization]);

  const hasNameChanges = useMemo(
    () => !!organization && nameValue.trim() !== organization.name,
    [nameValue, organization],
  );

  const handleSaveName = useCallback(async () => {
    if (!hasNameChanges || !organization) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await orgAdminApi.updateOrganizationName(nameValue.trim());
      setOrganization(updated);
      setNameValue(updated.name);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Failed to update organization name');
      }
    } finally {
      setSaving(false);
    }
  }, [hasNameChanges, nameValue, organization]);

  if (!canAccess) {
    return (
      <AppPage>
        <Card padding="lg" className="">
          <CardHeader>
            <CardTitle>Organization Settings Unavailable</CardTitle>
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
    <AppPage>
      <Card padding="lg" className="space-y-4">
        <CardHeader className="">
          <div>
            <CardTitle>Organization Settings</CardTitle>
            <Text variant="muted" size="sm">
              Update settings for the default organization.
            </Text>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {error && (
            <Text
              size="sm"
              className="rounded-md bg-red-50 px-3 py-2 text-red-700 dark:bg-red-950/30 dark:text-red-300"
            >
              {error}
            </Text>
          )}

          {loading ? (
            <div className="flex justify-center py-6">
              <Spinner size="lg" label="Loading organization" />
            </div>
          ) : (
            <div className="space-y-3">
              <Text variant="muted" size="sm">
                Organization name
              </Text>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Input
                  label="Organization name"
                  hideLabel
                  value={nameValue}
                  onChange={(e) => setNameValue(e.target.value)}
                  placeholder="Organization name"
                />
                <Button
                  variant="secondary"
                  onClick={() => void handleSaveName()}
                  disabled={!hasNameChanges || saving || !nameValue.trim()}
                  isLoading={saving}
                >
                  Save Name
                </Button>
              </div>
              <Text variant="muted" size="xs">
                Key: {organization?.key ?? '—'}
              </Text>
            </div>
          )}
        </CardContent>
      </Card>
    </AppPage>
  );
};
