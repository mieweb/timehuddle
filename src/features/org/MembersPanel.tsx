/**
 * MembersPanel — the People page's Members tab, for organization admins.
 *
 * The roster: search, role filters with counts, and one row per member with
 * an inline role select, their manager, and a menu for profile, block and
 * remove. A blocked member is marked beside their name. Adding and inviting live in the page header
 * (PeopleActions); `reloadKey` tells this panel when they changed the roster.
 */
import {
  Alert,
  Badge,
  Button,
  ButtonGroup,
  Dropdown,
  DropdownItem,
  Input,
  LockIcon,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  MoreHorizontalIcon,
  Select,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Text,
  Textarea,
  UnlockIcon,
  UserIcon,
  UserMinusIcon,
} from '@mieweb/ui';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  ApiError,
  orgApi,
  type DefaultOrganizationRole,
  type OrganizationAdminUser,
} from '../../lib/api';
import { getDdpClient } from '../../lib/ddp';
import { useRefresh } from '../../lib/RefreshContext';
import { useTeam } from '../../lib/TeamContext';
import { useSession } from '../../lib/useSession';
import { AppModal } from '../../ui/AppModal';
import { useQueryParam, useRouter, useSearchParam } from '../../ui/router';
import { UserAvatar } from '../../ui/UserAvatar';
import { PEOPLE_STRINGS } from './peopleStrings';

const S = PEOPLE_STRINGS.members;
const ROLES: DefaultOrganizationRole[] = ['owner', 'admin', 'member'];
const ROLE_OPTIONS = ROLES.map((role) => ({ value: role, label: PEOPLE_STRINGS.roles[role] }));

const errorText = (err: unknown, fallback: string) =>
  err instanceof ApiError ? err.message : fallback;

