import { FastifyRequest, FastifyReply } from "fastify";

export class HealthController {
  async check(_req: FastifyRequest, reply: FastifyReply) {
    return reply.send({ status: "ok", hi: "deploy test", version: "smoke-test-v2", timestamp: new Date().toISOString() });
  }
}

export const healthController = new HealthController();
