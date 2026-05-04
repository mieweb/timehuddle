import { FastifyRequest, FastifyReply } from "fastify";

export class HealthController {
  async check(_req: FastifyRequest, reply: FastifyReply) {
    return reply.send({ status: "ok", timestamp: new Date().toISOString() });
  }
}

export const healthController = new HealthController();
