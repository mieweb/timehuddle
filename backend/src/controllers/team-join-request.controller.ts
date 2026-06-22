import type { FastifyRequest, FastifyReply } from "fastify";
import { teamJoinRequestService } from "../services/team-join-request.service.js";

export class TeamJoinRequestController {
  /**
   * GET /v1/teams/:teamId/join-requests
   * List all pending join requests for a team (admin only).
   */
  async listForTeam(req: FastifyRequest<{ Params: { teamId: string } }>, reply: FastifyReply) {
    const userId = (req as any).user.id as string;
    const { teamId } = req.params;

    const result = await teamJoinRequestService.getPendingForTeam(teamId, userId);

    if (result === "not-found") {
      return reply.status(404).send({ error: "Team not found" });
    }
    if (result === "forbidden") {
      return reply.status(403).send({ error: "Admin access required" });
    }

    return reply.send({ requests: result });
  }

  /**
   * POST /v1/teams/join-requests/:requestId/approve
   * Approve a join request (admin only).
   */
  async approve(req: FastifyRequest<{ Params: { requestId: string } }>, reply: FastifyReply) {
    const userId = (req as any).user.id as string;
    const { requestId } = req.params;

    const result = await teamJoinRequestService.approve(requestId, userId);

    if (result === "not-found") {
      return reply.status(404).send({ error: "Request not found" });
    }
    if (result === "forbidden") {
      return reply.status(403).send({ error: "Admin access required" });
    }
    if (result === "already-processed") {
      return reply.status(409).send({ error: "Request already processed" });
    }

    return reply.send({ status: "ok" });
  }

  /**
   * POST /v1/teams/join-requests/:requestId/decline
   * Decline a join request (admin only).
   */
  async decline(req: FastifyRequest<{ Params: { requestId: string } }>, reply: FastifyReply) {
    const userId = (req as any).user.id as string;
    const { requestId } = req.params;

    const result = await teamJoinRequestService.decline(requestId, userId);

    if (result === "not-found") {
      return reply.status(404).send({ error: "Request not found" });
    }
    if (result === "forbidden") {
      return reply.status(403).send({ error: "Admin access required" });
    }
    if (result === "already-processed") {
      return reply.status(409).send({ error: "Request already processed" });
    }

    return reply.send({ status: "ok" });
  }
}

export const teamJoinRequestController = new TeamJoinRequestController();
