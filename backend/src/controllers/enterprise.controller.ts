import type { FastifyReply, FastifyRequest } from "fastify";
import { enterpriseService } from "../services/enterprise.service.js";

export const enterpriseController = {
  async list(req: FastifyRequest, reply: FastifyReply) {
    const enterprises = await enterpriseService.listEnterprisesForUser(req.user!.id);
    return reply.send({ enterprises });
  },

  async create(
    req: FastifyRequest<{ Body: { name: string; slug?: string } }>,
    reply: FastifyReply
  ) {
    const result = await enterpriseService.createEnterprise(req.user!.id, req.body);
    if (result === "conflict") {
      return reply.status(409).send({ error: "Enterprise slug already exists" });
    }
    return reply.status(201).send({ enterprise: result });
  },

  async get(req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
    const result = await enterpriseService.getEnterprise(req.user!.id, req.params.id);
    if (result === "not-found") {
      return reply.status(404).send({ error: "Enterprise not found" });
    }
    if (result === "forbidden") {
      return reply.status(403).send({ error: "Forbidden" });
    }
    return reply.send({ enterprise: result });
  },

  async setMemberRole(
    req: FastifyRequest<{
      Params: { id: string; userId: string };
      Body: { role: "owner" | "admin" };
    }>,
    reply: FastifyReply
  ) {
    const result = await enterpriseService.setEnterpriseRole(
      req.user!.id,
      req.params.id,
      req.params.userId,
      req.body.role
    );
    if (result === "not-found") {
      return reply.status(404).send({ error: "Enterprise not found" });
    }
    if (result === "forbidden") {
      return reply.status(403).send({ error: "Forbidden" });
    }
    return reply.send({ user: result });
  },

  async updateName(
    req: FastifyRequest<{
      Params: { id: string };
      Body: { name: string };
    }>,
    reply: FastifyReply
  ) {
    const result = await enterpriseService.updateEnterpriseName(req.user!.id, req.params.id, req.body);
    if (result === "not-found") {
      return reply.status(404).send({ error: "Enterprise not found" });
    }
    if (result === "forbidden") {
      return reply.status(403).send({ error: "Forbidden" });
    }
    return reply.send({ enterprise: result });
  },
};
