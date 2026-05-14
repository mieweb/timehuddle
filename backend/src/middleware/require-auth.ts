import { FastifyReply, FastifyRequest } from "fastify";
import { auth } from "../lib/auth.js";
import { fromNodeHeaders } from "better-auth/node";
import { ObjectId } from "mongodb";
import { patService } from "../services/pat.service.js";
import { usersCollection } from "../models/index.js";

export type AppUser = {
  id: string;
  name: string;
  email: string;
  image?: string | null;
};

const PAT_PREFIX = "th_pat_";

export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  // Check for PAT Bearer token first (prefix: th_pat_)
  const authHeader = req.headers["authorization"];
  if (authHeader?.startsWith("Bearer " + PAT_PREFIX)) {
    const rawToken = authHeader.slice("Bearer ".length);
    const userId = await patService.validateToken(rawToken);
    if (!userId) {
      return reply.status(401).send({ error: "Invalid or expired token" });
    }
    const user = await usersCollection().findOne({ _id: new ObjectId(userId) });
    if (!user) {
      return reply.status(401).send({ error: "Unauthorized" });
    }
    req.user = { id: user._id.toString(), name: user.name, email: user.email, image: user.image };
    return;
  }

  // Fall back to Better Auth session (cookie or session Bearer token)
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
    session?: unknown;
  }
}
