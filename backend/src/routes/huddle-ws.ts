import type { FastifyInstance } from "fastify";
import { ObjectId } from "mongodb";
import { auth } from "../lib/auth.js";
import {
  teamsCollection,
  huddlePostsCollection,
  usersCollection,
  ticketsCollection,
} from "../models/index.js";
import { subscribeToTeam } from "../services/huddle.service.js";
import type { HuddlePost, PublicHuddlePost } from "../models/huddle-post.model.js";

function getUserInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '??'; // Defensive: never return empty string
  const parts = trimmed.split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return trimmed.substring(0, 2).toUpperCase();
}

async function toPublicHuddlePost(post: HuddlePost): Promise<PublicHuddlePost> {
  // Fetch user data
  const user = await usersCollection().findOne({ _id: new ObjectId(post.userId) });
  const userName = user?.name || "Unknown User";
  const userInitials = getUserInitials(userName);

  // Fetch ticket title if ticketId exists
  let ticketTitle: string | undefined;
  if (post.ticketId) {
    const ticket = await ticketsCollection().findOne({ _id: new ObjectId(post.ticketId) });
    ticketTitle = ticket?.title;
  }

  return {
    id: post._id.toHexString(),
    teamId: post.teamId,
    userId: post.userId,
    userName,
    userInitials,
    content: post.content,
    ticketId: post.ticketId,
    ticketTitle,
    attachments: post.attachments,
    likes: post.likes ?? [],
    commentCount: post.commentCount ?? 0,
    createdAt: post.createdAt.toISOString(),
    updatedAt: post.updatedAt.toISOString(),
  };
}

export async function huddleWsRoutes(app: FastifyInstance) {
  app.get("/huddle/ws", { websocket: true }, async (socket, req) => {
    const { token: queryToken, teamId: teamIdParam } = req.query as {
      token?: string;
      teamId?: string;
    };

    // Auth: accept Bearer token from query param (Capacitor) or cookie
    const headers: Record<string, string> = { ...(req.headers as any) };
    if (queryToken) headers["authorization"] = `Bearer ${queryToken}`;
    const session = await auth.api.getSession({ headers });
    if (!session?.user) {
      socket.close(4001, "Unauthorized");
      return;
    }

    if (!teamIdParam) {
      socket.close(4000, "teamId required");
      return;
    }

    // Validate the requester is a member or admin of the team
    let team;
    try {
      team = await teamsCollection().findOne({ _id: new ObjectId(teamIdParam) });
    } catch {
      socket.close(4003, "Invalid teamId");
      return;
    }

    if (!team) {
      socket.close(4003, "Team not found");
      return;
    }

    const userId = session.user.id;
    const isMember = team.members?.includes(userId) || team.admins?.includes(userId);

    if (!isMember) {
      socket.close(4003, "Forbidden");
      return;
    }

    // Send initial snapshot
    const posts = await huddlePostsCollection()
      .find({ teamId: teamIdParam })
      .sort({ createdAt: -1 })
      .toArray();
    const snapshot = await Promise.all(posts.map(toPublicHuddlePost));
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify({ type: "snapshot", teamId: teamIdParam, posts: snapshot }));
    }

    // Subscribe to future broadcasts for this team
    const unsubscribe = subscribeToTeam(teamIdParam, async (broadcastTeamId, post, action) => {
      if (socket.readyState === socket.OPEN) {
        if (action === "create") {
          const enrichedPost = await toPublicHuddlePost(post);
          socket.send(
            JSON.stringify({
              type: "create",
              teamId: broadcastTeamId,
              post: enrichedPost,
            })
          );
        } else if (action === "update") {
          const enrichedPost = await toPublicHuddlePost(post);
          socket.send(
            JSON.stringify({
              type: "update",
              teamId: broadcastTeamId,
              post: enrichedPost,
            })
          );
        } else if (action === "delete") {
          socket.send(
            JSON.stringify({
              type: "delete",
              teamId: broadcastTeamId,
              postId: post._id.toHexString(),
            })
          );
        }
      }
    });

    socket.on("close", () => {
      unsubscribe();
    });
  });
}
