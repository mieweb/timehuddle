import { ObjectId } from "mongodb";
import {
  enterprisesCollection,
  orgMembersCollection,
  organizationsCollection,
  teamsCollection,
  usersCollection,
} from "../models/index.js";
import {
  DEFAULT_ENTERPRISE_NAME,
  DEFAULT_ENTERPRISE_SLUG,
  DEFAULT_ORG_KEY,
  DEFAULT_ORG_NAME,
} from "../lib/org-config.js";
import { slugify } from "../lib/slug.js";
import type { Enterprise } from "../models/enterprise.model.js";
import type { OrgMembershipRole } from "../models/org-membership.model.js";
import type { Organization } from "../models/organization.model.js";

export type OrgUserReportsToUpdateResult =
  | { userId: string; reportsToUserId: string | null }
  | "forbidden"
  | "user-not-found"
  | "reports-to-user-not-found"
  | "reports-to-self"
  | "default-organization-not-found";

export type OrgUserSearchResult = Array<{ id: string; name: string; username: string | null }>;

export type OrgSummary = {
  id: string;
  enterpriseId: string | null;
  name: string;
  slug: string;
  allowAutoJoin: boolean;
  role: OrgMembershipRole | null;
};

export type OrgMemberSummary = {
  id: string;
  name: string;
  email: string;
  username: string | null;
  image: string | null;
  reportsToUserId: string | null;
  role: OrgMembershipRole;
  auto: boolean;
};

export type OrgMembershipUpdateResult =
  | { userId: string; role: OrgMembershipRole }
  | "forbidden"
  | "not-found"
  | "user-not-found"
  | "last-elevated";

export type OrgMembershipRemoveResult =
  | { userId: string }
  | "forbidden"
  | "not-found"
  | "user-not-found"
  | "not-member"
  | "last-elevated";

export type OrgJoinResult =
  | { orgId: string; role: OrgMembershipRole }
  | "not-found"
  | "auto-join-disabled";

export type OrgAllowAutoJoinResult =
  | { orgId: string; allowAutoJoin: boolean }
  | "forbidden"
  | "not-found";

const ELEVATED_ROLES: readonly OrgMembershipRole[] = ["owner", "admin"];
const ROLE_RANK: Record<OrgMembershipRole, number> = {
  member: 1,
  admin: 2,
  owner: 3,
};

function isValidId(id: string): boolean {
  return /^[0-9a-f]{24}$/i.test(id);
}

function uniqueIds(values: Iterable<string>): string[] {
  return Array.from(new Set(Array.from(values).filter(Boolean)));
}

function toOrgSummary(
  org: Organization & { _id: ObjectId },
  role: OrgMembershipRole | null
): OrgSummary {
  return {
    id: org._id.toHexString(),
    enterpriseId: org.enterpriseId ?? null,
    name: org.name,
    slug: org.slug,
    allowAutoJoin: org.allowAutoJoin !== false,
    role,
  };
}

export class OrgService {
  private async getEnterpriseRoleForOrg(
    userId: string,
    org: Organization & { _id: ObjectId }
  ): Promise<"owner" | "admin" | null> {
    if (!org.enterpriseId || !isValidId(org.enterpriseId)) return null;

    const enterprise = await enterprisesCollection().findOne({
      _id: new ObjectId(org.enterpriseId),
    });
    if (!enterprise) return null;
    if ((enterprise.owners ?? []).includes(userId)) return "owner";
    if ((enterprise.admins ?? []).includes(userId)) return "admin";
    return null;
  }

  private async canManageOrg(
    userId: string,
    org: Organization & { _id: ObjectId }
  ): Promise<{
    canManage: boolean;
    role: OrgMembershipRole | null;
  }> {
    const membership = await this.getOrgMembership(org._id.toHexString(), userId);
    if (membership && ELEVATED_ROLES.includes(membership.role)) {
      return { canManage: true, role: membership.role };
    }

    const enterpriseRole = await this.getEnterpriseRoleForOrg(userId, org);
    if (enterpriseRole) {
      return { canManage: true, role: enterpriseRole };
    }

    return { canManage: false, role: membership?.role ?? null };
  }

