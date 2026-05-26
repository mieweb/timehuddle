import type { FastifyInstance } from "fastify";
import { ObjectId } from "mongodb";
import { auth } from "../lib/auth.js";
import { teamsCollection, ticketsCollection } from "../models/index.js";
import { subscribeToTeam } from "../services/ticket.service.js";
import type { Ticket } from "../models/ticket.model.js";

function toPublicTicket(t: Ticket) {
  return {
    id: t._id.toHexString(),
    teamId: t.teamId,
    title: t.title,
    description: t.description ?? null,
    github: t.github,
    status: t.status,
    priority: t.priority ?? null,
    createdBy: t.createdBy,
    assignedTo: t.assignedTo,
    reviewedBy: t.reviewedBy ?? null,
    reviewedAt: t.reviewedAt?.toISOString() ?? null,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt?.toISOString() ?? null,
    sharedWithTimeharbor: t.sharedWithTimeharbor ?? false,
    externalTrackedMs: t.externalTrackedMs ?? 0,
  };
}

export async function ticketsWsRoutes(app: FastifyInstance) {
  app.get("/tickets/ws", { websocket: true }, async (socket, req) => {
    const { token: queryToken, teamIds: teamIdsParam } = req.query as {
      token?: string;
      teamIds?: string;
    };

    // Auth: accept Bearer token from query param (Capacitor) or cookie
    const headers: Record<string, string> = { ...(req.headers as any) };
    if (queryToken) headers["authorization"] = `Bearer ${queryToken}`;
    const session = await auth.api.getSession({ headers });
    if (!session?.user) {
      socket.close(4001, "Unauthorized");
      return;
    }

    if (!teamIdsParam) {
      socket.close(4000, "teamIds required");
      return;
    }
    const requestedIds = teamIdsParam
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    // Validate the requester is a member or admin of every requested team
    const objectIds = requestedIds.flatMap((id) => {
      try {
        return [new ObjectId(id)];
      } catch {
        return [];
      }
    });
    const allTeams = await teamsCollection()
      .find({ _id: { $in: objectIds } })
      .toArray();

    const userId = session.user.id;
    const teamIds = allTeams
      .filter((t) => {
        const tid = t._id.toHexString();
        return (
          requestedIds.includes(tid) && (t.members?.includes(userId) || t.admins?.includes(userId))
        );
      })
      .map((t) => t._id.toHexString());

    if (teamIds.length === 0) {
      socket.close(4003, "Forbidden");
      return;
    }

    // Send initial snapshot for each team
    for (const teamId of teamIds) {
      const tickets = await ticketsCollection()
        .find({ teamId, status: { $ne: "deleted" } })
        .sort({ createdAt: -1 })
        .toArray();
      const snapshot = tickets.map(toPublicTicket);
      if (socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify({ type: "snapshot", teamId, tickets: snapshot }));
      }
    }

    // Subscribe to future broadcasts for all requested teams
    const unsubscribers = teamIds.map((teamId) =>
      subscribeToTeam(teamId, (broadcastTeamId, ticket, action) => {
        if (!teamIds.includes(broadcastTeamId)) return;
        if (socket.readyState === socket.OPEN) {
          if (action === "update" && ticket) {
            socket.send(
              JSON.stringify({
                type: "update",
                teamId: broadcastTeamId,
                ticket: toPublicTicket(ticket),
              })
            );
          } else if (action === "delete" && ticket) {
            socket.send(
              JSON.stringify({
                type: "delete",
                teamId: broadcastTeamId,
                ticketId: ticket._id.toHexString(),
              })
            );
          }
        }
      })
    );

    socket.on("close", () => {
      unsubscribers.forEach((unsub) => unsub());
    });
  });
}
