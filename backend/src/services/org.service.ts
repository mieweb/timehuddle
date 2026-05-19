import { ObjectId } from "mongodb";
import { organizationsCollection, usersCollection } from "../models/index.js";
import { DEFAULT_ORG_KEY } from "../lib/org-config.js";

export type OrgUserReportsToUpdateResult =
  | { userId: string; reportsToUserId: string | null }
  | "forbidden"
  | "user-not-found"
  | "reports-to-user-not-found"
  | "default-organization-not-found";

export class OrgService {
  private async resolveDefaultOrganizationMembership(userId: string): Promise<{
    organizationId: string;
    organizationKey: string;
    role: "owner" | "admin";
  } | null> {
    const defaultOrg = await organizationsCollection().findOne({ key: DEFAULT_ORG_KEY });
    if (!defaultOrg) return null;

    const owners = defaultOrg.owners ?? [];
    if (owners.includes(userId)) {
      return {
        organizationId: defaultOrg._id.toHexString(),
        organizationKey: defaultOrg.key,
        role: "owner",
      };
    }

    const admins = defaultOrg.admins ?? [];
    if (admins.includes(userId)) {
      return {
        organizationId: defaultOrg._id.toHexString(),
        organizationKey: defaultOrg.key,
        role: "admin",
      };
    }

    return null;
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
      organizationsCollection().findOne({ key: DEFAULT_ORG_KEY }),
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
}

export const orgService = new OrgService();
