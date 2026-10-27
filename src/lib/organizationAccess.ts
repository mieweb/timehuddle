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

/**
 * Who sees Members, invitations and Organization settings for the selected
 * organization: its owners and admins, and the owners and admins of its
 * enterprise, who manage every organization in it even where their own
 * membership is plain `member` (as the server's buildOrgAccess grants).
 * Display only; the server checks every action.
 */
export function canManageSelectedOrganization(
  organizations: ReadonlyArray<{
    id: string;
    enterpriseId?: string | null;
    role: OrganizationRole | 'member' | null;
  }>,
  enterprises: ReadonlyArray<{ id: string }>,
  selectedOrgId: string | null,
): boolean {
  const org = organizations.find((organization) => organization.id === selectedOrgId);
  if (!org) return false;
  if (org.role === 'owner' || org.role === 'admin') return true;
  // TeamContext's enterprise list holds only those the user owns or administers.
  return !!org.enterpriseId && enterprises.some((enterprise) => enterprise.id === org.enterpriseId);
}
