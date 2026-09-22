import type { TimecoreUser } from './api';

export type OrganizationRole = 'owner' | 'admin';
export type EnterpriseRole = 'owner' | 'admin';

const DEFAULT_ORG_ADMIN_ROLES: readonly OrganizationRole[] = ['owner', 'admin'];
const ENTERPRISE_ADMIN_ROLES: readonly EnterpriseRole[] = ['owner', 'admin'];

export function getDefaultOrganizationRole(user: TimecoreUser | null): OrganizationRole | null {
  return user?.organizationMembership?.role ?? null;
}

export function hasDefaultOrganizationRole(
  user: TimecoreUser | null,
  roles: readonly OrganizationRole[],
): boolean {
  const role = getDefaultOrganizationRole(user);
  return !!role && roles.includes(role);
}

export function hasDefaultOrganizationAdminAccess(user: TimecoreUser | null): boolean {
  return hasDefaultOrganizationRole(user, DEFAULT_ORG_ADMIN_ROLES);
}

type EnterpriseMembership = {
  id: string;
  role: EnterpriseRole;
};

export function getEnterpriseRole(
  enterprises: EnterpriseMembership[],
  selectedEnterpriseId: string | null,
): EnterpriseRole | null {
  if (!selectedEnterpriseId) return null;
  return enterprises.find((enterprise) => enterprise.id === selectedEnterpriseId)?.role ?? null;
}

export function hasEnterpriseAdminAccess(
  enterprises: EnterpriseMembership[],
  selectedEnterpriseId: string | null,
): boolean {
  const role = getEnterpriseRole(enterprises, selectedEnterpriseId);
  return !!role && ENTERPRISE_ADMIN_ROLES.includes(role);
}

/**
 * Owner or admin of at least one organization.
 *
 * Reads the per-org roles TeamContext loads, rather than
 * `user.organizationMembership` — which `useSession` never populates, so
 * `hasDefaultOrganizationAdminAccess` is false for everyone today. Server-side
 * gates stay the authority; this only decides what is worth showing.
 */
export function hasOrganizationAdminAccess(
  organizations: ReadonlyArray<{ role: OrganizationRole | 'member' | null }>,
): boolean {
  return organizations.some(
    (organization) =>
      organization.role !== null &&
      organization.role !== 'member' &&
      DEFAULT_ORG_ADMIN_ROLES.includes(organization.role),
  );
}
