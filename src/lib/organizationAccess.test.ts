/**
 * Unit tests for organizationAccess.
 *
 * Focused on hasOrganizationAdminAccess, which decides whether the Usage
 * admin page and its menu entry are offered at all. The server re-checks
 * before handing over anyone's activity, but a helper that says yes too
 * readily still puts an admin surface in front of the wrong person.
 */
import { describe, expect, it } from 'vitest';

import {
  canManageSelectedOrganization,
  canManageTeam,
  hasDefaultOrganizationAdminAccess,
  hasOrganizationAdminAccess,
} from './organizationAccess';

describe('hasOrganizationAdminAccess', () => {
  it('is true for an owner or an admin of any organization', () => {
    expect(hasOrganizationAdminAccess([{ role: 'owner' }])).toBe(true);
    expect(hasOrganizationAdminAccess([{ role: 'admin' }])).toBe(true);
    expect(hasOrganizationAdminAccess([{ role: 'member' }, { role: 'admin' }])).toBe(true);
  });

  it('is false for a plain member, however many organizations they are in', () => {
    expect(hasOrganizationAdminAccess([{ role: 'member' }, { role: 'member' }])).toBe(false);
  });

  it('is false with no organizations, or with roles that have not loaded yet', () => {
    expect(hasOrganizationAdminAccess([])).toBe(false);
    expect(hasOrganizationAdminAccess([{ role: null }])).toBe(false);
  });
});

describe('hasDefaultOrganizationAdminAccess', () => {
  it('reads the membership role off the session user', () => {
    expect(
      hasDefaultOrganizationAdminAccess({
        organizationMembership: { role: 'owner' },
      } as Parameters<typeof hasDefaultOrganizationAdminAccess>[0]),
    ).toBe(true);
  });

  it('is false when the session carries no membership — which is every user today', () => {
    // useSession hard-codes organizationMembership to null, so this helper
    // cannot gate anything on its own. hasOrganizationAdminAccess exists
    // because of that; if this test ever starts failing, the session began
    // populating the field and the two helpers should be reconciled.
    expect(hasDefaultOrganizationAdminAccess(null)).toBe(false);
    expect(
      hasDefaultOrganizationAdminAccess({
        organizationMembership: null,
      } as Parameters<typeof hasDefaultOrganizationAdminAccess>[0]),
    ).toBe(false);
  });
});

describe('canManageSelectedOrganization', () => {
  const orgs = [
    { id: 'o1', enterpriseId: 'e1', role: 'member' as const },
    { id: 'o2', enterpriseId: null, role: 'admin' as const },
    { id: 'o3', enterpriseId: 'e2', role: 'member' as const },
  ];

  it("follows the selected organization's own role", () => {
    expect(canManageSelectedOrganization(orgs, [], 'o2')).toBe(true);
    expect(canManageSelectedOrganization(orgs, [], 'o1')).toBe(false);
  });

  it('lets an owner or admin of its enterprise manage it, even as a plain member', () => {
    expect(canManageSelectedOrganization(orgs, [{ id: 'e1' }], 'o1')).toBe(true);
    expect(canManageSelectedOrganization(orgs, [{ id: 'e1' }], 'o3')).toBe(false);
  });

  it('is false with no selected organization', () => {
    expect(canManageSelectedOrganization(orgs, [{ id: 'e1' }], null)).toBe(false);
  });
});

describe('canManageTeam', () => {
  const team = { admins: ['admin-1'], orgId: 'org-1' };

  it('is true for the team’s admins', () => {
    expect(canManageTeam(team, 'admin-1', [])).toBe(true);
  });

  it('is true for owners of the team’s organization', () => {
    expect(canManageTeam(team, 'owner-1', [{ id: 'org-1', role: 'owner' }])).toBe(true);
  });

  it('is false for org admins, owners of another org, plain members and no user', () => {
    expect(canManageTeam(team, 'u', [{ id: 'org-1', role: 'admin' }])).toBe(false);
    expect(canManageTeam(team, 'u', [{ id: 'org-2', role: 'owner' }])).toBe(false);
    expect(canManageTeam(team, 'u', [{ id: 'org-1', role: 'member' }])).toBe(false);
    expect(canManageTeam(team, null, [{ id: 'org-1', role: 'owner' }])).toBe(false);
  });
});