  async ensureDefaultEnterprise(): Promise<Enterprise & { _id: ObjectId }> {
    const existing = await enterprisesCollection().findOne({ slug: DEFAULT_ENTERPRISE_SLUG });
    if (existing) return existing;

    const now = new Date();
    const enterprise: Enterprise & { _id: ObjectId } = {
      _id: new ObjectId(),
      name: DEFAULT_ENTERPRISE_NAME,
      slug: DEFAULT_ENTERPRISE_SLUG,
      owners: [],
      admins: [],
      createdAt: now,
      updatedAt: now,
    };
    await enterprisesCollection().insertOne(enterprise);
    return enterprise;
  }

  async ensureDefaultOrganization(): Promise<Organization & { _id: ObjectId }> {
    const defaultEnterprise = await this.ensureDefaultEnterprise();
    const existing = await organizationsCollection().findOne({ slug: DEFAULT_ORG_KEY });
    if (existing) {
      const updates: Partial<Organization> = {};
      if (!existing.enterpriseId) updates.enterpriseId = defaultEnterprise._id.toHexString();
      if (existing.allowAutoJoin === undefined) updates.allowAutoJoin = true;

      if (Object.keys(updates).length > 0) {
        updates.updatedAt = new Date();
        await organizationsCollection().updateOne({ _id: existing._id }, { $set: updates });
        return (await organizationsCollection().findOne({ _id: existing._id })) ?? existing;
      }

      return existing;
    }

    const now = new Date();
    const org: Organization & { _id: ObjectId } = {
      _id: new ObjectId(),
      enterpriseId: defaultEnterprise._id.toHexString(),
      slug: DEFAULT_ORG_KEY,
      name: DEFAULT_ORG_NAME,
      owners: [],
      admins: [],
      allowAutoJoin: true,
      createdAt: now,
      updatedAt: now,
    };
    await organizationsCollection().insertOne(org);
    return org;
  }

  private async resolveFallbackRole(
    orgId: string,
    userId: string
  ): Promise<OrgMembershipRole | null> {
    if (!isValidId(orgId)) return null;

    const org = await organizationsCollection().findOne({ _id: new ObjectId(orgId) });
    if (!org) return null;
    if ((org.owners ?? []).includes(userId)) return "owner";
    if ((org.admins ?? []).includes(userId)) return "admin";
    return null;
  }

  async getOrgMembership(
    orgId: string,
    userId: string
  ): Promise<{ orgId: string; userId: string; role: OrgMembershipRole; auto: boolean } | null> {
    const membership = await orgMembersCollection().findOne({ orgId, userId });
    if (membership) {
      return {
        orgId: membership.orgId,
        userId: membership.userId,
        role: membership.role,
        auto: membership.auto,
      };
    }

    const fallbackRole = await this.resolveFallbackRole(orgId, userId);
    if (!fallbackRole) return null;
    return { orgId, userId, role: fallbackRole, auto: false };
  }

  private async syncLegacyRoleArrays(orgId: string, userId: string, role: OrgMembershipRole) {
    if (!isValidId(orgId)) return;
    const updatedAt = new Date();

    if (role === "owner") {
      await organizationsCollection().updateOne(
        { _id: new ObjectId(orgId) },
        {
          $addToSet: { owners: userId },
          $pull: { admins: userId } as any,
          $set: { updatedAt },
        }
      );
      return;
    }

    if (role === "admin") {
      await organizationsCollection().updateOne(
        { _id: new ObjectId(orgId) },
        {
          $pull: { owners: userId } as any,
          $addToSet: { admins: userId },
          $set: { updatedAt },
        }
      );
      return;
    }

    await organizationsCollection().updateOne(
      { _id: new ObjectId(orgId) },
      {
        $pull: { owners: userId, admins: userId } as any,
        $set: { updatedAt },
      }
    );
  }

