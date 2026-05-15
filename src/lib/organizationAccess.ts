import type { TimecoreUser } from './api';

export type OrganizationRole = 'owner' | 'admin';

export function hasDefaultOrganizationAdminAccess(user: TimecoreUser | null): boolean {
  if (!user?.organizationMembership) return false;
  return user.organizationMembership.role === 'owner' || user.organizationMembership.role === 'admin';
}
