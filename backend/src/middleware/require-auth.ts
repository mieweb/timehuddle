import { FastifyReply, FastifyRequest } from "fastify";
import { auth } from "../lib/auth.js";
import { fromNodeHeaders } from "better-auth/node";
import { ObjectId } from "mongodb";
import { patService } from "../services/pat.service.js";
import { usersCollection } from "../models/index.js";
import { getDB } from "../lib/db.js";

export type AppUser = {
  id: string;
  name: string;
  email: string;
  image?: string | null;
};

const PAT_PREFIX = "th_pat_";

export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  // Check for PAT Bearer token first (prefix: th_pat_)
  // RFC 7235: auth scheme is case-insensitive, so normalise before matching.
  const authHeader = req.headers["authorization"];
  const lowerHeader = authHeader?.toLowerCase() ?? "";
  if (lowerHeader.startsWith("bearer " + PAT_PREFIX)) {
    const rawToken = authHeader!.slice("bearer ".length);
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

  // Try Better Auth session (cookie or session Bearer token)
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(req.headers),
  });

  if (session) {
    req.user = session.user;
    req.session = session.session;
    return;
  }

  // Fall back: check OIDC access token stored in oauthAccessToken collection
  // This handles requests from TimeHarbor's proxy that use the OAuth2 access token.
  if (lowerHeader.startsWith("bearer ")) {
    const rawToken = authHeader!.slice("bearer ".length);
    const oidcToken = await getDB()
      .collection<{ accessToken: string; userId: string; expiresAt?: Date }>("oauthAccessToken")
      .findOne({ accessToken: rawToken });

    if (oidcToken) {
      if (oidcToken.expiresAt && oidcToken.expiresAt < new Date()) {
        return reply.status(401).send({ error: "Token expired" });
      }
      const user = await usersCollection().findOne({ _id: new ObjectId(oidcToken.userId) });
      if (!user) {
        return reply.status(401).send({ error: "Unauthorized" });
      }
      req.user = { id: user._id.toString(), name: user.name, email: user.email, image: user.image };
      return;
    }
  }

  return reply.status(401).send({ error: "Unauthorized" });
}

/**
 * Helper to check if a user is blocked from a specific organization.
 * Returns the block entry if user is blocked, null otherwise.
 */
export async function checkOrgBlocking(userId: string, orgId: string) {
  const user = await usersCollection().findOne(
    { _id: new ObjectId(userId), "blocked.orgId": orgId },
    { projection: { blocked: 1 } }
  );

  if (!user?.blocked) return null;

  const block = user.blocked.find((b) => b.orgId === orgId);
  return block ?? null;
}

/**
 * Middleware to check if the authenticated user is blocked from accessing an organization.
 * Must be used after requireAuth. Expects orgId in route params as 'id' or 'orgId'.
 * Returns 403 if user is blocked.
 */
export async function requireOrgAccess(req: FastifyRequest, reply: FastifyReply) {
  if (!req.user) {
    return reply.status(401).send({ error: "Unauthorized" });
  }

  const params = req.params as Record<string, string>;
  const orgId = params.id || params.orgId;

  if (!orgId) {
    // If no orgId in params, skip blocking check (route doesn't require org context)
    return;
  }

  const block = await checkOrgBlocking(req.user.id, orgId);

  if (block) {
    return reply.status(403).send({
      error: "Your account has been suspended from this organization",
      blockedBy: block.blockedBy,
      blockedAt: block.blockedAt.toISOString(),
      reason: block.reason,
    });
  }
}

// Extend Fastify types globally
declare module "fastify" {
  interface FastifyRequest {
    user?: AppUser;
    session?: unknown;
  }
}