  async addOrgMember(
    orgId: string,
    userId: string,
    role: OrgMembershipRole = "member",
    auto = false
  ): Promise<
    { orgId: string; userId: string; role: OrgMembershipRole; auto: boolean } | "not-found"
  > {
    if (!isValidId(orgId)) return "not-found";

    const org = await organizationsCollection().findOne({ _id: new ObjectId(orgId) });
    if (!org) return "not-found";

    const existing = await orgMembersCollection().findOne({ orgId, userId });
    const nextRole = existing
      ? ROLE_RANK[role] > ROLE_RANK[existing.role]
        ? role
        : existing.role
      : role;
    const nextAuto = existing ? existing.auto && auto && existing.role === nextRole : auto;

    if (existing) {
      if (existing.role !== nextRole || existing.auto !== nextAuto) {
        await orgMembersCollection().updateOne(
          { _id: existing._id },
          { $set: { role: nextRole, auto: nextAuto, updatedAt: new Date() } }
        );
      }
    } else {
      await orgMembersCollection().insertOne({
        _id: new ObjectId(),
        orgId,
        userId,
        role: nextRole,
        auto: nextAuto,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    await this.syncLegacyRoleArrays(orgId, userId, nextRole);
    return { orgId, userId, role: nextRole, auto: nextAuto };
  }

  async isSlugAvailable(slug: string, excludeOrgId?: string): Promise<boolean> {
    const filter: Record<string, unknown> = { slug };
    if (excludeOrgId && isValidId(excludeOrgId))
      filter["_id"] = { $ne: new ObjectId(excludeOrgId) };
    const existing = await organizationsCollection().findOne(filter, { projection: { _id: 1 } });
    return existing === null;
  }

  async updateOrganization(
    userId: string,
    orgId: string,
    input: { name?: string; slug?: string; allowAutoJoin?: boolean }
  ): Promise<OrgSummary | "not-found" | "forbidden" | "conflict"> {
    if (!isValidId(orgId)) return "not-found";

    const org = await organizationsCollection().findOne({ _id: new ObjectId(orgId) });
    if (!org) return "not-found";

    const access = await this.canManageOrg(userId, org);
    if (!access.canManage) return "forbidden";

    const updates: Partial<Organization & { updatedAt: Date }> = { updatedAt: new Date() };

    if (input.name !== undefined) {
      const trimmed = input.name.trim();
      if (trimmed) updates.name = trimmed;
    }

    if (input.slug !== undefined) {
      const newSlug = slugify(input.slug) || org.slug;
      if (newSlug !== org.slug) {
        const conflict = await organizationsCollection().findOne(
          { slug: newSlug, _id: { $ne: new ObjectId(orgId) } },
          { projection: { _id: 1 } }
        );
        if (conflict) return "conflict";
      }
      updates.slug = newSlug;
    }

    if (input.allowAutoJoin !== undefined) updates.allowAutoJoin = input.allowAutoJoin;

    await organizationsCollection().updateOne({ _id: new ObjectId(orgId) }, { $set: updates });
    const updated = await organizationsCollection().findOne({ _id: new ObjectId(orgId) });
    if (!updated) return "not-found";
    return toOrgSummary(updated, access.role);
  }

  async listOrganizationsForUser(userId: string): Promise<OrgSummary[]> {
    const [memberships, ownedOrAdminOrgs, teamOrgs, enterpriseManagedOrgs] = await Promise.all([
      orgMembersCollection().find({ userId }).toArray(),
      organizationsCollection()
        .find({ $or: [{ owners: userId }, { admins: userId }] }, { projection: { _id: 1 } })
        .toArray(),
      teamsCollection()
        .find({ $or: [{ members: userId }, { admins: userId }] }, { projection: { orgId: 1 } })
        .toArray(),
      (async () => {
        const enterpriseDocs = await enterprisesCollection()
          .find({ $or: [{ owners: userId }, { admins: userId }] }, { projection: { _id: 1 } })
          .toArray();
        const enterpriseIds = enterpriseDocs.map((enterprise) => enterprise._id.toHexString());
        if (enterpriseIds.length === 0) return [] as Array<{ _id: ObjectId }>;
        return organizationsCollection()
          .find({ enterpriseId: { $in: enterpriseIds } }, { projection: { _id: 1 } })
          .toArray();
      })(),
    ]);

    const orgIds = uniqueIds([
      ...memberships.map((membership) => membership.orgId),
      ...ownedOrAdminOrgs.map((org) => org._id.toHexString()),
      ...teamOrgs.map((team) => team.orgId).filter((orgId): orgId is string => !!orgId),
      ...enterpriseManagedOrgs.map((org) => org._id.toHexString()),
    ]).filter(isValidId);

    if (orgIds.length === 0) return [];

    const organizations = await organizationsCollection()
      .find({ _id: { $in: orgIds.map((orgId) => new ObjectId(orgId)) } })
      .sort({ name: 1 })
      .toArray();

    const summaries = await Promise.all(
      organizations.map(async (org) => {
        const membership = await this.getOrgMembership(org._id.toHexString(), userId);
        if (membership) return toOrgSummary(org, membership.role);

        const enterpriseRole = await this.getEnterpriseRoleForOrg(userId, org);
        return toOrgSummary(org, enterpriseRole ?? "member");
      })
    );

    return summaries.sort((a, b) => a.name.localeCompare(b.name));
  }

  async getOrganization(
    orgId: string,
    userId: string
  ): Promise<(OrgSummary & { canManage: boolean }) | "not-found" | "forbidden"> {
    if (!isValidId(orgId)) return "not-found";

    const org = await organizationsCollection().findOne({ _id: new ObjectId(orgId) });
    if (!org) return "not-found";

    const accessibleOrgIds = await this.getAccessibleOrgIds(userId);
    if (!accessibleOrgIds.includes(orgId)) return "forbidden";

    const membership = await this.getOrgMembership(orgId, userId);
    const enterpriseRole = await this.getEnterpriseRoleForOrg(userId, org);
    const canManage =
      (!!membership && ELEVATED_ROLES.includes(membership.role)) || !!enterpriseRole;
    return {
      ...toOrgSummary(org, membership?.role ?? enterpriseRole ?? "member"),
      canManage,
    };
  }

  async listMembers(
    orgId: string,
    requesterUserId: string
  ): Promise<OrgMemberSummary[] | "not-found" | "forbidden"> {
    const org = isValidId(orgId)
      ? await organizationsCollection().findOne({ _id: new ObjectId(orgId) })
      : null;
    if (!org) return "not-found";

    const access = await this.canManageOrg(requesterUserId, org);
    if (!access.canManage) return "forbidden";

    const membershipDocs = await orgMembersCollection().find({ orgId }).toArray();
    const legacyIds = uniqueIds([...(org.owners ?? []), ...(org.admins ?? [])]);
    const missingLegacyIds = legacyIds.filter(
      (userId) => !membershipDocs.some((membership) => membership.userId === userId)
    );
    const allMembers = [
      ...membershipDocs.map((membership) => ({
        userId: membership.userId,
        role: membership.role,
        auto: membership.auto,
      })),
      ...missingLegacyIds.map((userId) => ({
        userId,
        role: (org.owners ?? []).includes(userId) ? ("owner" as const) : ("admin" as const),
        auto: false,
      })),
    ];

    const validUserIds = allMembers
      .filter((member) => isValidId(member.userId))
      .map((member) => new ObjectId(member.userId));
    const users = await usersCollection()
      .find(
        { _id: { $in: validUserIds } },
        { projection: { name: 1, email: 1, username: 1, image: 1, reportsToUserId: 1 } }
      )
      .toArray();
    const byId = new Map(users.map((user) => [user._id.toHexString(), user]));

    return allMembers
      .map((member) => {
        const user = byId.get(member.userId);
        if (!user) return null;
        return {
          id: member.userId,
          name: user.name,
          email: user.email,
          username: user.username ?? null,
          image: user.image ?? null,
          reportsToUserId: user.reportsToUserId ?? null,
          role: member.role,
          auto: member.auto,
        };
      })
      .filter((member): member is OrgMemberSummary => !!member)
      .sort((a, b) => a.name.localeCompare(b.name) || a.email.localeCompare(b.email));
  }

  async setOrgRole(
    requesterUserId: string,
    orgId: string,
    targetUserId: string,
    role: OrgMembershipRole
  ): Promise<OrgMembershipUpdateResult> {
    if (!isValidId(orgId)) return "not-found";
    if (!isValidId(targetUserId)) return "user-not-found";

    const [org, targetUser, membershipDocs] = await Promise.all([
      organizationsCollection().findOne({ _id: new ObjectId(orgId) }),
      usersCollection().findOne({ _id: new ObjectId(targetUserId) }),
      orgMembersCollection().find({ orgId }).toArray(),
    ]);
    if (!org) return "not-found";

    const access = await this.canManageOrg(requesterUserId, org);
    if (!access.canManage) return "forbidden";

    if (!targetUser) return "user-not-found";

    const elevatedUserIds = new Set<string>([
      ...(org.owners ?? []),
      ...(org.admins ?? []),
      ...membershipDocs
        .filter((membership) => ELEVATED_ROLES.includes(membership.role))
        .map((membership) => membership.userId),
    ]);

    const currentRole = await this.getOrgMembership(orgId, targetUserId);
    if (
      currentRole &&
      ELEVATED_ROLES.includes(currentRole.role) &&
      role === "member" &&
      elevatedUserIds.size === 1 &&
      elevatedUserIds.has(targetUserId)
    ) {
      return "last-elevated";
    }

    await this.addOrgMember(orgId, targetUserId, role, false);
    return { userId: targetUserId, role };
  }

  async removeOrgMember(
    requesterUserId: string,
    orgId: string,
    targetUserId: string
  ): Promise<OrgMembershipRemoveResult> {
    if (!isValidId(orgId)) return "not-found";
    if (!isValidId(targetUserId)) return "user-not-found";

    const [org, targetUser, membershipDocs] = await Promise.all([
      organizationsCollection().findOne({ _id: new ObjectId(orgId) }),
      usersCollection().findOne({ _id: new ObjectId(targetUserId) }),
      orgMembersCollection().find({ orgId }).toArray(),
    ]);

    if (!org) return "not-found";

    const access = await this.canManageOrg(requesterUserId, org);
    if (!access.canManage) return "forbidden";

    if (!targetUser) return "user-not-found";

    const currentRole = await this.getOrgMembership(orgId, targetUserId);
    if (!currentRole) return "not-member";

    const elevatedUserIds = new Set<string>([
      ...(org.owners ?? []),
      ...(org.admins ?? []),
      ...membershipDocs
        .filter((membership) => ELEVATED_ROLES.includes(membership.role))
        .map((membership) => membership.userId),
    ]);

    if (
      ELEVATED_ROLES.includes(currentRole.role) &&
      elevatedUserIds.size === 1 &&
      elevatedUserIds.has(targetUserId)
    ) {
      return "last-elevated";
    }

    await orgMembersCollection().deleteMany({ orgId, userId: targetUserId });
    await this.syncLegacyRoleArrays(orgId, targetUserId, "member");

    return { userId: targetUserId };
  }

  async setAllowAutoJoin(
    requesterUserId: string,
    orgId: string,
    allowAutoJoin: boolean
  ): Promise<OrgAllowAutoJoinResult> {
    if (!isValidId(orgId)) return "not-found";

    const org = await organizationsCollection().findOne({ _id: new ObjectId(orgId) });
    if (!org) return "not-found";

    const access = await this.canManageOrg(requesterUserId, org);
    if (!access.canManage) return "forbidden";

    const result = await organizationsCollection().findOneAndUpdate(
      { _id: new ObjectId(orgId) },
      { $set: { allowAutoJoin, updatedAt: new Date() } },
      { returnDocument: "after" }
    );
    if (!result) return "not-found";
    return { orgId: result._id.toHexString(), allowAutoJoin: result.allowAutoJoin !== false };
  }

  async joinOrg(userId: string, orgId: string): Promise<OrgJoinResult> {
    if (!isValidId(orgId)) return "not-found";

    const org = await organizationsCollection().findOne({ _id: new ObjectId(orgId) });
    if (!org) return "not-found";
    if (org.allowAutoJoin === false) return "auto-join-disabled";

    const membership = await this.addOrgMember(orgId, userId, "member", true);
    if (membership === "not-found") return "not-found";
    return { orgId: membership.orgId, role: membership.role };
  }

  async getAccessibleOrgIds(userId: string): Promise<string[]> {
    const orgs = await this.listOrganizationsForUser(userId);
    return orgs.map((org) => org.id);
  }

  async createOrganization(data: {
    enterpriseId: string;
    userId: string;
    name: string;
    slug?: string;
    allowAutoJoin?: boolean;
  }): Promise<OrgSummary | "forbidden" | "not-found" | "conflict"> {
    if (!isValidId(data.enterpriseId)) return "not-found";

    const enterprise = await enterprisesCollection().findOne({
      _id: new ObjectId(data.enterpriseId),
    });
    if (!enterprise) return "not-found";

    const isEnterpriseAdmin =
      (enterprise.owners ?? []).includes(data.userId) ||
      (enterprise.admins ?? []).includes(data.userId);
    if (!isEnterpriseAdmin) return "forbidden";

    const trimmedName = data.name.trim();
    const slug = slugify(data.slug ?? trimmedName) || `org-${Date.now()}`;

    const conflict = await organizationsCollection().findOne({ slug });
    if (conflict) return "conflict";

    const now = new Date();
    const org: Organization & { _id: ObjectId } = {
      _id: new ObjectId(),
      enterpriseId: data.enterpriseId,
      slug,
      name: trimmedName,
      owners: [data.userId],
      admins: [],
      allowAutoJoin: data.allowAutoJoin !== false,
      createdAt: now,
      updatedAt: now,
    };
    await organizationsCollection().insertOne(org);
    await this.addOrgMember(org._id.toHexString(), data.userId, "owner", false);
    return toOrgSummary(org, "owner");
  }

  private async resolveDefaultOrganizationMembership(userId: string): Promise<{
    organizationId: string;
    organizationSlug: string;
    role: "owner" | "admin";
  } | null> {
    const defaultOrg = await this.ensureDefaultOrganization();
    const membership = await this.getOrgMembership(defaultOrg._id.toHexString(), userId);
    if (!membership || (membership.role !== "owner" && membership.role !== "admin")) {
      return null;
    }

    return {
      organizationId: defaultOrg._id.toHexString(),
      organizationSlug: defaultOrg.slug,
      role: membership.role,
    };
  }

  async updateOrgUserReportsTo(
    requesterUserId: string,
    userId: string,
    reportsToUserId?: string | null
  ): Promise<OrgUserReportsToUpdateResult> {
    const requesterMembership = await this.resolveDefaultOrganizationMembership(requesterUserId);
    if (!requesterMembership || !["owner", "admin"].includes(requesterMembership.role)) {
      return "forbidden";
    }

    const [user, defaultOrg] = await Promise.all([
      usersCollection().findOne({ _id: new ObjectId(userId) }),
      organizationsCollection().findOne({ slug: DEFAULT_ORG_KEY }),
    ]);

    if (!defaultOrg) return "default-organization-not-found";
    if (!user) return "user-not-found";

    if (reportsToUserId !== undefined && reportsToUserId !== null) {
      const reportsToUser = await usersCollection().findOne({ _id: new ObjectId(reportsToUserId) });
      if (!reportsToUser) return "reports-to-user-not-found";
    }

    await usersCollection().updateOne(
      { _id: new ObjectId(userId) },
      { $set: { reportsToUserId, updatedAt: new Date() } }
    );

    return { userId, reportsToUserId: reportsToUserId ?? null };
  }

  async updateOrganizationMemberReportsTo(
    requesterUserId: string,
    orgId: string,
    userId: string,
    reportsToUserId?: string | null
  ): Promise<OrgUserReportsToUpdateResult | "not-found" | "not-member"> {
    if (!isValidId(orgId)) return "not-found";
    if (!isValidId(userId)) return "user-not-found";

    const org = await organizationsCollection().findOne({ _id: new ObjectId(orgId) });
    if (!org) return "not-found";

    const access = await this.canManageOrg(requesterUserId, org);
    if (!access.canManage) return "forbidden";

    const targetMembership = await this.getOrgMembership(orgId, userId);
    if (!targetMembership) return "not-member";

    if (reportsToUserId !== undefined && reportsToUserId !== null) {
      if (!isValidId(reportsToUserId)) return "reports-to-user-not-found";
      if (reportsToUserId === userId) return "reports-to-self";

      const reportsToMembership = await this.getOrgMembership(orgId, reportsToUserId);
      if (!reportsToMembership) return "reports-to-user-not-found";
    }

    await usersCollection().updateOne(
      { _id: new ObjectId(userId) },
      { $set: { reportsToUserId: reportsToUserId ?? null, updatedAt: new Date() } }
    );

    return { userId, reportsToUserId: reportsToUserId ?? null };
  }

  async searchUsers(
    requesterUserId: string,
    orgId: string,
    query: string
  ): Promise<OrgUserSearchResult | "not-found" | "forbidden"> {
    if (!isValidId(orgId)) return "not-found";

    const org = await organizationsCollection().findOne({ _id: new ObjectId(orgId) });
    if (!org) return "not-found";

    const access = await this.canManageOrg(requesterUserId, org);
    if (!access.canManage) return "forbidden";

    const q = query.trim();
    const filter = q
      ? {
          $or: [
            { name: { $regex: q, $options: "i" } },
            { username: { $regex: q, $options: "i" } },
            { email: { $regex: q, $options: "i" } },
          ],
        }
      : {};

    const users = await usersCollection()
      .find(filter)
      .project<{ _id: ObjectId; name: string; username?: string | null }>({
        _id: 1,
        name: 1,
        username: 1,
      })
      .sort({ name: 1 })
      .limit(20)
      .toArray();

    return users.map((u) => ({
      id: u._id.toHexString(),
      name: u.name,
      username: u.username ?? null,
    }));
  }
}

export const orgService = new OrgService();
