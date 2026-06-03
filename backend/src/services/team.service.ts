import { ObjectId } from "mongodb";
import { getDB } from "../lib/db.js";
import { organizationsCollection, teamsCollection, usersCollection } from "../models/index.js";
import type { Team } from "../models/team.model.js";
import { channelService } from "./channel.service.js";
import { orgService } from "./org.service.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateTeamCode(): string {
  return Math.random().toString(36).substring(2, 10).toUpperCase();
}

export function toPublicTeam(team: Team & { _id: ObjectId }) {
  return {
    id: team._id.toString(),
    orgId: team.orgId,
    parentTeamId: team.parentTeamId ?? null,
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
export type TeamMember = {
  id: string;
  name: string;
  email: string;
  username: string | null;
  image: string | null;
};

// Discriminated error types
export type TeamError =
  | "not-found"
  | "forbidden"
  | "already-member"
  | "not-member"
  | "last-admin"
  | "user-not-found"
  | "cannot-remove-self";

// ─── WebSocket Pub/Sub ────────────────────────────────────────────────────────

type TeamListener = (userId: string, team: PublicTeam | null, action: "update" | "delete") => void;
// Map by userId → Set of listeners (each user subscribes to their own teams)
const teamListeners = new Map<string, Set<TeamListener>>();

/** Subscribe to team updates for a specific user. Returns unsubscribe function. */
export function subscribeToUser(userId: string, fn: TeamListener): () => void {
  if (!teamListeners.has(userId)) {
    teamListeners.set(userId, new Set());
  }
  teamListeners.get(userId)!.add(fn);
  return () => {
    const listeners = teamListeners.get(userId);
    if (listeners) {
      listeners.delete(fn);
      if (listeners.size === 0) teamListeners.delete(userId);
    }
  };
}

/** Broadcast a team update to all members of the team. */
function broadcastToTeamMembers(
  team: (Team & { _id: ObjectId }) | null,
  action: "update" | "delete"
) {
  if (!team) return;
  const publicTeam = action === "update" ? toPublicTeam(team) : null;
  const allMembers = Array.from(new Set([...team.members, ...team.admins]));

  for (const userId of allMembers) {
    const listeners = teamListeners.get(userId);
    if (!listeners) continue;
    for (const fn of listeners) {
      fn(userId, publicTeam, action);
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────────

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

    const defaultOrg = await orgService.ensureDefaultOrganization();
    const code = generateTeamCode();
    const doc: Team & { _id: ObjectId } = {
      _id: new ObjectId(),
      orgId: defaultOrg._id.toHexString(),
      parentTeamId: null,
      name: "Personal",
      members: [userId],
      admins: [userId],
      code,
      isPersonal: true,
      createdAt: new Date(),
    };
    await teamsCollection().insertOne(doc);
    channelService.ensureDefaultChannel(doc._id.toHexString(), userId).catch(() => {});
    const created = toPublicTeam(doc);
    broadcastToTeamMembers(doc, "update");
    return created;
  }

  /** Create a new named team with the caller as sole member + admin. */
  async createTeam(
    userId: string,
    data: { name: string; description?: string; orgId?: string; parentTeamId?: string | null }
  ): Promise<PublicTeam> {
    const requestedOrgId = data.orgId;
    const accessibleOrgIds = await orgService.getAccessibleOrgIds(userId);
    let orgId = requestedOrgId ?? accessibleOrgIds[0] ?? null;

    if (!orgId) {
      const defaultOrg = await orgService.ensureDefaultOrganization();
      await orgService.addOrgMember(defaultOrg._id.toHexString(), userId, "member", true);
      orgId = defaultOrg._id.toHexString();
    }

    if (!accessibleOrgIds.includes(orgId)) {
      const requestedMembership = await orgService.getOrgMembership(orgId, userId);
      if (!requestedMembership) {
        const joinAttempt = await orgService.joinOrg(userId, orgId);
        if (joinAttempt === "not-found" || joinAttempt === "auto-join-disabled") {
          const fallbackOrg = await orgService.ensureDefaultOrganization();
          await orgService.addOrgMember(fallbackOrg._id.toHexString(), userId, "member", true);
          orgId = fallbackOrg._id.toHexString();
        }
      }
    }

    const code = generateTeamCode();
    const parentTeamId = data.parentTeamId ?? null;

    if (parentTeamId) {
      const parent = await teamsCollection().findOne({ _id: new ObjectId(parentTeamId) });
      if (!parent || parent.orgId !== orgId) {
        throw new Error("Parent team must exist in the same organization");
      }
    }

    const doc: Team & { _id: ObjectId } = {
      _id: new ObjectId(),
      orgId,
      parentTeamId,
      name: data.name,
      description: data.description,
      members: [userId],
      admins: [userId],
      code,
      isPersonal: false,
      createdAt: new Date(),
    };
    await teamsCollection().insertOne(doc);
    await orgService.addOrgMember(orgId, userId, "member", true);
    channelService.ensureDefaultChannel(doc._id.toHexString(), userId).catch(() => {});
    const created = toPublicTeam(doc);
    broadcastToTeamMembers(doc, "update");
    return created;
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
    const org = team.orgId && /^[0-9a-f]{24}$/i.test(team.orgId)
      ? await organizationsCollection().findOne({ _id: new ObjectId(team.orgId) })
      : null;
    if (org?.allowAutoJoin !== false) {
      await orgService.addOrgMember(team.orgId, userId, "member", true);
    }
    const updated = await teamsCollection().findOne({ _id: team._id });
    broadcastToTeamMembers(updated!, "update");
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
    broadcastToTeamMembers(updated!, "update");
    return toPublicTeam(updated!);
  }

  /** Delete a team (admin only). */
  async deleteTeam(teamId: string, adminId: string): Promise<"ok" | "not-found" | "forbidden"> {
    const team = await teamsCollection().findOne({ _id: new ObjectId(teamId) });
    if (!team) return "not-found";
    if (!team.admins.includes(adminId)) return "forbidden";
    broadcastToTeamMembers(team, "delete");
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
      return {
        id,
        name: u?.name ?? id,
        email: u?.email ?? "",
        username: u?.username ?? null,
        image: u?.image ?? null,
      };
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
    const org = team.orgId && /^[0-9a-f]{24}$/i.test(team.orgId)
      ? await organizationsCollection().findOne({ _id: new ObjectId(team.orgId) })
      : null;
    if (org?.allowAutoJoin !== false) {
      await orgService.addOrgMember(team.orgId, invitedId, "member", true);
    }
    const updated = await teamsCollection().findOne({ _id: team._id });
    broadcastToTeamMembers(updated!, "update");
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
    const updated = await teamsCollection().findOne({ _id: team._id });
    broadcastToTeamMembers(updated!, "update");
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
    const updated = await teamsCollection().findOne({ _id: team._id });
    broadcastToTeamMembers(updated!, "update");
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

  async getSubTeams(
    teamId: string,
    userId: string
  ): Promise<PublicTeam[] | "not-found" | "forbidden"> {
    if (!/^[0-9a-f]{24}$/i.test(teamId)) return "not-found";
    const parent = await teamsCollection().findOne({ _id: new ObjectId(teamId) });
    if (!parent) return "not-found";
    if (!parent.members.includes(userId) && !parent.admins.includes(userId)) return "forbidden";

    const subTeams = await teamsCollection()
      .find({ parentTeamId: teamId, orgId: parent.orgId })
      .sort({ name: 1 })
      .toArray();

    return subTeams.map(toPublicTeam);
  }
}

export const teamService = new TeamService();
