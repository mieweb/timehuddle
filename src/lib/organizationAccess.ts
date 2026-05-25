import type { TimecoreUser } from './api';

export type OrganizationRole = 'owner' | 'admin';

const DEFAULT_ORG_ADMIN_ROLES: readonly OrganizationRole[] = ['owner', 'admin'];

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
