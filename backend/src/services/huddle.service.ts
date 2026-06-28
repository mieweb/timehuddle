import { subject } from "@casl/ability";
import { ObjectId } from "mongodb";
import {
  huddlePostsCollection,
  huddleCommentsCollection,
  teamsCollection,
  ticketsCollection,
  usersCollection,
  orgMembersCollection,
  organizationsCollection,
  enterprisesCollection,
  profilesCollection,
} from "../models/index.js";
import { buildAbilityFor } from "../lib/permissions.js";
import type { HuddlePost } from "../models/huddle-post.model.js";
import type { HuddleComment, PublicHuddleComment } from "../models/huddle-comment.model.js";
import { notificationService } from "./notification.service.js";

type ServiceError = "not-found" | "forbidden" | "invalid-ticket" | "invalid-mentions";

function isValidId(id: string): boolean {
  return /^[0-9a-f]{24}$/i.test(id);
}

// ─── WebSocket Pub/Sub ────────────────────────────────────────────────────────

type HuddleListener = (
  teamId: string,
  post: HuddlePost,
  action: "create" | "update" | "delete"
) => void | Promise<void>;
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
function broadcast(teamId: string, post: HuddlePost, action: "create" | "update" | "delete") {
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

    return huddlePostsCollection().find({ teamId }).sort({ createdAt: -1 }).toArray();
  }

  /** Find all huddle posts for a specific ticket. */
  async findByTicket(ticketId: string, userId: string): Promise<HuddlePost[] | ServiceError> {
    if (!isValidId(ticketId)) return "not-found";

    // First, verify the ticket exists and get its teamId
    const ticket = await ticketsCollection().findOne({ _id: new ObjectId(ticketId) });
    if (!ticket) return "not-found";

    // Check permissions via team
    const context = await this.buildTeamAbility(userId, ticket.teamId);
    if (!context) return "forbidden";
    if (!context.ability.can("read", subject("Ticket", { teamId: ticket.teamId }))) {
      return "forbidden";
    }

    return huddlePostsCollection()
      .find({ ticketId, teamId: ticket.teamId })
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

  /** Update a huddle post. Only the author, team admin, or org owner can update. */
  async updatePost(
    postId: string,
    userId: string,
    newContent: { text: string; mentions: string[] }
  ): Promise<{ post: HuddlePost } | ServiceError> {
    if (!isValidId(postId)) return "not-found";

    const post = await huddlePostsCollection().findOne({ _id: new ObjectId(postId) });
    if (!post) return "not-found";

    const context = await this.buildTeamAbility(userId, post.teamId);
    if (!context) return "forbidden";

    // Allow update if user is the author, team admin, or org owner
    const isAuthor = post.userId === userId;
    const isTeamAdmin = (context.team.admins ?? []).includes(userId);
    const orgRole = await this.resolveOrgRoleForTeam(userId, context.team);
    const isOrgOwner = orgRole === "owner";

    if (!isAuthor && !isTeamAdmin && !isOrgOwner) return "forbidden";

    // Validate mentioned users exist
    if (newContent.mentions.length > 0) {
      const mentionedUsers = await usersCollection()
        .find({ _id: { $in: newContent.mentions.map((id) => new ObjectId(id)) } })
        .toArray();
      if (mentionedUsers.length !== newContent.mentions.length) {
        return "invalid-mentions";
      }
    }

    const now = new Date();
    await huddlePostsCollection().updateOne(
      { _id: new ObjectId(postId) },
      {
        $set: {
          content: newContent,
          updatedAt: now,
        },
      }
    );

    const updated = await huddlePostsCollection().findOne({ _id: new ObjectId(postId) });
    if (!updated) return "not-found";

    // Broadcast update (reusing 'create' action for simplicity - clients will replace by ID)
    broadcast(post.teamId, updated, "create");

    return { post: updated };
  }

  /** Delete a huddle post. Only the author, team admin, or org owner can delete. */
  async deletePost(postId: string, userId: string): Promise<"ok" | ServiceError> {
    if (!isValidId(postId)) return "not-found";

    const post = await huddlePostsCollection().findOne({ _id: new ObjectId(postId) });
    if (!post) return "not-found";

    const context = await this.buildTeamAbility(userId, post.teamId);
    if (!context) return "forbidden";

    // Allow deletion if user is the author, team admin, or org owner
    const isAuthor = post.userId === userId;
    const isTeamAdmin = (context.team.admins ?? []).includes(userId);
    const orgRole = await this.resolveOrgRoleForTeam(userId, context.team);
    const isOrgOwner = orgRole === "owner";

    if (!isAuthor && !isTeamAdmin && !isOrgOwner) return "forbidden";

    await huddlePostsCollection().deleteOne({ _id: new ObjectId(postId) });
    broadcast(post.teamId, post, "delete");

    return "ok";
  }

  /** Toggle like on a huddle post. Returns the updated like count. */
  async toggleLike(postId: string, userId: string): Promise<{ count: number } | ServiceError> {
    if (!isValidId(postId)) return "not-found";

    const post = await huddlePostsCollection().findOne({ _id: new ObjectId(postId) });
    if (!post) return "not-found";

    const context = await this.buildTeamAbility(userId, post.teamId);
    if (!context) return "forbidden";
    if (!context.ability.can("read", subject("Ticket", { teamId: post.teamId }))) {
      return "forbidden";
    }

    const likes = post.likes ?? [];
    const hasLiked = likes.includes(userId);

    let updatedLikes: string[];
    if (hasLiked) {
      // Remove like
      updatedLikes = likes.filter((id) => id !== userId);
    } else {
      // Add like
      updatedLikes = [...likes, userId];
    }

    await huddlePostsCollection().updateOne(
      { _id: new ObjectId(postId) },
      { $set: { likes: updatedLikes } }
    );

    // Broadcast update to WebSocket clients
    const updatedPost = await huddlePostsCollection().findOne({ _id: new ObjectId(postId) });
    if (updatedPost) {
      broadcast(post.teamId, updatedPost, "update");
    }

    return { count: updatedLikes.length };
  }

  /** Add a comment to a huddle post. */
  async addComment(data: {
    postId: string;
    userId: string;
    content: string;
    mentions: string[];
  }): Promise<{ id: string } | ServiceError> {
    if (!isValidId(data.postId)) return "not-found";

    const post = await huddlePostsCollection().findOne({ _id: new ObjectId(data.postId) });
    if (!post) return "not-found";

    const context = await this.buildTeamAbility(data.userId, post.teamId);
    if (!context) return "forbidden";
    if (!context.ability.can("read", subject("Ticket", { teamId: post.teamId }))) {
      return "forbidden";
    }

    // Validate mentioned users exist
    if (data.mentions.length > 0) {
      const mentionedUsers = await usersCollection()
        .find({ _id: { $in: data.mentions.map((id) => new ObjectId(id)) } })
        .toArray();
      if (mentionedUsers.length !== data.mentions.length) {
        return "invalid-mentions";
      }
    }

    const now = new Date();
    const comment: HuddleComment = {
      _id: new ObjectId(),
      postId: data.postId,
      userId: data.userId,
      content: data.content,
      mentions: data.mentions,
      createdAt: now,
      updatedAt: now,
    };

    await huddleCommentsCollection().insertOne(comment);

    // Increment comment count on post
    await huddlePostsCollection().updateOne(
      { _id: new ObjectId(data.postId) },
      { $inc: { commentCount: 1 } }
    );

    // Broadcast update to WebSocket clients
    const updatedPost = await huddlePostsCollection().findOne({ _id: new ObjectId(data.postId) });
    if (updatedPost) {
      broadcast(post.teamId, updatedPost, "update");
    }

    // Send notifications
    const commenter = await usersCollection().findOne({ _id: new ObjectId(data.userId) });
    const commenterName = commenter?.name || "Someone";

    // Notify post author (if not the commenter)
    if (post.userId !== data.userId) {
      await notificationService.create({
        userId: post.userId,
        title: `${commenterName} commented on your post`,
        body: data.content.length > 100 ? data.content.substring(0, 97) + "..." : data.content,
        notificationData: {
          type: "huddle-comment",
          postId: data.postId,
          commentId: comment._id.toHexString(),
          teamId: post.teamId,
          url: "/app/huddle",
        },
      });
    }

    // Notify mentioned users (if any)
    for (const mentionedUserId of data.mentions) {
      // Skip if mentioned user is the commenter or post author (already notified)
      if (mentionedUserId === data.userId || mentionedUserId === post.userId) continue;

      await notificationService.create({
        userId: mentionedUserId,
        title: `${commenterName} mentioned you in a comment`,
        body: data.content.length > 100 ? data.content.substring(0, 97) + "..." : data.content,
        notificationData: {
          type: "huddle-mention",
          postId: data.postId,
          commentId: comment._id.toHexString(),
          teamId: post.teamId,
          url: "/app/huddle",
        },
      });
    }

    return { id: comment._id.toHexString() };
  }

  /** Get comments for a huddle post. */
  async getComments(postId: string, userId: string): Promise<PublicHuddleComment[] | ServiceError> {
    if (!isValidId(postId)) return "not-found";

    const post = await huddlePostsCollection().findOne({ _id: new ObjectId(postId) });
    if (!post) return "not-found";

    const context = await this.buildTeamAbility(userId, post.teamId);
    if (!context) return "forbidden";
    if (!context.ability.can("read", subject("Ticket", { teamId: post.teamId }))) {
      return "forbidden";
    }

    const comments = await huddleCommentsCollection()
      .find({ postId })
      .sort({ createdAt: 1 })
      .toArray();

    // Enrich with user data
    const publicComments: PublicHuddleComment[] = await Promise.all(
      comments.map(async (comment) => {
        const user = await usersCollection().findOne({ _id: new ObjectId(comment.userId) });
        const userName = user?.name || "Unknown User";
        const userInitials = this.getUserInitials(userName);

        // Try to get avatar from profile
        const profile = await profilesCollection().findOne({ userId: comment.userId });
        const userAvatarUrl = profile?.avatarUrl ?? user?.image ?? undefined;

        return {
          id: comment._id.toHexString(),
          postId: comment.postId,
          userId: comment.userId,
          userName,
          userInitials,
          userAvatarUrl,
          content: comment.content,
          mentions: comment.mentions,
          createdAt: comment.createdAt.toISOString(),
          updatedAt: comment.updatedAt.toISOString(),
        };
      })
    );

    return publicComments;
  }

  /** Delete a comment. Only the author, team admin, or org owner can delete. */
  async deleteComment(commentId: string, userId: string): Promise<"ok" | ServiceError> {
    if (!isValidId(commentId)) return "not-found";

    const comment = await huddleCommentsCollection().findOne({ _id: new ObjectId(commentId) });
    if (!comment) return "not-found";

    const post = await huddlePostsCollection().findOne({ _id: new ObjectId(comment.postId) });
    if (!post) return "not-found";

    const context = await this.buildTeamAbility(userId, post.teamId);
    if (!context) return "forbidden";

    // Allow deletion if user is the author, team admin, or org owner
    const isAuthor = comment.userId === userId;
    const isTeamAdmin = (context.team.admins ?? []).includes(userId);
    const orgRole = await this.resolveOrgRoleForTeam(userId, context.team);
    const isOrgOwner = orgRole === "owner";

    if (!isAuthor && !isTeamAdmin && !isOrgOwner) return "forbidden";

    await huddleCommentsCollection().deleteOne({ _id: new ObjectId(commentId) });

    // Decrement comment count on post
    await huddlePostsCollection().updateOne(
      { _id: new ObjectId(comment.postId) },
      { $inc: { commentCount: -1 } }
    );

    // Broadcast update to WebSocket clients
    const updatedPost = await huddlePostsCollection().findOne({
      _id: new ObjectId(comment.postId),
    });
    if (updatedPost) {
      broadcast(post.teamId, updatedPost, "update");
    }

    return "ok";
  }

  private getUserInitials(name: string): string {
    const trimmed = name.trim();
    if (!trimmed) return "??";
    const parts = trimmed.split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return trimmed.substring(0, 2).toUpperCase();
  }
}

export const huddleService = new HuddleService();
