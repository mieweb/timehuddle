import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Select,
  Spinner,
  Switch,
  Text,
} from '@mieweb/ui';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { ApiError, enterpriseApi, orgApi } from '../../lib/api';
import { useTeam } from '../../lib/TeamContext';
import { getEnterpriseRole } from '../../lib/organizationAccess';
import { AppPage } from '../../ui/AppPage';

type EnterpriseDetail = Awaited<ReturnType<typeof enterpriseApi.get>>;

const roleOptions = [
  { value: 'owner', label: 'Owner' },
  { value: 'admin', label: 'Admin' },
];

export const EnterprisePage: React.FC = () => {
  const {
    enterprises,
    organizations,
    selectedEnterpriseId,
    refetchEnterprises,
    refetchOrganizations,
    setSelectedOrgId,
  } = useTeam();
  const [enterprise, setEnterprise] = useState<EnterpriseDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enterpriseName, setEnterpriseName] = useState('');
  const [memberUserId, setMemberUserId] = useState('');
  const [memberRole, setMemberRole] = useState<'owner' | 'admin'>('admin');
  const [memberSaving, setMemberSaving] = useState<Record<string, boolean>>({});
  const [userOptions, setUserOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [createOrgOpen, setCreateOrgOpen] = useState(false);
  const [orgName, setOrgName] = useState('');
  const [orgSlug, setOrgSlug] = useState('');
  const [orgAllowAutoJoin, setOrgAllowAutoJoin] = useState(true);
  const [orgSaving, setOrgSaving] = useState(false);
  const [orgError, setOrgError] = useState<string | null>(null);

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

  useEffect(() => {
    if (!selectedEnterpriseId || selectedRole !== 'owner') return;
    void enterpriseApi
      .searchUsers(selectedEnterpriseId, '')
      .then((users) =>
        setUserOptions(
          users.map((u) => ({
            value: u.id,
            label: u.username ? `${u.name} (@${u.username})` : u.name,
          })),
        ),
      )
      .catch(() => {
        /* silently ignore */
      });
  }, [selectedEnterpriseId, selectedRole]);

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

  const handleCreateOrg = useCallback(async () => {
    if (!selectedEnterpriseId || !orgName.trim()) return;
    setOrgSaving(true);
    setOrgError(null);
    try {
      const org = await orgApi.createOrganization({
        enterpriseId: selectedEnterpriseId,
        name: orgName.trim(),
        slug: orgSlug.trim() || undefined,
        allowAutoJoin: orgAllowAutoJoin,
      });
      refetchOrganizations();
      setSelectedOrgId(org.id);
      setCreateOrgOpen(false);
      setOrgName('');
      setOrgSlug('');
      setOrgAllowAutoJoin(true);
    } catch (err) {
      setOrgError(err instanceof ApiError ? err.message : 'Failed to create organization');
    } finally {
      setOrgSaving(false);
    }
  }, [
    orgAllowAutoJoin,
    orgName,
    orgSlug,
    refetchOrganizations,
    selectedEnterpriseId,
    setSelectedOrgId,
  ]);

  const handleChangeRole = useCallback(
    async (userId: string, role: 'owner' | 'admin') => {
      if (!selectedEnterpriseId) return;
      setMemberSaving((prev) => ({ ...prev, [userId]: true }));
      setError(null);
      try {
        await enterpriseApi.setMemberRole(selectedEnterpriseId, userId, role);
        await loadEnterprise();
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Failed to update role');
      } finally {
        setMemberSaving((prev) => ({ ...prev, [userId]: false }));
      }
    },
    [loadEnterprise, selectedEnterpriseId],
  );

  const handleRemoveMember = useCallback(
    async (userId: string) => {
      if (!selectedEnterpriseId) return;
      setMemberSaving((prev) => ({ ...prev, [userId]: true }));
      setError(null);
      try {
        await enterpriseApi.removeMember(selectedEnterpriseId, userId);
        await loadEnterprise();
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Failed to remove member');
      } finally {
        setMemberSaving((prev) => ({ ...prev, [userId]: false }));
      }
    },
    [loadEnterprise, selectedEnterpriseId],
  );

  return (
    <AppPage>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(20rem,1fr)]">
        <Card padding="lg" className="space-y-4">
          <CardHeader>
            <CardTitle>{enterprise?.name || 'Enterprise Admin'}</CardTitle>
            <Text variant="muted" size="sm">
              Manage the enterprise.
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
                <Card className="border border-neutral-200/70 dark:border-neutral-800">
                  <CardHeader>
                    <CardTitle>Name</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-end gap-1">
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

                <Card padding="md" className="border border-neutral-200/70 dark:border-neutral-800">
                  <CardHeader>
                    <CardTitle>Members</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {(
                      enterprise.members ?? [
                        ...enterprise.owners.map((id) => ({
                          id,
                          name: id,
                          username: null,
                          role: 'owner' as const,
                        })),
                        ...enterprise.admins.map((id) => ({
                          id,
                          name: id,
                          username: null,
                          role: 'admin' as const,
                        })),
                      ]
                    ).map((member) => (
                      <div key={member.id} className="flex items-center gap-2">
                        <Text size="sm" className="min-w-0 flex-1 truncate">
                          {member.name}
                          {member.username && (
                            <span className="ml-1 text-xs text-neutral-400">
                              @{member.username}
                            </span>
                          )}
                        </Text>
                        <Select
                          value={member.role}
                          onValueChange={(value) =>
                            void handleChangeRole(member.id, value as 'owner' | 'admin')
                          }
                          options={roleOptions}
                          disabled={selectedRole !== 'owner' || !!memberSaving[member.id]}
                        />
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => void handleRemoveMember(member.id)}
                          disabled={selectedRole !== 'owner' || !!memberSaving[member.id]}
                          aria-label={`Remove ${member.name}`}
                        >
                          Remove
                        </Button>
                      </div>
                    ))}

                    {selectedRole === 'owner' && (
                      <div className="space-y-2 pt-2">
                        <div className="flex items-end gap-2">
                          <div className="flex-1">
                            <Select
                              label="Add Member"
                              placeholder="Search by name or username…"
                              searchable
                              searchPlaceholder="Type to search users…"
                              noResultsText="No users found"
                              value={memberUserId}
                              onValueChange={(value) => setMemberUserId(value)}
                              options={userOptions}
                              disabled={saving}
                            />
                          </div>
                          <Select
                            value={memberRole}
                            onValueChange={(value) => setMemberRole(value as 'owner' | 'admin')}
                            options={roleOptions}
                            disabled={saving}
                          />
                        </div>
                        <Button
                          variant="primary"
                          fullWidth
                          onClick={() => void handleAssignRole()}
                          disabled={saving || !memberUserId.trim()}
                        >
                          Add
                        </Button>
                      </div>
                    )}
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
              <CardTitle>Organizations</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {selectedOrganizations.length > 0 ? (
                selectedOrganizations.map((org) => (
                  <Text key={org.id} size="sm">
                    {org.name}
                  </Text>
                ))
              ) : (
                <Text variant="muted" size="sm">
                  No organizations yet.
                </Text>
              )}
              <Button variant="secondary" fullWidth onClick={() => setCreateOrgOpen(true)}>
                Create Organization
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      <Modal open={createOrgOpen} onOpenChange={setCreateOrgOpen}>
        <ModalHeader>Create Organization</ModalHeader>
        <ModalBody className="space-y-4">
          {orgError && (
            <Text
              size="sm"
              className="rounded-md bg-red-50 px-3 py-2 text-red-700 dark:bg-red-950/30 dark:text-red-300"
            >
              {orgError}
            </Text>
          )}
          <Input
            label="Name"
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            placeholder="Design Systems"
            disabled={orgSaving}
          />
          <Input
            label="Slug"
            value={orgSlug}
            onChange={(e) => setOrgSlug(e.target.value)}
            placeholder="design-systems"
            disabled={orgSaving}
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
              checked={orgAllowAutoJoin}
              onCheckedChange={setOrgAllowAutoJoin}
              disabled={orgSaving}
              aria-label="Toggle organization auto-join"
            />
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="outline" onClick={() => setCreateOrgOpen(false)} disabled={orgSaving}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => void handleCreateOrg()}
            disabled={orgSaving || !orgName.trim()}
          >
            {orgSaving ? 'Creating…' : 'Create'}
          </Button>
        </ModalFooter>
      </Modal>
    </AppPage>
  );
};
