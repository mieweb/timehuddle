import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Switch,
  Text,
} from '@mieweb/ui';
import React, { useCallback, useState } from 'react';

import { ApiError, orgApi } from '../../lib/api';
import { useTeam } from '../../lib/TeamContext';
import { hasEnterpriseAdminAccess } from '../../lib/organizationAccess';
import { AppPage } from '../../ui/AppPage';
import { useRouter } from '../../ui/router';

export const OrganizationCreatePage: React.FC = () => {
  const { navigate } = useRouter();
  const { enterprises, selectedEnterpriseId, setSelectedOrgId, refetchOrganizations } = useTeam();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [slug, setSlug] = useState('');
  const [allowAutoJoin, setAllowAutoJoin] = useState(true);
  const [joinOrgId, setJoinOrgId] = useState('');

  const selectedEnterprise = selectedEnterpriseId
    ? (enterprises.find((enterprise) => enterprise.id === selectedEnterpriseId) ?? null)
    : null;
  const canCreateOrganization = hasEnterpriseAdminAccess(enterprises, selectedEnterpriseId);

  const handleCreate = useCallback(async () => {
    if (!selectedEnterpriseId || !name.trim()) return;

    setSaving(true);
    setError(null);
    try {
      const organization = await orgApi.createOrganization({
        enterpriseId: selectedEnterpriseId,
        name: name.trim(),
        key: key.trim() || undefined,
        slug: slug.trim() || undefined,
        allowAutoJoin,
      });
      refetchOrganizations();
      setSelectedOrgId(organization.id);
      navigate('/app/organization');
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Failed to create organization');
      }
    } finally {
      setSaving(false);
    }
  }, [
    allowAutoJoin,
    key,
    name,
    navigate,
    refetchOrganizations,
    selectedEnterpriseId,
    setSelectedOrgId,
    slug,
  ]);

  const handleJoin = useCallback(async () => {
    if (!joinOrgId.trim()) return;

    setSaving(true);
    setError(null);
    try {
      const membership = await orgApi.joinOrganization(joinOrgId.trim());
      refetchOrganizations();
      setSelectedOrgId(membership.orgId);
      navigate('/app/organization');
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Failed to join organization');
      }
    } finally {
      setSaving(false);
    }
  }, [joinOrgId, navigate, refetchOrganizations, setSelectedOrgId]);

  return (
    <AppPage>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card padding="lg" className="space-y-4">
          <CardHeader>
            <div>
              <CardTitle>Create Organization</CardTitle>
              <Text variant="muted" size="sm">
                Create a new organization under the currently selected enterprise.
              </Text>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {selectedEnterprise && <Badge variant="secondary">{selectedEnterprise.name}</Badge>}
            {error && (
              <Text
                size="sm"
                className="rounded-md bg-red-50 px-3 py-2 text-red-700 dark:bg-red-950/30 dark:text-red-300"
              >
                {error}
              </Text>
            )}
            <Input
              label="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Design Systems"
              disabled={!canCreateOrganization || saving}
            />
            <Input
              label="Key"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="design_systems"
              disabled={!canCreateOrganization || saving}
            />
            <Input
              label="Slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="design-systems"
              disabled={!canCreateOrganization || saving}
            />
            <div className="flex items-center justify-between rounded-xl border border-neutral-200/70 px-3 py-2 dark:border-neutral-800">
              <div>
                <Text size="sm" weight="medium">
                  Allow Auto-Join
                </Text>
                <Text variant="muted" size="xs">
                  New team joins can automatically create org membership.
                </Text>
              </div>
              <Switch
                checked={allowAutoJoin}
                onCheckedChange={setAllowAutoJoin}
                disabled={!canCreateOrganization || saving}
                aria-label="Toggle organization auto-join"
              />
            </div>
            <Button
              variant="primary"
              onClick={() => void handleCreate()}
              disabled={!canCreateOrganization || saving || !name.trim() || !selectedEnterpriseId}
            >
              Create Organization
            </Button>
            {!canCreateOrganization && (
              <Text variant="muted" size="sm">
                Enterprise owners and admins can create organizations for the selected enterprise.
              </Text>
            )}
          </CardContent>
        </Card>

        <Card padding="lg" className="space-y-4">
          <CardHeader>
            <div>
              <CardTitle>Join Organization</CardTitle>
              <Text variant="muted" size="sm">
                Use an organization ID from an invite or admin handoff to join directly.
              </Text>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <Input
              label="Organization ID"
              value={joinOrgId}
              onChange={(e) => setJoinOrgId(e.target.value)}
              placeholder="665f0d3fd2be7e1f1d3f88b2"
              disabled={saving}
            />
            <Button
              variant="secondary"
              onClick={() => void handleJoin()}
              disabled={saving || !joinOrgId.trim()}
            >
              Join Organization
            </Button>
            <Text variant="muted" size="sm">
              This uses the scoped organization join endpoint and respects the organization's
              auto-join policy.
            </Text>
          </CardContent>
        </Card>
      </div>
    </AppPage>
  );
};