export const MembersPanel: React.FC<{ reloadKey: number }> = ({ reloadKey }) => {
  const { user } = useSession();
  const { selectedOrgId } = useTeam();
  const { navigate } = useRouter();
  const [users, setUsers] = useState<OrganizationAdminUser[]>([]);
  const [organizationName, setOrganizationName] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [savingUserId, setSavingUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useSearchParam('q');
  const [roleParam, setRoleParam] = useQueryParam('role');
  const roleFilter = ROLES.includes(roleParam as DefaultOrganizationRole)
    ? (roleParam as DefaultOrganizationRole)
    : null;
  const [blockUserId, setBlockUserId] = useState<string | null>(null);
  const [blockReason, setBlockReason] = useState('');
  const [blocking, setBlocking] = useState(false);
  const [removeUserId, setRemoveUserId] = useState<string | null>(null);
  const loadSeqRef = useRef(0);

  const loadUsers = useCallback(async () => {
    const seq = ++loadSeqRef.current;
    if (!selectedOrgId) {
      setUsers([]);
      setError(PEOPLE_STRINGS.noOrg);
      return;
    }
    const isStale = () => seq !== loadSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      const [organization, members] = await Promise.all([
        orgApi.getOrganizationById(selectedOrgId),
        orgApi.listMembers(selectedOrgId),
      ]);
      if (isStale()) return;
      setOrganizationName(organization.name);
      setUsers(members);
    } catch (err) {
      if (!isStale()) setError(errorText(err, PEOPLE_STRINGS.errors.load));
    } finally {
      if (!isStale()) setLoading(false);
    }
  }, [selectedOrgId]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers, reloadKey]);

  useRefresh(loadUsers);

  // Real-time: another admin's role change or removal reloads the roster. The
  // subscription's first batch is the roster just loaded, so only later changes count.
  useEffect(() => {
    if (!selectedOrgId) return;
    const ddp = getDdpClient();
    let ready = false;
    const offChange = ddp.onCollectionChange('org_members', () => {
      if (ready) void loadUsers();
    });
    const unsubscribe = ddp.subscribe('orgMembers.byOrg', [selectedOrgId], () => {
      ready = true;
    });
    return () => {
      offChange();
      unsubscribe();
    };
  }, [selectedOrgId, loadUsers]);

  /** Optimistic update of one member, rolled back if the server refuses. */
  const saveMember = useCallback(
    async (
      targetUserId: string,
      patch: Partial<OrganizationAdminUser>,
      call: () => Promise<unknown>,
      fallback: string,
    ) => {
      const previous = users;
      setUsers((prev) => prev.map((u) => (u.id === targetUserId ? { ...u, ...patch } : u)));
      setSavingUserId(targetUserId);
      setError(null);
      try {
        await call();
      } catch (err) {
        setUsers(previous);
        setError(errorText(err, fallback));
      } finally {
        setSavingUserId(null);
      }
    },
    [users],
  );

  const handleConfirmBlock = useCallback(async () => {
    if (!selectedOrgId || !blockUserId) return;
    setBlocking(true);
    setError(null);
    try {
      await orgApi.blockMember(selectedOrgId, blockUserId, blockReason.trim() || undefined);
      setBlockUserId(null);
      setBlockReason('');
      await loadUsers();
    } catch (err) {
      setError(errorText(err, PEOPLE_STRINGS.errors.block));
    } finally {
      setBlocking(false);
    }
  }, [blockReason, blockUserId, loadUsers, selectedOrgId]);

  const handleUnblock = useCallback(
    async (targetUserId: string) => {
      if (!selectedOrgId) return;
      setSavingUserId(targetUserId);
      setError(null);
      try {
        await orgApi.unblockMember(selectedOrgId, targetUserId);
        await loadUsers();
      } catch (err) {
        setError(errorText(err, PEOPLE_STRINGS.errors.unblock));
      } finally {
        setSavingUserId(null);
      }
    },
    [loadUsers, selectedOrgId],
  );

  const handleConfirmRemove = useCallback(async () => {
    if (!selectedOrgId || !removeUserId) return;
    setSavingUserId(removeUserId);
    setError(null);
    try {
      await orgApi.removeMember(selectedOrgId, removeUserId);
      await loadUsers();
    } catch (err) {
      setError(errorText(err, PEOPLE_STRINGS.errors.remove));
    } finally {
      // Close either way: a refusal is reported in the panel's error banner.
      setRemoveUserId(null);
      setSavingUserId(null);
    }
  }, [loadUsers, removeUserId, selectedOrgId]);

  const counts = useMemo(() => {
    const byRole: Record<DefaultOrganizationRole, number> = { owner: 0, admin: 0, member: 0 };
    users.forEach((u) => byRole[u.role]++);
    return byRole;
  }, [users]);

  const visibleUsers = useMemo(() => {
    const query = search.trim().toLowerCase();
    return users.filter(
      (u) =>
        (!roleFilter || u.role === roleFilter) &&
        (!query ||
          [u.name, u.email, u.username ?? ''].some((v) => v.toLowerCase().includes(query))),
    );
  }, [roleFilter, search, users]);

  // An empty value shows the placeholder, so "Unassigned" is both that and the option to clear it.
  const managerOptions = useMemo(
    () => [
      { value: '', label: S.unassigned },
      ...users.map((u) => ({ value: u.id, label: u.name })),
    ],
    [users],
  );

  const removing = removeUserId !== null && savingUserId === removeUserId;
  const removeUserName =
    users.find((u) => u.id === removeUserId)?.name ?? PEOPLE_STRINGS.remove.fallbackName;

  const filters: Array<{ value: DefaultOrganizationRole | null; label: string }> = [
    { value: null, label: S.all },
    ...ROLES.map((role) => ({ value: role, label: `${S.plural[role]} ${counts[role]}` })),
  ];

  return (
    <div className="members-panel space-y-4">
      <div className="members-toolbar flex flex-wrap items-center gap-3">
        <Input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={S.search}
          aria-label={S.searchLabel}
          className="w-80 max-w-full"
        />
        <ButtonGroup
          role="group"
          aria-label={S.roleFilter}
          orientation="horizontal"
          className="members-role-filter flex-wrap justify-start gap-1 rounded-lg border border-neutral-200 p-1 dark:border-neutral-700"
        >
          {filters.map((filter) => (
            <Button
              key={filter.value ?? 'all'}
              size="sm"
              variant={roleFilter === filter.value ? 'secondary' : 'ghost'}
              aria-pressed={roleFilter === filter.value}
              onClick={() => setRoleParam(filter.value)}
            >
              {filter.label}
            </Button>
          ))}
        </ButtonGroup>
      </div>

      {error && <Alert variant="danger">{error}</Alert>}

      {loading && users.length === 0 ? (
        <div className="flex justify-center py-8">
          <Spinner size="lg" label={S.loading} />
        </div>
      ) : (
        <Table responsive>
          <TableHeader>
            <TableRow>
              <TableHead>{S.columns.member}</TableHead>
              <TableHead className="w-40">{S.columns.role}</TableHead>
              <TableHead className="w-52">{S.columns.reportsTo}</TableHead>
              <TableHead className="w-14">
                <span className="sr-only">{S.actionsColumn}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleUsers.map((member) => {
              const isCurrent = member.id === user?.id;
              const isSaving = savingUserId === member.id;
              const blockInfo = member.blocked?.find((b) => b.orgId === selectedOrgId);
              return (
                <TableRow key={member.id}>
                  <TableCell>
                    <div className="member-cell flex min-w-0 items-center gap-3">
                      <UserAvatar name={member.name} src={member.image} size="sm" />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-x-2">
                          <Text size="sm" weight="medium">
                            {member.name}
                          </Text>
                          {member.username && (
                            <Text size="sm" variant="muted">
                              @{member.username}
                            </Text>
                          )}
                          {isCurrent && <Badge variant="outline">{S.you}</Badge>}
                          {blockInfo && (
                            <Badge
                              variant="danger"
                              title={blockInfo.reason ? S.blockReason(blockInfo.reason) : undefined}
                            >
                              {S.blocked}
                            </Badge>
                          )}
                        </div>
                        <Text size="xs" variant="muted" truncate>
                          {member.email}
                        </Text>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Select
                        label={S.columns.role}
                        hideLabel
                        size="sm"
                        value={member.role}
                        options={ROLE_OPTIONS}
                        disabled={isSaving}
                        aria-label={S.roleFor(member.name)}
                        onValueChange={(value) => {
                          const role = value as DefaultOrganizationRole;
                          if (!selectedOrgId) return;
                          void saveMember(
                            member.id,
                            { role },
                            () => orgApi.setMemberRole(selectedOrgId, member.id, role),
                            PEOPLE_STRINGS.errors.role,
                          );
                        }}
                        className="flex-1"
                      />
                      {isSaving && <Spinner size="sm" label="Saving" />}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Select
                      label={S.columns.reportsTo}
                      hideLabel
                      size="sm"
                      value={member.reportsToUserId || ''}
                      placeholder={S.unassigned}
                      options={managerOptions.filter((o) => o.value !== member.id)}
                      aria-label={S.reportsToFor(member.name)}
                      onValueChange={(value) => {
                        if (!selectedOrgId) return;
                        const reportsToUserId = value || null;
                        void saveMember(
                          member.id,
                          { reportsToUserId },
                          () =>
                            orgApi.updateMemberReportsTo(selectedOrgId, member.id, reportsToUserId),
                          PEOPLE_STRINGS.errors.reportsTo,
                        );
                      }}
                    />
                  </TableCell>
                  <TableCell>
                    <Dropdown
                      placement="bottom-end"
                      trigger={
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={S.rowMenu(member.name)}
                          disabled={isSaving}
                        >
                          <MoreHorizontalIcon className="h-4 w-4" />
                        </Button>
                      }
                    >
                      <DropdownItem
                        icon={<UserIcon className="h-4 w-4" />}
                        // By id: a numeric or id-shaped username would be read as an id.
                        onClick={() => navigate(`/app/profile/${member.id}`)}
                      >
                        {S.viewProfile}
                      </DropdownItem>
                      {blockInfo ? (
                        <DropdownItem
                          icon={<UnlockIcon className="h-4 w-4" />}
                          onClick={() => void handleUnblock(member.id)}
                        >
                          {S.unblock}
                        </DropdownItem>
                      ) : (
                        <DropdownItem
                          icon={<LockIcon className="h-4 w-4" />}
                          disabled={isCurrent}
                          onClick={() => {
                            setBlockUserId(member.id);
                            setBlockReason('');
                          }}
                        >
                          {S.block}
                        </DropdownItem>
                      )}
                      <DropdownItem
                        variant="danger"
                        icon={<UserMinusIcon className="h-4 w-4" />}
                        disabled={isCurrent}
                        onClick={() => setRemoveUserId(member.id)}
                      >
                        {S.remove}
                      </DropdownItem>
                    </Dropdown>
                  </TableCell>
                </TableRow>
              );
            })}
            {visibleUsers.length === 0 && !loading && (
              <TableRow>
                <TableCell colSpan={4}>
                  <Text size="sm" variant="muted" className="py-2">
                    {S.noMatch}
                  </Text>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      )}

      <AppModal open={blockUserId !== null} onOpenChange={(open) => !open && setBlockUserId(null)}>
        <ModalHeader>
          <ModalTitle>{PEOPLE_STRINGS.block.title}</ModalTitle>
        </ModalHeader>
        <ModalBody className="space-y-3">
          <Text variant="muted" size="sm">
            {PEOPLE_STRINGS.block.body}
          </Text>
          <Textarea
            label={PEOPLE_STRINGS.block.reason}
            value={blockReason}
            onChange={(e) => setBlockReason(e.target.value)}
            placeholder={PEOPLE_STRINGS.block.reasonPlaceholder}
            rows={3}
            maxLength={500}
          />
        </ModalBody>
        <ModalFooter>
          <Button variant="outline" onClick={() => setBlockUserId(null)} disabled={blocking}>
            {PEOPLE_STRINGS.cancel}
          </Button>
          <Button variant="danger" onClick={() => void handleConfirmBlock()} disabled={blocking}>
            {blocking ? PEOPLE_STRINGS.block.confirming : PEOPLE_STRINGS.block.confirm}
          </Button>
        </ModalFooter>
      </AppModal>

      <AppModal
        open={removeUserId !== null}
        onOpenChange={(open) => !open && !removing && setRemoveUserId(null)}
      >
        <ModalHeader>
          <ModalTitle>{PEOPLE_STRINGS.remove.title}</ModalTitle>
        </ModalHeader>
        <ModalBody>
          <Text variant="muted" size="sm">
            {PEOPLE_STRINGS.remove.body(
              removeUserName,
              organizationName ?? PEOPLE_STRINGS.remove.fallbackOrg,
            )}
          </Text>
        </ModalBody>
        <ModalFooter>
          <ButtonGroup>
            <Button variant="outline" onClick={() => setRemoveUserId(null)} disabled={removing}>
              {PEOPLE_STRINGS.cancel}
            </Button>
            <Button variant="danger" onClick={() => void handleConfirmRemove()} disabled={removing}>
              {removing ? PEOPLE_STRINGS.remove.confirming : PEOPLE_STRINGS.remove.confirm}
            </Button>
          </ButtonGroup>
        </ModalFooter>
      </AppModal>
    </div>
  );
};
