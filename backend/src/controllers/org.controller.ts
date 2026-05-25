import type { FastifyReply, FastifyRequest } from "fastify";
import { orgService } from "../services/org.service.js";

export const orgController = {
  async updateOrgUserReportsTo(
    req: FastifyRequest<{
      Params: { userId: string };
      Body: { reportsToUserId?: string | null };
    }>,
    reply: FastifyReply
  ) {
    const { userId } = req.params;
    const { reportsToUserId } = req.body;

    const result = await orgService.updateOrgUserReportsTo(req.user!.id, userId, reportsToUserId);

    if (result === "forbidden") {
      return reply.status(403).send({ error: "Forbidden" });
    }
    if (result === "user-not-found") {
      return reply.status(404).send({ error: "User not found" });
    }
    if (result === "reports-to-user-not-found") {
      return reply.status(404).send({ error: "Reports-to user not found" });
    }
    if (result === "default-organization-not-found") {
      return reply.status(404).send({ error: "Default organization not found" });
    }

    return reply.send({
      user: {
        id: result.userId,
        reportsToUserId: result.reportsToUserId,
      },
    });
  },
};
