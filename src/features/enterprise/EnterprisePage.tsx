import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Select,
  Spinner,
  Text,
} from '@mieweb/ui';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { ApiError, enterpriseApi } from '../../lib/api';
import { useTeam } from '../../lib/TeamContext';
import { getEnterpriseRole } from '../../lib/organizationAccess';
import { AppPage } from '../../ui/AppPage';
import { useRouter } from '../../ui/router';

type EnterpriseDetail = Awaited<ReturnType<typeof enterpriseApi.get>>;

const roleOptions = [
  { value: 'owner', label: 'Owner' },
  { value: 'admin', label: 'Admin' },
];

export const EnterprisePage: React.FC = () => {
  const { navigate } = useRouter();
  const {
    enterprises,
    organizations,
    selectedEnterpriseId,
    setSelectedEnterpriseId,
    refetchEnterprises,
  } = useTeam();
  const [enterprise, setEnterprise] = useState<EnterpriseDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enterpriseName, setEnterpriseName] = useState('');
  const [memberUserId, setMemberUserId] = useState('');
  const [memberRole, setMemberRole] = useState<'owner' | 'admin'>('admin');

  const selectedRole = getEnterpriseRole(enterprises, selectedEnterpriseId);
  const selectedOrganizations = useMemo(
    () =>
      selectedEnterpriseId
        ? organizations.filter((organization) => organization.enterpriseId === selectedEnterpriseId)
        : [],
    [organizations, selectedEnterpriseId],
  );

  const loadEnterprise = useCallback(async () => {
    if (!selectedEnterpriseId) {
      setEnterprise(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const detail = await enterpriseApi.get(selectedEnterpriseId);
      setEnterprise(detail);
      setEnterpriseName(detail.name);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Failed to load enterprise details');
      }
    } finally {
      setLoading(false);
    }
  }, [selectedEnterpriseId]);

  useEffect(() => {
    void loadEnterprise();
  }, [loadEnterprise]);

  const handleSaveName = useCallback(async () => {
    if (!selectedEnterpriseId) return;
    const nextName = enterpriseName.trim();
    if (!nextName) {
      setError('Enterprise name is required');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const updated = await enterpriseApi.updateName(selectedEnterpriseId, nextName);
      setEnterprise(updated);
      setEnterpriseName(updated.name);
      refetchEnterprises();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Failed to update enterprise name');
      }
    } finally {
      setSaving(false);
    }
  }, [enterpriseName, refetchEnterprises, selectedEnterpriseId]);

  const handleAssignRole = useCallback(async () => {
    if (!selectedEnterpriseId || !memberUserId.trim()) return;

    setSaving(true);
    setError(null);
    try {
      await enterpriseApi.setMemberRole(selectedEnterpriseId, memberUserId.trim(), memberRole);
      setMemberUserId('');
      await loadEnterprise();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Failed to update enterprise member');
      }
    } finally {
      setSaving(false);
    }
  }, [loadEnterprise, memberRole, memberUserId, selectedEnterpriseId]);

  return (
    <AppPage>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(20rem,1fr)]">
        <Card padding="lg" className="space-y-4">
          <CardHeader>
            <CardTitle>{enterprise?.name || 'Enterprise Admin'}</CardTitle>
            <Text variant="muted" size="sm">
              Inspect the selected enterprise and manage elevated membership.
            </Text>
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
              <div className="flex justify-center py-12">
                <Spinner size="lg" label="Loading enterprise" />
              </div>
            ) : enterprise ? (
              <div className="space-y-4">
                <Card padding="md">
                  <CardContent className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{selectedOrganizations.length} organizations</Badge>
                    <Badge variant="secondary">{enterprise.slug}</Badge>
                    <Badge variant="outline">{enterprise.role}</Badge>
                  </CardContent>
                </Card>

                <Card padding="md" className="border border-neutral-200/70 dark:border-neutral-800">
                  <CardHeader>
                    <CardTitle>Name</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-end gap-3">
                      <div className="flex-1">
                        <Input
                          value={enterpriseName}
                          onChange={(e) => setEnterpriseName(e.target.value)}
                          placeholder="Enterprise Name"
                          disabled={!selectedRole || saving}
                        />
                      </div>
                      <Button
                        variant="primary"
                        onClick={() => void handleSaveName()}
                        disabled={
                          !selectedRole ||
                          saving ||
                          !enterpriseName.trim() ||
                          enterpriseName.trim() === enterprise.name
                        }
                      >
                        Save
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                <div className="grid gap-3 sm:grid-cols-2">
                  <Card padding="md" className="border border-neutral-200/70 dark:border-neutral-800">
                    <CardContent className="space-y-2">
                      <Text variant="muted" size="xs">
                        Owners
                      </Text>
                      <div className="flex flex-wrap gap-2">
                        {enterprise.owners.map((ownerId) => (
                          <Badge key={ownerId} variant="secondary">
                            {ownerId}
                          </Badge>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                  <Card
                    padding="md"
                    className="border border-neutral-200/70 dark:border-neutral-800"
                  >
                    <CardContent className="space-y-2">
                      <Text variant="muted" size="xs">
                        Admins
                      </Text>
                      <div className="flex flex-wrap gap-2">
                        {enterprise.admins.length > 0 ? (
                          enterprise.admins.map((adminId) => (
                            <Badge key={adminId} variant="outline">
                              {adminId}
                            </Badge>
                          ))
                        ) : (
                          <Text variant="muted" size="sm">
                            No enterprise admins yet.
                          </Text>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </div>

                <Card padding="md" className="border border-neutral-200/70 dark:border-neutral-800">
                  <CardHeader>
                    <CardTitle>Manage Enterprise Members</CardTitle>
                    <Text variant="muted" size="xs">
                      The current API assigns enterprise roles by user ID. Owners can promote or
                      demote elevated members here.
                    </Text>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <Input
                      label="User ID"
                      value={memberUserId}
                      onChange={(e) => setMemberUserId(e.target.value)}
                      placeholder="665f0d3fd2be7e1f1d3f88b2"
                      disabled={selectedRole !== 'owner' || saving}
                    />
                    <Select
                      label="Role"
                      value={memberRole}
                      onValueChange={(value) => setMemberRole(value as 'owner' | 'admin')}
                      options={roleOptions}
                      disabled={selectedRole !== 'owner' || saving}
                    />
                    <Button
                      variant="primary"
                      onClick={() => void handleAssignRole()}
                      disabled={selectedRole !== 'owner' || saving || !memberUserId.trim()}
                    >
                      Apply Role
                    </Button>
                  </CardContent>
                </Card>
              </div>
            ) : (
              <Text variant="muted" size="sm">
                No enterprise is available for your account yet.
              </Text>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card padding="lg" className="space-y-4">
            <CardHeader>
              <CardTitle>Switch Scope</CardTitle>
              <Text variant="muted" size="sm">
                Jump between enterprise scopes or continue into organization setup.
              </Text>
            </CardHeader>
            <CardContent className="space-y-3">
              {enterprises.map((item) => (
                <Button
                  key={item.id}
                  variant={item.id === selectedEnterpriseId ? 'primary' : 'outline'}
                  fullWidth
                  onClick={() => setSelectedEnterpriseId(item.id)}
                >
                  {item.name}
                </Button>
              ))}
              <Button
                variant="secondary"
                fullWidth
                onClick={() => navigate('/app/organization/create')}
              >
                Create Or Join Organization
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppPage>
  );
};
