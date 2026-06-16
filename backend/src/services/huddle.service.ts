import { subject } from "@casl/ability";
import { ObjectId } from "mongodb";
import {
  huddlePostsCollection,
  teamsCollection,
  ticketsCollection,
  usersCollection,
  orgMembersCollection,
  organizationsCollection,
  enterprisesCollection,
} from "../models/index.js";
import { buildAbilityFor } from "../lib/permissions.js";
import type { HuddlePost } from "../models/huddle-post.model.js";

type ServiceError = "not-found" | "forbidden" | "invalid-ticket" | "invalid-mentions";

function isValidId(id: string): boolean {
  return /^[0-9a-f]{24}$/i.test(id);
}

// ─── WebSocket Pub/Sub ────────────────────────────────────────────────────────

type HuddleListener = (teamId: string, post: HuddlePost, action: "create" | "delete") => void;
const huddleListeners = new Map<string, Set<HuddleListener>>();

/** Subscribe to huddle post updates for a specific team. Returns unsubscribe function. */
export function subscribeToTeam(teamId: string, fn: HuddleListener): () => void {
  if (!huddleListeners.has(teamId)) {
    huddleListeners.set(teamId, new Set());
  }
  huddleListeners.get(teamId)!.add(fn);
  return () => {
    const listeners = huddleListeners.get(teamId);
    if (listeners) {
      listeners.delete(fn);
      if (listeners.size === 0) huddleListeners.delete(teamId);
    }
  };
}

/** Broadcast a huddle post event to all subscribers of the team. */
function broadcast(teamId: string, post: HuddlePost, action: "create" | "delete") {
  const listeners = huddleListeners.get(teamId);
  if (!listeners) return;
  for (const fn of listeners) {
    fn(teamId, post, action);
  }
}

// ──────────────────────────────────────────────────────────────────────────────

export class HuddleService {
  private async resolveOrgRoleForTeam(
    userId: string,
    team: { orgId?: string }
  ): Promise<"owner" | "admin" | "member"> {
    if (!team.orgId || !isValidId(team.orgId)) return "member";
    const membership = await orgMembersCollection().findOne({ orgId: team.orgId, userId });
    if (membership?.role === "owner") return "owner";
    if (membership?.role === "admin") return "admin";
    return "member";
  }

  private async isEnterpriseElevatedForTeamOrg(
    userId: string,
    team: { orgId?: string }
  ): Promise<{ elevated: boolean; enterpriseId: string | null }> {
    if (!team.orgId || !isValidId(team.orgId)) {
      return { elevated: false, enterpriseId: null };
    }

    const org = await organizationsCollection().findOne({ _id: new ObjectId(team.orgId) });
    const enterpriseId = org?.enterpriseId ?? null;
    if (!enterpriseId || !isValidId(enterpriseId)) {
      return { elevated: false, enterpriseId: null };
    }

    const enterprise = await enterprisesCollection().findOne({ _id: new ObjectId(enterpriseId) });
    if (!enterprise) {
      return { elevated: false, enterpriseId };
    }

    const elevated =
      (enterprise.owners ?? []).includes(userId) || (enterprise.admins ?? []).includes(userId);
    return { elevated, enterpriseId };
  }

  private async buildTeamAbility(userId: string, teamId: string) {
    if (!isValidId(teamId)) return null;
    const team = await teamsCollection().findOne({ _id: new ObjectId(teamId) });
    if (!team) return null;

    const role = await this.resolveOrgRoleForTeam(userId, team);
    const enterpriseScope = await this.isEnterpriseElevatedForTeamOrg(userId, team);
    const isTeamMember =
      (team.members ?? []).includes(userId) || (team.admins ?? []).includes(userId);
    const isOrgElevated = role === "owner" || role === "admin";
    const scopedTeamIds = isTeamMember || isOrgElevated || enterpriseScope.elevated ? [teamId] : [];

    return {
      team,
      ability: buildAbilityFor({
        userId,
        role,
        teamIds: scopedTeamIds,
        orgIds: team.orgId ? [team.orgId] : [],
        enterpriseIds: enterpriseScope.enterpriseId ? [enterpriseScope.enterpriseId] : [],
        isEnterpriseElevated: enterpriseScope.elevated,
        teamAdminIds: (team.admins ?? []).includes(userId) ? [teamId] : [],
      }),
    };
  }

  /** Find all huddle posts for a team that the user has access to. */
  async findByTeam(teamId: string, userId: string): Promise<HuddlePost[] | ServiceError> {
    const context = await this.buildTeamAbility(userId, teamId);
    if (!context) return "forbidden";
    if (!context.ability.can("read", subject("Ticket", { teamId }))) return "forbidden";

    return huddlePostsCollection()
      .find({ teamId })
      .sort({ createdAt: -1 })
      .toArray();
  }

  /** Create a new huddle post. */
  async createPost(data: {
    teamId: string;
    userId: string;
    content: {
      text: string;
      mentions: string[];
    };
    ticketId?: string;
    attachments: Array<{
      mediaId: string;
      type: "image" | "video" | "file";
      url: string;
      thumbnailUrl?: string;
      filename?: string;
    }>;
  }): Promise<{ id: string } | ServiceError> {
    const context = await this.buildTeamAbility(data.userId, data.teamId);
    if (!context) return "forbidden";
    if (!context.ability.can("create", subject("Ticket", { teamId: data.teamId }))) {
      return "forbidden";
    }

    // Validate ticket exists if provided
    if (data.ticketId) {
      if (!isValidId(data.ticketId)) return "invalid-ticket";
      const ticket = await ticketsCollection().findOne({ _id: new ObjectId(data.ticketId) });
      if (!ticket || ticket.teamId !== data.teamId) return "invalid-ticket";
    }

    // Validate mentioned users exist
    if (data.content.mentions.length > 0) {
      const mentionedUsers = await usersCollection()
        .find({ _id: { $in: data.content.mentions.map((id) => new ObjectId(id)) } })
        .toArray();
      if (mentionedUsers.length !== data.content.mentions.length) {
        return "invalid-mentions";
      }
    }

    const now = new Date();
    const result = await huddlePostsCollection().insertOne({
      _id: new ObjectId(),
      teamId: data.teamId,
      userId: data.userId,
      content: data.content,
      ticketId: data.ticketId,
      attachments: data.attachments,
      createdAt: now,
      updatedAt: now,
    });

    const created = await huddlePostsCollection().findOne({ _id: result.insertedId });
    if (created) {
      broadcast(data.teamId, created, "create");
    }

    return { id: result.insertedId.toHexString() };
  }

  /** Delete a huddle post. Only the author or team admin can delete. */
  async deletePost(postId: string, userId: string): Promise<"ok" | ServiceError> {
    if (!isValidId(postId)) return "not-found";

    const post = await huddlePostsCollection().findOne({ _id: new ObjectId(postId) });
    if (!post) return "not-found";

    const context = await this.buildTeamAbility(userId, post.teamId);
    if (!context) return "forbidden";

    // Allow deletion if user is the author OR is a team admin
    const isAuthor = post.userId === userId;
    const isTeamAdmin = (context.team.admins ?? []).includes(userId);

    if (!isAuthor && !isTeamAdmin) return "forbidden";

    await huddlePostsCollection().deleteOne({ _id: new ObjectId(postId) });
    broadcast(post.teamId, post, "delete");

    return "ok";
  }
}

export const huddleService = new HuddleService();
