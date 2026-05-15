import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Select,
  Spinner,
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
  orgAdminApi,
  type DefaultOrganizationRole,
  type OrganizationAdminUser,
} from '../../lib/api';
import { hasDefaultOrganizationAdminAccess } from '../../lib/organizationAccess';
import { useSession } from '../../lib/useSession';
import { AppPage } from '../../ui/AppPage';

export const OrganizationMembersPage: React.FC = () => {
  const { user } = useSession();
  const canAccess = hasDefaultOrganizationAdminAccess(user);
  const [users, setUsers] = useState<OrganizationAdminUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingUserId, setSavingUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await orgAdminApi.listUsers();
      setUsers(result);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Failed to load organization members');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!canAccess) return;
    void loadUsers();
  }, [canAccess, loadUsers]);

  const handleRoleChange = useCallback(
    async (targetUserId: string, role: DefaultOrganizationRole) => {
      const previous = users;
      setUsers((prev) => prev.map((u) => (u.id === targetUserId ? { ...u, role } : u)));
      setSavingUserId(targetUserId);
      setError(null);
      try {
        await orgAdminApi.setUserRole(targetUserId, role);
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
    [users],
  );

  const roleOptions = useMemo(
    () => [
      { value: 'owner', label: 'Owner' },
      { value: 'admin', label: 'Admin' },
      { value: 'member', label: 'Member' },
    ],
    [],
  );

  if (!canAccess) {
    return (
      <AppPage>
        <Card padding="lg" className="mx-auto max-w-2xl text-center">
          <CardHeader>
            <CardTitle>Members Unavailable</CardTitle>
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
    <AppPage subtitle="Admin / Members">
      <Card padding="lg" className="space-y-4">
        <CardHeader className="flex items-center justify-between gap-3">
          <div>
            <CardTitle>Members</CardTitle>
            <Text variant="muted" size="sm">
              Manage owner/admin/member role assignments for the default organization.
            </Text>
          </div>
          <Badge variant="default">Members</Badge>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <Text variant="muted" size="sm">
              Assign roles directly from this table.
            </Text>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void loadUsers()}
              disabled={loading}
            >
              Refresh
            </Button>
          </div>

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
                {users.map((orgUser) => {
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
                            disabled={isSaving}
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
                                await orgAdminApi.updateReportsTo(orgUser.id, reportsToValue);
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
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </AppPage>
  );
};
