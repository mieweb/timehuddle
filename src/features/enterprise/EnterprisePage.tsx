/**
 * EnterprisePage — `/app/enterprise`, "Enterprise" in the nav, for everyone.
 *
 * Owners and admins of the selected enterprise see its organizations, a
 * read-only summary of the defaults it sets (edited in Settings → Enterprise),
 * and its owners and admins. Everyone else sees which enterprise and
 * organizations they belong to.
 */
import {
  Alert,
  Avatar,
  Badge,
  Button,
  ButtonGroup,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dropdown,
  DropdownItem,
  LockIcon,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  MoreHorizontalIcon,
  PlusIcon,
  SectionSpyNav,
  Select,
  SettingsIcon,
  Spinner,
  Text,
  UserMinusIcon,
} from '@mieweb/ui';
import { AppModal } from '@ui/AppModal';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { ApiError, enterpriseApi } from '../../lib/api';
import { getEnterpriseRole, type EnterpriseRole } from '../../lib/organizationAccess';
import { useRefresh } from '../../lib/RefreshContext';
import { useTeam } from '../../lib/TeamContext';
import { useSession } from '../../lib/useSession';
import { AppPage } from '../../ui/AppPage';
import { useRouter } from '../../ui/router';
import { settingsPath } from '../settings/settingsSections';
import { ENTERPRISE_DEFAULT_ROWS } from './EnterpriseSettings';
import { ENTERPRISE_STRINGS } from './enterpriseStrings';
import { OrganizationDialog } from './OrganizationDialog';
import { useEnterpriseDetail, type EnterpriseDetail } from './useEnterpriseDetail';

const S = ENTERPRISE_STRINGS;
const ROLE_OPTIONS = (['owner', 'admin'] as const).map((role) => ({
  value: role,
  label: S.roles[role],
}));

type Organization = ReturnType<typeof useTeam>['organizations'][number];

/** Opens an organization's People page, making it the selected one first. */
function useOpenOrganization() {
  const { setSelectedOrgId } = useTeam();
  const { navigate } = useRouter();
  return (org: Organization, tab?: 'members') => {
    setSelectedOrgId(org.id);
    navigate(tab ? `/app/organization?tab=${tab}` : '/app/organization');
  };
}

// ─── Admin view ───────────────────────────────────────────────────────────────

const OrganizationsCard: React.FC<{ enterprise: EnterpriseDetail }> = ({ enterprise }) => {
  const { organizations, selectedOrgId } = useTeam();
  const open = useOpenOrganization();
  const [dialog, setDialog] = useState<{ organization?: Organization } | null>(null);
  const orgs = organizations.filter((org) => org.enterpriseId === enterprise.id);
  const autoJoin = enterprise.effectiveSettings.allowAutoJoin;

  return (
    <Card padding="none" id="organizations" className="enterprise-organizations scroll-mt-24">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 px-5 py-4">
        <div>
          <CardTitle>{S.organizations.title}</CardTitle>
          <Text variant="muted" size="sm">
            {S.organizations.description}
          </Text>
        </div>
        <Button
          variant="secondary"
          size="sm"
          leftIcon={<PlusIcon className="h-4 w-4" />}
          onClick={() => setDialog({})}
        >
          {S.organizations.add}
        </Button>
      </CardHeader>
      <CardContent className="divide-y divide-neutral-100 border-t border-neutral-100 p-0 dark:divide-neutral-800 dark:border-neutral-800">
        {orgs.length === 0 && (
          <Text variant="muted" size="sm" className="px-5 py-4">
            {S.organizations.empty}
          </Text>
        )}
        {orgs.map((org) => (
          <div key={org.id} className="enterprise-org-row flex items-center gap-3 px-5 py-3">
            <Avatar name={org.name} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Text size="sm" weight="medium">
                  {org.name}
                </Text>
                {org.id === selectedOrgId && (
                  <Badge variant="outline">{S.organizations.current}</Badge>
                )}
              </div>
              <Text variant="muted" size="xs">
                {org.slug}
              </Text>
            </div>
            <ButtonGroup>
              <Button
                variant="ghost"
                size="sm"
                aria-label={S.organizations.editFor(org.name)}
                onClick={() => setDialog({ organization: org })}
              >
                {S.organizations.edit}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                aria-label={S.organizations.openFor(org.name)}
                onClick={() => open(org, 'members')}
                className="text-primary-600 dark:text-primary-400"
              >
                {S.organizations.open}
              </Button>
            </ButtonGroup>
          </div>
        ))}
      </CardContent>
      {dialog && (
        <OrganizationDialog
          organization={dialog.organization}
          defaultAutoJoin={autoJoin.value}
          autoJoinLocked={autoJoin.locked}
          onClose={() => setDialog(null)}
        />
      )}
    </Card>
  );
};

