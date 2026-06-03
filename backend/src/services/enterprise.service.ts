import { ObjectId } from "mongodb";
import { enterprisesCollection } from "../models/index.js";
import { slugify } from "../lib/slug.js";

export type EnterpriseSummary = {
  id: string;
  name: string;
  slug: string;
  role: "owner" | "admin";
};

export type EnterpriseDetail = EnterpriseSummary & {
  owners: string[];
  admins: string[];
};

function isValidId(id: string): boolean {
  return /^[0-9a-f]{24}$/i.test(id);
}

export class EnterpriseService {
  async listEnterprisesForUser(userId: string): Promise<EnterpriseSummary[]> {
    const enterprises = await enterprisesCollection()
      .find({ $or: [{ owners: userId }, { admins: userId }] })
      .sort({ name: 1 })
      .toArray();

    return enterprises.map((enterprise) => ({
      id: enterprise._id.toHexString(),
      name: enterprise.name,
      slug: enterprise.slug,
      role: (enterprise.owners ?? []).includes(userId) ? "owner" : "admin",
    }));
  }

  async getEnterprise(
    userId: string,
    enterpriseId: string
  ): Promise<EnterpriseDetail | "not-found" | "forbidden"> {
    if (!isValidId(enterpriseId)) return "not-found";

    const enterprise = await enterprisesCollection().findOne({ _id: new ObjectId(enterpriseId) });
    if (!enterprise) return "not-found";

    const owners = enterprise.owners ?? [];
    const admins = enterprise.admins ?? [];
    const role = owners.includes(userId) ? "owner" : admins.includes(userId) ? "admin" : null;
    if (!role) return "forbidden";

    return {
      id: enterprise._id.toHexString(),
      name: enterprise.name,
      slug: enterprise.slug,
      role,
      owners,
      admins,
    };
  }

  async createEnterprise(
    userId: string,
    input: { name: string; slug?: string }
  ): Promise<EnterpriseDetail | "conflict"> {
    const name = input.name.trim();
    const slug = slugify(input.slug ?? name) || `enterprise-${Date.now()}`;

    const existing = await enterprisesCollection().findOne({ slug });
    if (existing) return "conflict";

    const now = new Date();
    const enterprise = {
      _id: new ObjectId(),
      name,
      slug,
      owners: [userId],
      admins: [],
      createdAt: now,
      updatedAt: now,
    };
    await enterprisesCollection().insertOne(enterprise);

    return {
      id: enterprise._id.toHexString(),
      name: enterprise.name,
      slug: enterprise.slug,
      role: "owner",
      owners: enterprise.owners,
      admins: enterprise.admins,
    };
  }

  async setEnterpriseRole(
    requesterUserId: string,
    enterpriseId: string,
    targetUserId: string,
    role: "owner" | "admin"
  ): Promise<{ userId: string; role: "owner" | "admin" } | "not-found" | "forbidden"> {
    if (!isValidId(enterpriseId)) return "not-found";
    const enterprise = await enterprisesCollection().findOne({ _id: new ObjectId(enterpriseId) });
    if (!enterprise) return "not-found";
    if (!(enterprise.owners ?? []).includes(requesterUserId)) return "forbidden";

    const owners = new Set(enterprise.owners ?? []);
    const admins = new Set(enterprise.admins ?? []);

    owners.delete(targetUserId);
    admins.delete(targetUserId);
    if (role === "owner") owners.add(targetUserId);
    if (role === "admin") admins.add(targetUserId);

    await enterprisesCollection().updateOne(
      { _id: enterprise._id },
      {
        $set: {
          owners: Array.from(owners),
          admins: Array.from(admins),
          updatedAt: new Date(),
        },
      }
    );

    return { userId: targetUserId, role };
  }
}

export const enterpriseService = new EnterpriseService();
