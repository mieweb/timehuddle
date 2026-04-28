import { FastifyReply, FastifyRequest } from "fastify";
import { randomUUID } from "crypto";
import { auth } from "../lib/auth.js";
import { fromNodeHeaders } from "better-auth/node";

export type AppUser = {
  id: string;
  name: string;
  email: string;
  image?: string | null;
};

function buildAppUser(req: FastifyRequest): AppUser {
  const identityUUID =
    (req.headers["x-identity-uuid"] as string | undefined)?.trim() ||
    (req.headers["x-user-id"] as string | undefined)?.trim() ||
    randomUUID();

  return {
    id: identityUUID,
    name: "TimeHarbor User",
    email: `${identityUUID}@timeharbor.local`,
    image: null,
  };
}

export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(req.headers),
  });

  if (!session) {
    return reply.status(401).send({ error: "Unauthorized" });
  }

  req.user = session.user;
  req.session = session.session;
}

// Extend Fastify types globally
declare module "fastify" {
  interface FastifyRequest {
    user?: AppUser;
  }
}
