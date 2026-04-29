import { FastifyRequest, FastifyReply } from "fastify";

export class UserController {
  /** GET /me — return the current local identity */
  async getMe(req: FastifyRequest, reply: FastifyReply) {
    return reply.send({ user: req.user });
  }

  /** GET /me/profile — return the same identity shape for compatibility */
  async getMyProfile(req: FastifyRequest, reply: FastifyReply) {
    return reply.send({ user: req.user });
  }
}

export const userController = new UserController();