const DefaultsSummaryCard: React.FC<{ enterprise: EnterpriseDetail }> = ({ enterprise }) => {
  const { navigate } = useRouter();
  const locked = ENTERPRISE_DEFAULT_ROWS.filter((row) => enterprise.settingsLocks[row.key]).length;
  return (
    <Card padding="none" id="defaults" className="enterprise-defaults scroll-mt-24">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 px-5 py-4">
        <div>
          <CardTitle>{S.defaults.title}</CardTitle>
          <Text variant="muted" size="sm">
            {S.defaults.description(locked, ENTERPRISE_DEFAULT_ROWS.length)}
          </Text>
        </div>
        <Button
          variant="secondary"
          size="sm"
          leftIcon={<SettingsIcon className="h-4 w-4" />}
          onClick={() => navigate(settingsPath('enterprise'))}
        >
          {S.defaults.edit}
        </Button>
      </CardHeader>
      <CardContent className="divide-y divide-neutral-100 border-t border-neutral-100 p-0 dark:divide-neutral-800 dark:border-neutral-800">
        {ENTERPRISE_DEFAULT_ROWS.map((row) => {
          const isLocked = enterprise.settingsLocks[row.key] === true;
          const value = enterprise.effectiveSettings[row.key].value;
          return (
            <div
              key={row.key}
              className="enterprise-default-row flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3"
            >
              <Text size="sm" className="min-w-0 flex-1">
                {row.title}
              </Text>
              <Badge variant={isLocked ? 'default' : 'outline'}>
                {isLocked && <LockIcon className="h-3 w-3" aria-hidden="true" />}
                {value ? S.defaults.on : S.defaults.off} ·{' '}
                {isLocked ? S.defaults.locked : S.defaults.overridable}
              </Badge>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
};

const AdminsCard: React.FC<{
  enterprise: EnterpriseDetail;
  role: EnterpriseRole;
  reload: () => Promise<void>;
}> = ({ enterprise, role, reload }) => {
  const A = S.admins;
  const { user } = useSession();
  const canEdit = role === 'owner';
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [addUserId, setAddUserId] = useState('');
  const [addRole, setAddRole] = useState<EnterpriseRole>('admin');
  const [options, setOptions] = useState<Array<{ value: string; label: string }>>([]);

  useEffect(() => {
    if (!canEdit) return;
    void enterpriseApi
      .searchUsers(enterprise.id, '')
      .then((users) =>
        setOptions(
          users.map((u) => ({
            value: u.id,
            label: u.username ? `${u.name} (@${u.username})` : u.name,
          })),
        ),
      )
      .catch(() => setOptions([]));
  }, [canEdit, enterprise.id]);

  /**
   * Runs one change for `userId`, then reloads; a refusal shows in the card.
   * One at a time: the server rewrites the whole owners/admins list, so two
   * overlapping changes could undo each other. Every control waits for this.
   */
  const busy = savingId !== null;
  const run = async (userId: string, call: () => Promise<unknown>, fallback: string) => {
    if (busy) return false;
    setSavingId(userId);
    setError(null);
    try {
      await call();
      await reload();
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : fallback);
      return false;
    } finally {
      setSavingId(null);
    }
  };

  const removing = removeId !== null && savingId === removeId;
  const removeName = enterprise.members.find((m) => m.id === removeId)?.name ?? '';

  return (
    <Card padding="none" id="admins" className="enterprise-admins scroll-mt-24">
      <CardHeader className="px-5 py-4">
        <CardTitle>{A.title}</CardTitle>
        <Text variant="muted" size="sm">
          {A.description}
        </Text>
      </CardHeader>
      <CardContent className="divide-y divide-neutral-100 border-t border-neutral-100 p-0 dark:divide-neutral-800 dark:border-neutral-800">
        {error && (
          <div className="px-5 py-3">
            <Alert variant="danger">{error}</Alert>
          </div>
        )}
        {enterprise.members.map((member) => {
          const isYou = member.id === user?.id;
          return (
            <div key={member.id} className="enterprise-admin-row flex items-center gap-3 px-5 py-3">
              <Avatar name={member.name} size="sm" />
              <div className="min-w-0 flex-1">
                <Text size="sm" weight="medium" truncate>
                  {member.name}{' '}
                  {isYou && (
                    <span className="font-normal text-neutral-500 dark:text-neutral-400">
                      {A.you}
                    </span>
                  )}
                </Text>
                {member.username && (
                  <Text variant="muted" size="xs">
                    @{member.username}
                  </Text>
                )}
              </div>
              <Select
                label={A.roleFor(member.name)}
                hideLabel
                size="sm"
                value={member.role}
                options={ROLE_OPTIONS}
                disabled={!canEdit || busy}
                onValueChange={(value) =>
                  void run(
                    member.id,
                    () =>
                      enterpriseApi.setMemberRole(
                        enterprise.id,
                        member.id,
                        value as EnterpriseRole,
                      ),
                    A.roleFailed,
                  )
                }
                className="w-32"
              />
              {canEdit && (
                <Dropdown
                  placement="bottom-end"
                  trigger={
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={A.menuFor(member.name)}
                      disabled={busy}
                    >
                      <MoreHorizontalIcon className="h-4 w-4" />
                    </Button>
                  }
                >
                  <DropdownItem
                    variant="danger"
                    icon={<UserMinusIcon className="h-4 w-4" />}
                    disabled={isYou}
                    onClick={() => setRemoveId(member.id)}
                  >
                    {A.remove}
                  </DropdownItem>
                </Dropdown>
              )}
            </div>
          );
        })}
        {canEdit && (
          <form
            aria-label={A.addLabel}
            className="enterprise-admin-add flex flex-wrap items-end gap-2 bg-neutral-50 px-5 py-4 dark:bg-neutral-900/60"
            onSubmit={(e) => {
              e.preventDefault();
              void run(
                addUserId,
                () => enterpriseApi.setMemberRole(enterprise.id, addUserId, addRole),
                A.addFailed,
              ).then((ok) => ok && setAddUserId(''));
            }}
          >
            <div className="min-w-60 flex-1">
              <Select
                label={A.addLabel}
                hideLabel
                placeholder={A.addPlaceholder}
                searchable
                searchPlaceholder={A.addSearch}
                noResultsText={A.noUsers}
                value={addUserId}
                onValueChange={setAddUserId}
                options={options}
              />
            </div>
            <Select
              label={A.addRole}
              hideLabel
              value={addRole}
              onValueChange={(value) => setAddRole(value as EnterpriseRole)}
              options={ROLE_OPTIONS}
              className="w-32"
            />
            <Button type="submit" disabled={!addUserId || busy}>
              {A.add}
            </Button>
          </form>
        )}
      </CardContent>

      <AppModal open={removeId !== null} onOpenChange={(o) => !o && !removing && setRemoveId(null)}>
        <ModalHeader>
          <ModalTitle>{A.removeTitle}</ModalTitle>
        </ModalHeader>
        <ModalBody>
          <Text variant="muted" size="sm">
            {A.removeBody(removeName)}
          </Text>
        </ModalBody>
        <ModalFooter>
          <ButtonGroup>
            <Button variant="outline" onClick={() => setRemoveId(null)} disabled={removing}>
              {A.cancel}
            </Button>
            <Button
              variant="danger"
              disabled={removing}
              onClick={() => {
                if (!removeId) return;
                void run(
                  removeId,
                  () => enterpriseApi.removeMember(enterprise.id, removeId),
                  A.removeFailed,
                ).then(() => setRemoveId(null));
              }}
            >
              {removing ? A.removing : A.removeConfirm}
            </Button>
          </ButtonGroup>
        </ModalFooter>
      </AppModal>
    </Card>
  );
};

/** The app-wide refresh reloads session, teams and clock, not organizations. */
const useRefreshOrganizations = () => {
  const { refetchOrganizations } = useTeam();
  useRefresh(useCallback(async () => refetchOrganizations(), [refetchOrganizations]));
};

const EnterpriseAdminView: React.FC<{ role: EnterpriseRole }> = ({ role }) => {
  const { navigate } = useRouter();
  const { enterprise, loading, error, reload } = useEnterpriseDetail();
  useRefreshOrganizations();

  const sections = [
    { id: 'organizations', label: S.page.sections.organizations },
    { id: 'defaults', label: S.page.sections.defaults },
    { id: 'admins', label: S.page.sections.admins },
  ];

  return (
    <AppPage
      titleActions={
        <Button
          variant="secondary"
          leftIcon={<SettingsIcon className="h-4 w-4" />}
          onClick={() => navigate(settingsPath('enterprise'))}
          aria-label={S.page.settings}
        >
          <span className="max-md:hidden">{S.page.settings}</span>
        </Button>
      }
    >
      {error && <Alert variant="danger">{error}</Alert>}
      {!enterprise ? (
        loading || !error ? (
          <div className="flex justify-center py-12">
            <Spinner size="lg" label={S.page.loading} />
          </div>
        ) : null
      ) : (
        <>
          <div className="enterprise-identity flex items-center gap-3">
            <Avatar name={enterprise.name} size="lg" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Text as="h2" size="xl" weight="bold">
                  {enterprise.name}
                </Text>
                <Badge>{S.roles[role]}</Badge>
              </div>
              <Text variant="muted" size="sm">
                {S.page.description}
              </Text>
            </div>
          </div>
          <SectionSpyNav items={sections} label={S.page.sectionsLabel} />
          <OrganizationsCard enterprise={enterprise} />
          <DefaultsSummaryCard enterprise={enterprise} />
          <AdminsCard enterprise={enterprise} role={role} reload={reload} />
        </>
      )}
    </AppPage>
  );
};

// ─── Member view ──────────────────────────────────────────────────────────────

/** Which enterprise and organizations you belong to, read-only. */
const EnterpriseMemberView: React.FC = () => {
  const M = S.member;
  const { organizations, selectedOrgId } = useTeam();
  const open = useOpenOrganization();
  useRefreshOrganizations();

  const groups = useMemo(() => {
    const byEnterprise = new Map<string, { name: string | null; orgs: Organization[] }>();
    organizations.forEach((org) => {
      const key = org.enterpriseId ?? '';
      const group = byEnterprise.get(key) ?? { name: org.enterpriseName ?? null, orgs: [] };
      group.orgs.push(org);
      byEnterprise.set(key, group);
    });
    return [...byEnterprise.entries()];
  }, [organizations]);

  return (
    <AppPage subtitle={M.description}>
      {groups.length === 0 && (
        <Text variant="muted" size="sm">
          {M.none}
        </Text>
      )}
      {groups.map(([key, group]) => (
        <Card key={key || 'none'} padding="none" className="enterprise-membership">
          <CardHeader className="flex flex-row items-center gap-3 px-5 py-4">
            <Avatar name={group.name ?? M.noEnterprise} />
            <CardTitle>{group.name ?? M.noEnterprise}</CardTitle>
          </CardHeader>
          <CardContent className="divide-y divide-neutral-100 border-t border-neutral-100 p-0 dark:divide-neutral-800 dark:border-neutral-800">
            <Text
              size="xs"
              weight="semibold"
              variant="muted"
              className="px-5 pt-3 uppercase tracking-widest"
            >
              {M.yourOrganizations}
            </Text>
            {group.orgs.map((org) => (
              <div key={org.id} className="enterprise-member-org flex items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Text size="sm" weight="medium">
                      {org.name}
                    </Text>
                    {org.id === selectedOrgId && (
                      <Badge variant="outline">{S.organizations.current}</Badge>
                    )}
                  </div>
                  <Text variant="muted" size="xs">
                    {M.yourRole[org.role ?? 'member']}
                  </Text>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={S.organizations.openFor(org.name)}
                  onClick={() => open(org)}
                  className="text-primary-600 dark:text-primary-400"
                >
                  {S.organizations.open}
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
      <Text variant="muted" size="xs">
        {M.managedBy}
      </Text>
    </AppPage>
  );
};

// ─── EnterprisePage ───────────────────────────────────────────────────────────

export const EnterprisePage: React.FC = () => {
  const { enterprises, selectedEnterpriseId } = useTeam();
  const role = getEnterpriseRole(enterprises, selectedEnterpriseId);
  return role ? <EnterpriseAdminView role={role} /> : <EnterpriseMemberView />;
};
