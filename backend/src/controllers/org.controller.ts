import type { FastifyReply, FastifyRequest } from "fastify";
import { orgService } from "../services/org.service.js";

export const orgController = {
  async list(req: FastifyRequest, reply: FastifyReply) {
    const organizations = await orgService.listOrganizationsForUser(req.user!.id);
    return reply.send({ organizations });
  },

  async create(
    req: FastifyRequest<{
      Body: {
        enterpriseId: string;
        name: string;
        key?: string;
        slug?: string;
        allowAutoJoin?: boolean;
      };
    }>,
    reply: FastifyReply
  ) {
    const result = await orgService.createOrganization({
      enterpriseId: req.body.enterpriseId,
      userId: req.user!.id,
      name: req.body.name,
      key: req.body.key,
      slug: req.body.slug,
      allowAutoJoin: req.body.allowAutoJoin,
    });
    if (result === "forbidden") return reply.status(403).send({ error: "Forbidden" });
    if (result === "not-found") return reply.status(404).send({ error: "Enterprise not found" });
    if (result === "conflict")
      return reply.status(409).send({ error: "Organization key/slug already exists" });
    return reply.status(201).send({ organization: result });
  },

  async get(req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
    const result = await orgService.getOrganization(req.params.id, req.user!.id);
    if (result === "not-found") return reply.status(404).send({ error: "Organization not found" });
    if (result === "forbidden") return reply.status(403).send({ error: "Forbidden" });
    return reply.send({ organization: result });
  },

  async setAllowAutoJoin(
    req: FastifyRequest<{ Params: { id: string }; Body: { allowAutoJoin: boolean } }>,
    reply: FastifyReply
  ) {
    const result = await orgService.setAllowAutoJoin(
      req.user!.id,
      req.params.id,
      req.body.allowAutoJoin
    );
    if (result === "not-found") return reply.status(404).send({ error: "Organization not found" });
    if (result === "forbidden") return reply.status(403).send({ error: "Forbidden" });
    return reply.send({ organization: result });
  },

  async join(req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
    const result = await orgService.joinOrg(req.user!.id, req.params.id);
    if (result === "not-found") return reply.status(404).send({ error: "Organization not found" });
    if (result === "auto-join-disabled") {
      return reply.status(403).send({ error: "Organization auto-join is disabled" });
    }
    return reply.send({ membership: result });
  },

  async listMembers(req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
    const result = await orgService.listMembers(req.params.id, req.user!.id);
    if (result === "not-found") return reply.status(404).send({ error: "Organization not found" });
    if (result === "forbidden") return reply.status(403).send({ error: "Forbidden" });
    return reply.send({ users: result });
  },

  async setMemberRole(
    req: FastifyRequest<{
      Params: { id: string; userId: string };
      Body: { role: "owner" | "admin" | "member" };
    }>,
    reply: FastifyReply
  ) {
    const result = await orgService.setOrgRole(
      req.user!.id,
      req.params.id,
      req.params.userId,
      req.body.role
    );
    if (result === "not-found") return reply.status(404).send({ error: "Organization not found" });
    if (result === "user-not-found") return reply.status(404).send({ error: "User not found" });
    if (result === "forbidden") return reply.status(403).send({ error: "Forbidden" });
    if (result === "last-elevated") {
      return reply.status(400).send({ error: "At least one owner or admin is required" });
    }
    return reply.send({ user: result });
  },

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
