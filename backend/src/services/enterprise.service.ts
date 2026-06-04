import { ObjectId } from "mongodb";
import { enterprisesCollection, usersCollection } from "../models/index.js";
import { slugify } from "../lib/slug.js";

export type EnterpriseSummary = {
  id: string;
  name: string;
  slug: string;
  role: "owner" | "admin";
};

export type EnterpriseMember = {
  id: string;
  name: string;
  username: string | null;
  role: "owner" | "admin";
};

export type EnterpriseDetail = EnterpriseSummary & {
  owners: string[];
  admins: string[];
  members: EnterpriseMember[];
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

    const allMemberIds = [...new Set([...owners, ...admins])];
    const userDocs = allMemberIds.length
      ? await usersCollection()
          .find({ _id: { $in: allMemberIds.map((id) => new ObjectId(id)) } })
          .project<{ _id: ObjectId; name: string; username?: string | null }>({
            _id: 1,
            name: 1,
            username: 1,
          })
          .toArray()
      : [];
    const userMap = new Map(userDocs.map((u) => [u._id.toHexString(), u]));

    const members: EnterpriseMember[] = allMemberIds.map((id) => {
      const user = userMap.get(id);
      return {
        id,
        name: user?.name ?? id,
        username: user?.username ?? null,
        role: owners.includes(id) ? "owner" : "admin",
      };
    });

    return {
      id: enterprise._id.toHexString(),
      name: enterprise.name,
      slug: enterprise.slug,
      role,
      owners,
      admins,
      members,
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
      members: [{ id: userId, name: userId, username: null, role: "owner" }],
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

  async searchUsers(
    requesterUserId: string,
    enterpriseId: string,
    query: string
  ): Promise<Array<{ id: string; name: string; username: string | null }> | "not-found" | "forbidden"> {
    if (!isValidId(enterpriseId)) return "not-found";
    const enterprise = await enterprisesCollection().findOne({ _id: new ObjectId(enterpriseId) });
    if (!enterprise) return "not-found";
    const owners = enterprise.owners ?? [];
    const admins = enterprise.admins ?? [];
    if (!owners.includes(requesterUserId) && !admins.includes(requesterUserId)) return "forbidden";

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
      .project<{ _id: ObjectId; name: string; username?: string | null }>({ _id: 1, name: 1, username: 1 })
      .sort({ name: 1 })
      .limit(20)
      .toArray();

    return users.map((u) => ({
      id: u._id.toHexString(),
      name: u.name,
      username: u.username ?? null,
    }));
  }

  async removeMember(
    requesterUserId: string,
    enterpriseId: string,
    targetUserId: string
  ): Promise<{ userId: string } | "not-found" | "forbidden" | "last-owner"> {
    if (!isValidId(enterpriseId)) return "not-found";

    const enterprise = await enterprisesCollection().findOne({ _id: new ObjectId(enterpriseId) });
    if (!enterprise) return "not-found";
    if (!(enterprise.owners ?? []).includes(requesterUserId)) return "forbidden";

    const owners = new Set(enterprise.owners ?? []);
    const admins = new Set(enterprise.admins ?? []);

    // Prevent removing the last owner
    if (owners.has(targetUserId) && owners.size === 1 && admins.size === 0) return "last-owner";

    owners.delete(targetUserId);
    admins.delete(targetUserId);

    await enterprisesCollection().updateOne(
      { _id: enterprise._id },
      { $set: { owners: Array.from(owners), admins: Array.from(admins), updatedAt: new Date() } }
    );

    return { userId: targetUserId };
  }

  async updateEnterpriseName(
    requesterUserId: string,
    enterpriseId: string,
    input: { name: string }
  ): Promise<EnterpriseDetail | "not-found" | "forbidden"> {
    if (!isValidId(enterpriseId)) return "not-found";

    const enterprise = await enterprisesCollection().findOne({ _id: new ObjectId(enterpriseId) });
    if (!enterprise) return "not-found";

    const owners = enterprise.owners ?? [];
    const admins = enterprise.admins ?? [];
    const role = owners.includes(requesterUserId) ? "owner" : admins.includes(requesterUserId) ? "admin" : null;
    if (!role) return "forbidden";

    const name = input.name.trim();

    await enterprisesCollection().updateOne(
      { _id: enterprise._id },
      {
        $set: {
          name,
          updatedAt: new Date(),
        },
      }
    );

    const allMemberIds = [...new Set([...owners, ...admins])];
    const userDocs = allMemberIds.length
      ? await usersCollection()
          .find({ _id: { $in: allMemberIds.map((id) => new ObjectId(id)) } })
          .project<{ _id: ObjectId; name: string; username?: string | null }>({ _id: 1, name: 1, username: 1 })
          .toArray()
      : [];
    const userMap = new Map(userDocs.map((u) => [u._id.toHexString(), u]));
    const members: EnterpriseMember[] = allMemberIds.map((id) => {
      const user = userMap.get(id);
      return { id, name: user?.name ?? id, username: user?.username ?? null, role: owners.includes(id) ? "owner" : "admin" };
    });

    return {
      id: enterprise._id.toHexString(),
      name,
      slug: enterprise.slug,
      role,
      owners,
      admins,
      members,
    };
  }
}

export const enterpriseService = new EnterpriseService();
