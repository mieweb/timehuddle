import type { FastifyInstance } from "fastify";
import { ObjectId } from "mongodb";
import { auth } from "../lib/auth.js";
import { teamsCollection, huddlePostsCollection } from "../models/index.js";
import { subscribeToTeam } from "../services/huddle.service.js";
import type { HuddlePost } from "../models/huddle-post.model.js";

function toPublicHuddlePost(post: HuddlePost) {
  return {
    id: post._id.toHexString(),
    teamId: post.teamId,
    userId: post.userId,
    content: post.content,
    ticketId: post.ticketId,
    attachments: post.attachments,
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
    const snapshot = posts.map(toPublicHuddlePost);
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify({ type: "snapshot", teamId: teamIdParam, posts: snapshot }));
    }

    // Subscribe to future broadcasts for this team
    const unsubscribe = subscribeToTeam(teamIdParam, (broadcastTeamId, post, action) => {
      if (socket.readyState === socket.OPEN) {
        if (action === "create") {
          socket.send(
            JSON.stringify({
              type: "create",
              teamId: broadcastTeamId,
              post: toPublicHuddlePost(post),
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
