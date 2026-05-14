import type { FastifyReply, FastifyRequest } from "fastify";
import { ObjectId } from "mongodb";
import { patService } from "../services/pat.service.js";

function actorFromUser(user: { id: string; name: string; image?: string | null }) {
  return { id: user.id, name: user.name, avatar: user.image ?? undefined };
}

export const tokensController = {
  async list(req: FastifyRequest, _reply: FastifyReply) {
    const tokens = await patService.listTokens(req.user!.id);
    return { tokens };
  },

  async create(req: FastifyRequest<{ Body: { name: string } }>, reply: FastifyReply) {
    const name = req.body.name.trim();
    const { rawToken } = await patService.createToken(req.user!.id, name, actorFromUser(req.user!));
    return reply.status(201).send({ token: rawToken, name });
  },

  async revoke(req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
      return reply.status(404).send({ error: "Token not found" });
    }
    const deleted = await patService.revokeToken(req.user!.id, id, actorFromUser(req.user!));
    if (!deleted) {
      return reply.status(404).send({ error: "Token not found" });
    }
    return { success: true };
  },
};
