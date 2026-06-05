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
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Text,
} from '@mieweb/ui';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

import {
  ApiError,
  enterpriseApi,
  orgApi,
  type DefaultOrganizationRole,
  type OrganizationAdminUser,
} from '../../lib/api';
import { useTeam } from '../../lib/TeamContext';
import { hasDefaultOrganizationAdminAccess } from '../../lib/organizationAccess';
import { useSession } from '../../lib/useSession';
import { useRefresh } from '../../lib/RefreshContext';
import { AppPage } from '../../ui/AppPage';

export const OrganizationMembersPage: React.FC = () => {
  const { user } = useSession();
  const { selectedOrgId } = useTeam();
  const canUpdateReportsTo = hasDefaultOrganizationAdminAccess(user);
  const [users, setUsers] = useState<OrganizationAdminUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [canManage, setCanManage] = useState(false);
  const [organizationName, setOrganizationName] = useState<string | null>(null);
  const [savingUserId, setSavingUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [allowAutoJoin, setAllowAutoJoin] = useState(true);
  const [savingAutoJoin, setSavingAutoJoin] = useState(false);
  const [memberUserId, setMemberUserId] = useState('');
  const [memberRole, setMemberRole] = useState<DefaultOrganizationRole>('member');
  const [savingMember, setSavingMember] = useState(false);
  const [userOptions, setUserOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [memberSearch, setMemberSearch] = useState('');

  const loadUsers = useCallback(async () => {
    if (!selectedOrgId) {
      setUsers([]);
      setCanManage(false);
      setOrganizationName(null);
      setError('Select an organization first.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const organization = await orgApi.getOrganizationById(selectedOrgId);
      setOrganizationName(organization.name);
      setAllowAutoJoin(organization.allowAutoJoin);
      setCanManage(organization.canManage);

      if (!organization.canManage) {
        setUsers([]);
        return;
      }

      const result = await orgApi.listMembers(selectedOrgId);
      setUsers(result);

      if (organization.enterpriseId) {
        const enterpriseUsers = await enterpriseApi.searchUsers(organization.enterpriseId, '');
        setUserOptions(
          enterpriseUsers.map((u) => ({
            value: u.id,
            label: u.username ? `${u.name} (@${u.username})` : u.name,
          })),
        );
      } else {
        setUserOptions([]);
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Failed to load organization members');
      }
    } finally {
      setLoading(false);
    }
  }, [selectedOrgId]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  // Pull-to-refresh
  useRefresh(loadUsers);

  const handleRoleChange = useCallback(
    async (targetUserId: string, role: DefaultOrganizationRole) => {
      if (!selectedOrgId) return;
      const previous = users;
      setUsers((prev) => prev.map((u) => (u.id === targetUserId ? { ...u, role } : u)));
      setSavingUserId(targetUserId);
      setError(null);
      try {
        await orgApi.setMemberRole(selectedOrgId, targetUserId, role);
      } catch (err) {
        setUsers(previous);
        if (err instanceof ApiError) {
          setError(err.message);
        } else {
          setError('Failed to update role');
        }
      } finally {
        setSavingUserId(null);
      }
    },
    [selectedOrgId, users],
  );

  const handleAddMember = useCallback(async () => {
    if (!selectedOrgId || !memberUserId.trim()) return;

    setSavingMember(true);
    setError(null);
    try {
      await orgApi.setMemberRole(selectedOrgId, memberUserId.trim(), memberRole);
      setMemberUserId('');
      setMemberRole('member');
      await loadUsers();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Failed to add organization member');
      }
    } finally {
      setSavingMember(false);
    }
  }, [loadUsers, memberRole, memberUserId, selectedOrgId]);

  const roleOptions = useMemo(
    () => [
      { value: 'owner', label: 'Owner' },
      { value: 'admin', label: 'Admin' },
      { value: 'member', label: 'Member' },
    ],
    [],
  );

  const visibleUsers = useMemo(() => {
    const query = memberSearch.trim().toLowerCase();
    if (!query) return users;

    return users.filter((orgUser) => {
      const name = orgUser.name.toLowerCase();
      const email = orgUser.email.toLowerCase();
      const username = (orgUser.username ?? '').toLowerCase();
      const role = orgUser.role.toLowerCase();
      return (
        name.includes(query) ||
        email.includes(query) ||
        username.includes(query) ||
        role.includes(query)
      );
    });
  }, [memberSearch, users]);

  return (
    <AppPage>
      <Card padding="lg" className="space-y-4">
        <CardHeader className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>Members</CardTitle>
            <Text variant="muted" size="sm">
              {organizationName
                ? `Manage role assignments for ${organizationName}.`
                : 'Manage role assignments for the current organization.'}
            </Text>
          </div>
          <Button variant="secondary" size="sm" onClick={() => void loadUsers()} disabled={loading}>
            Refresh
          </Button>
        </CardHeader>

        <CardContent className="space-y-4">
          {!selectedOrgId && (
            <Text
              size="sm"
              className="rounded-md bg-amber-50 px-3 py-2 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300"
            >
              No organization is selected.
            </Text>
          )}

          {selectedOrgId && canManage && (
            <div className="flex flex-wrap items-end gap-3 rounded-md border border-neutral-200/70 p-3 dark:border-neutral-800">
              <div className="min-w-[20rem] flex-1">
                <Select
                  label="Add Member"
                  placeholder="Search by name or username…"
                  searchable
                  searchPlaceholder="Type to search users…"
                  noResultsText="No users found"
                  value={memberUserId}
                  onValueChange={(value) => setMemberUserId(value)}
                  options={userOptions}
                  disabled={savingMember || loading}
                />
              </div>
              <div className="w-40">
                <Select
                  label="Role"
                  value={memberRole}
                  onValueChange={(value) => setMemberRole(value as DefaultOrganizationRole)}
                  options={roleOptions}
                  disabled={savingMember || loading}
                />
              </div>
              <Button
                variant="primary"
                onClick={() => void handleAddMember()}
                disabled={savingMember || loading || !memberUserId.trim()}
              >
                {savingMember ? 'Adding…' : 'Add Member'}
              </Button>

              <Input
                value={memberSearch}
                onChange={(e) => setMemberSearch(e.target.value)}
                placeholder="Search displayed members"
                aria-label="Search organization members"
                className="w-72"
              />

              <div className="flex items-center gap-2 pb-2">
                <Text variant="muted" size="sm">
                  Auto-Join
                </Text>
                <Switch
                  checked={allowAutoJoin}
                  disabled={savingAutoJoin || !selectedOrgId || !canManage}
                  aria-label="Toggle organization auto-join"
                  onCheckedChange={async (checked) => {
                    if (!selectedOrgId) return;
                    const previous = allowAutoJoin;
                    setAllowAutoJoin(checked);
                    setSavingAutoJoin(true);
                    setError(null);
                    try {
                      await orgApi.updateSettings(selectedOrgId, checked);
                    } catch (err) {
                      setAllowAutoJoin(previous);
                      if (err instanceof ApiError) {
                        setError(err.message);
                      } else {
                        setError('Failed to update auto-join setting');
                      }
                    } finally {
                      setSavingAutoJoin(false);
                    }
                  }}
                />
              </div>
            </div>
          )}

          {error && (
            <Text
              size="sm"
              className="rounded-md bg-red-50 px-3 py-2 text-red-700 dark:bg-red-950/30 dark:text-red-300"
            >
              {error}
            </Text>
          )}

          {loading ? (
            <div className="flex justify-center py-8">
              <Spinner size="lg" label="Loading members" />
            </div>
          ) : !canManage ? (
            <Text
              size="sm"
              className="rounded-md bg-amber-50 px-3 py-2 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300"
            >
              You do not have permission to manage members for this organization.
            </Text>
          ) : (
            <Table responsive>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Username</TableHead>
                  <TableHead className="w-48">Role</TableHead>
                  <TableHead className="w-48">Reports To</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleUsers.map((orgUser) => {
                  const isCurrent = orgUser.id === user?.id;
                  const isSaving = savingUserId === orgUser.id;
                  return (
                    <TableRow key={orgUser.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Text size="sm" weight="medium">
                            {orgUser.name}
                          </Text>
                          {isCurrent && <Badge variant="secondary">You</Badge>}
                        </div>
                      </TableCell>
                      <TableCell>{orgUser.email}</TableCell>
                      <TableCell>{orgUser.username ? `@${orgUser.username}` : '—'}</TableCell>
                      <TableCell>
                        <div className="flex w-full items-center gap-2">
                          <Select
                            label="Role"
                            hideLabel
                            size="sm"
                            value={orgUser.role}
                            onValueChange={(value) =>
                              void handleRoleChange(orgUser.id, value as DefaultOrganizationRole)
                            }
                            options={roleOptions}
                            disabled={isSaving || !canManage}
                            aria-label={`Set role for ${orgUser.name}`}
                            className="flex-1"
                          />
                          {isSaving && <Spinner size="sm" label="Saving" />}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex w-full items-center gap-2">
                          <Select
                            label="Reports To"
                            hideLabel
                            size="sm"
                            value={orgUser.reportsToUserId || ''}
                            disabled={!canUpdateReportsTo}
                            onValueChange={async (value) => {
                              const previous = users;
                              const reportsToValue = value ? value : null;
                              setUsers((prev) =>
                                prev.map((u) =>
                                  u.id === orgUser.id
                                    ? { ...u, reportsToUserId: reportsToValue }
                                    : u,
                                ),
                              );
                              setSavingUserId(orgUser.id);
                              setError(null);
                              try {
                                await orgApi.updateReportsTo(orgUser.id, reportsToValue);
                              } catch (err) {
                                setUsers(previous);
                                if (err instanceof ApiError) {
                                  setError(err.message);
                                } else {
                                  setError('Failed to update Reports To');
                                }
                              } finally {
                                setSavingUserId(null);
                              }
                            }}
                            options={[
                              { value: '', label: 'None' },
                              ...users.map((u) => ({ value: u.id, label: u.name })),
                            ]}
                            aria-label={`Set Reports To for ${orgUser.name}`}
                            className="flex-1"
                          />
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {visibleUsers.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5}>
                      <Text size="sm" variant="muted" className="py-2">
                        No members match your search.
                      </Text>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </AppPage>
  );
};
