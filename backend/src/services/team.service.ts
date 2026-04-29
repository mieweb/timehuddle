import { ObjectId } from "mongodb";
import { getDB } from "../lib/db.js";
import { teamsCollection, usersCollection } from "../models/index.js";
import type { Team } from "../models/team.model.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateTeamCode(): string {
  return Math.random().toString(36).substring(2, 10).toUpperCase();
}

export function toPublicTeam(team: Team & { _id: ObjectId }) {
  return {
    id: team._id.toString(),
    name: team.name,
    description: team.description ?? null,
    members: team.members,
    admins: team.admins,
    code: team.code,
    isPersonal: team.isPersonal ?? false,
    createdAt: team.createdAt.toISOString(),
    updatedAt: team.updatedAt?.toISOString() ?? null,
  };
}

export type PublicTeam = ReturnType<typeof toPublicTeam>;
export type TeamMember = { id: string; name: string; email: string };

// Discriminated error types
export type TeamError =
  | "not-found"
  | "forbidden"
  | "already-member"
  | "not-member"
  | "last-admin"
  | "user-not-found"
  | "cannot-remove-self";

// ─── Service ─────────────────────────────────────────────────────────────────

export class TeamService {
  /** Return all teams the user belongs to, sorted personal-first then by name. */
  async getTeamsForUser(userId: string): Promise<PublicTeam[]> {
    const teams = await teamsCollection().find({ members: userId }).toArray();
    return teams.map(toPublicTeam).sort((a, b) => {
      if (a.isPersonal !== b.isPersonal) return a.isPersonal ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  /** Create a personal workspace if one doesn't exist; return it either way. */
  async ensurePersonalWorkspace(userId: string): Promise<PublicTeam> {
    const existing = await teamsCollection().findOne({ isPersonal: true, members: userId });
    if (existing) return toPublicTeam(existing);

    const code = generateTeamCode();
    const doc: Team & { _id: ObjectId } = {
      _id: new ObjectId(),
      name: "Personal",
      members: [userId],
      admins: [userId],
      code,
      isPersonal: true,
      createdAt: new Date(),
    };
    await teamsCollection().insertOne(doc);
    return toPublicTeam(doc);
  }

  /** Create a new named team with the caller as sole member + admin. */
  async createTeam(
    userId: string,
    data: { name: string; description?: string }
  ): Promise<PublicTeam> {
    const code = generateTeamCode();
    const doc: Team & { _id: ObjectId } = {
      _id: new ObjectId(),
      name: data.name,
      description: data.description,
      members: [userId],
      admins: [userId],
      code,
      isPersonal: false,
      createdAt: new Date(),
    };
    await teamsCollection().insertOne(doc);
    return toPublicTeam(doc);
  }

  /** Join an existing team by code. */
  async joinByCode(
    userId: string,
    teamCode: string
  ): Promise<PublicTeam | "not-found" | "already-member"> {
    const team = await teamsCollection().findOne({ code: teamCode.toUpperCase() });
    if (!team) return "not-found";
    if (team.members.includes(userId)) return "already-member";
    await teamsCollection().updateOne(
      { _id: team._id },
      { $addToSet: { members: userId }, $set: { updatedAt: new Date() } }
    );
    const updated = await teamsCollection().findOne({ _id: team._id });
    return toPublicTeam(updated!);
  }

  /** Rename a team (admin only). */
  async renameTeam(
    teamId: string,
    adminId: string,
    newName: string
  ): Promise<PublicTeam | "not-found" | "forbidden"> {
    const team = await teamsCollection().findOne({ _id: new ObjectId(teamId) });
    if (!team) return "not-found";
    if (!team.admins.includes(adminId)) return "forbidden";
    await teamsCollection().updateOne(
      { _id: team._id },
      { $set: { name: newName, updatedAt: new Date() } }
    );
    const updated = await teamsCollection().findOne({ _id: team._id });
    return toPublicTeam(updated!);
  }

  /** Delete a team (admin only). */
  async deleteTeam(teamId: string, adminId: string): Promise<"ok" | "not-found" | "forbidden"> {
    const team = await teamsCollection().findOne({ _id: new ObjectId(teamId) });
    if (!team) return "not-found";
    if (!team.admins.includes(adminId)) return "forbidden";
    await teamsCollection().deleteOne({ _id: team._id });
    return "ok";
  }

  /** Return member list with resolved name + email. */
  async getMembers(teamId: string, userId: string): Promise<TeamMember[] | "not-found"> {
    const team = await teamsCollection().findOne({ _id: new ObjectId(teamId), members: userId });
    if (!team) return "not-found";

    const allIds = Array.from(new Set([...team.members, ...team.admins]));
    const objectIds = allIds.map((id) => new ObjectId(id));
    const users = await usersCollection()
      .find({ _id: { $in: objectIds } })
      .toArray();
    const byId = new Map(users.map((u) => [u._id.toString(), u]));

    return allIds.map((id) => {
      const u = byId.get(id);
      return { id, name: u?.name ?? id, email: u?.email ?? "" };
    });
  }

  /** Invite a user by email — adds them directly to the team (Phase 8 will add notifications). */
  async inviteMember(
    teamId: string,
    inviterId: string,
    email: string
  ): Promise<"ok" | "not-found" | "forbidden" | "user-not-found" | "already-member"> {
    const team = await teamsCollection().findOne({ _id: new ObjectId(teamId), members: inviterId });
    if (!team) return "not-found";

    const invitedUser = await usersCollection().findOne({ email });
    if (!invitedUser) return "user-not-found";
    const invitedId = invitedUser._id.toString();
    if (team.members.includes(invitedId)) return "already-member";

    await teamsCollection().updateOne(
      { _id: team._id },
      { $addToSet: { members: invitedId }, $set: { updatedAt: new Date() } }
    );
    return "ok";
  }

  /** Remove a member from a team (admin only). */
  async removeMember(
    teamId: string,
    adminId: string,
    targetUserId: string
  ): Promise<
    "ok" | "not-found" | "forbidden" | "not-member" | "last-admin" | "cannot-remove-self"
  > {
    const team = await teamsCollection().findOne({ _id: new ObjectId(teamId) });
    if (!team) return "not-found";
    if (!team.admins.includes(adminId)) return "forbidden";
    if (targetUserId === adminId) return "cannot-remove-self";
    if (!team.members.includes(targetUserId)) return "not-member";
    const remainingAdmins = team.admins.filter((id) => id !== targetUserId);
    if (team.admins.includes(targetUserId) && remainingAdmins.length === 0) return "last-admin";

    await teamsCollection().updateOne(
      { _id: team._id },
      {
        $pull: { members: targetUserId, admins: targetUserId } as any,
        $set: { updatedAt: new Date() },
      }
    );
    return "ok";
  }

  /** Promote or demote a member's admin status (admin only). */
  async setMemberRole(
    teamId: string,
    adminId: string,
    targetUserId: string,
    role: "admin" | "member"
  ): Promise<"ok" | "not-found" | "forbidden" | "not-member" | "last-admin"> {
    const team = await teamsCollection().findOne({ _id: new ObjectId(teamId) });
    if (!team) return "not-found";
    if (!team.admins.includes(adminId)) return "forbidden";
    if (!team.members.includes(targetUserId)) return "not-member";

    if (role === "admin") {
      await teamsCollection().updateOne(
        { _id: team._id },
        { $addToSet: { admins: targetUserId }, $set: { updatedAt: new Date() } }
      );
    } else {
      const remaining = team.admins.filter((id) => id !== targetUserId);
      if (remaining.length === 0) return "last-admin";
      await teamsCollection().updateOne(
        { _id: team._id },
        { $set: { admins: remaining, updatedAt: new Date() } }
      );
    }
    return "ok";
  }

  /**
   * Admin-forced password change for a team member.
   * better-auth stores credentials in the `account` collection as { userId, providerId: "credential", password }.
   */
  async setMemberPassword(
    teamId: string,
    adminId: string,
    targetUserId: string,
    newPassword: string
  ): Promise<"ok" | "not-found" | "forbidden" | "not-member"> {
    const team = await teamsCollection().findOne({ _id: new ObjectId(teamId) });
    if (!team) return "not-found";
    if (!team.admins.includes(adminId)) return "forbidden";
    if (!team.members.includes(targetUserId)) return "not-member";

    // better-auth hashes passwords with bcrypt (default rounds = 10)
    const bcrypt = await import("bcrypt");
    const hashed = await bcrypt.hash(newPassword, 10);

    const result = await getDB()
      .collection("account")
      .updateOne(
        { userId: targetUserId, providerId: "credential" },
        { $set: { password: hashed } }
      );
    if (result.matchedCount === 0) return "not-found";
    return "ok";
  }
}

export const teamService = new TeamService();
