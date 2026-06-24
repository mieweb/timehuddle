import type { FastifyInstance } from "fastify";
import { verifyWsToken } from "../lib/ws-auth.js";
import {
  teamService,
  subscribeToUser,
  subscribeToPendingRequests,
} from "../services/team.service.js";
import { teamJoinRequestService } from "../services/team-join-request.service.js";

export async function teamsWsRoutes(app: FastifyInstance) {
  app.get("/teams/ws", { websocket: true }, async (socket, req) => {
    const { token: queryToken } = req.query as {
      token?: string;
    };

    // Auth: accept Bearer token from query param (Capacitor) or cookie
    const rawToken = queryToken ?? req.headers["authorization"]?.replace(/^bearer /i, "");
    const wsUser = await verifyWsToken(rawToken);
    if (!wsUser) {
      socket.close(4001, "Unauthorized");
      return;
    }

    const userId = wsUser.id;

    // Send initial snapshot
    const teams = await teamService.getTeamsForUser(userId);
    const pendingRequests = await teamJoinRequestService.getPendingForUser(userId);
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify({ type: "snapshot", teams, pendingRequests }));
    }

    // Subscribe to future broadcasts for this user
    const unsubscribe = subscribeToUser(userId, (broadcastUserId, team, action) => {
      if (broadcastUserId !== userId) return;
      if (socket.readyState === socket.OPEN) {
        if (action === "update" && team) {
          socket.send(JSON.stringify({ type: "update", team }));
        } else if (action === "delete" && team) {
          socket.send(JSON.stringify({ type: "delete", teamId: team.id }));
        }
      }
    });

    // Subscribe to pending requests updates
    const unsubscribePendingRequests = subscribeToPendingRequests(
      userId,
      (broadcastUserId, pendingRequests) => {
        if (broadcastUserId !== userId) return;
        if (socket.readyState === socket.OPEN) {
          socket.send(JSON.stringify({ type: "pending-requests", pendingRequests }));
        }
      }
    );

    socket.on("close", () => {
      unsubscribe();
      unsubscribePendingRequests();
    });
  });
}
