import { FastifyReply, FastifyRequest } from "fastify";
import { auth } from "../lib/auth.js";
import { fromNodeHeaders } from "better-auth/node";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { ObjectId } from "mongodb";
import { patService } from "../services/pat.service.js";
import { usersCollection } from "../models/index.js";
import { getDB } from "../lib/db.js";
import { createHash } from "crypto";

function toId(id: string): any {
  // Return ObjectId for 24-char hex strings, plain string otherwise
  return /^[0-9a-fA-F]{24}$/.test(id) ? new ObjectId(id) : id;
}

export type AppUser = {
  id: string;
  name: string;
  email: string;
  image?: string | null;
};

const PAT_PREFIX = "th_pat_";

// JWKS for better-auth-issued JWTs. Self-fetch with caching (jose handles
// cooldown + kid rotation) — verification itself is local, no DB hit.
const JWKS_URL =
  process.env.AUTH_JWKS_URL ?? `http://127.0.0.1:${process.env.PORT ?? 4000}/api/auth/jwks`;
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

/** A JWT has exactly three dot-separated segments (session tokens have one dot). */
function looksLikeJwt(token: string): boolean {
  return token.split(".").length === 3;
}

async function verifyJwt(token: string): Promise<AppUser | null> {
  try {
    jwks ??= createRemoteJWKSet(new URL(JWKS_URL));
    const { payload } = await jwtVerify(token, jwks);
    if (!payload.sub) return null;
    return {
      id: payload.sub,
      name: typeof payload.name === "string" ? payload.name : "",
      email: typeof payload.email === "string" ? payload.email : "",
      image: typeof payload.image === "string" ? payload.image : null,
    };
  } catch {
    return null;
  }
}

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
    const user = await usersCollection().findOne({ _id: toId(userId) });
    if (!user) {
      return reply.status(401).send({ error: "Unauthorized" });
    }
    req.user = { id: user._id.toString(), name: user.name, email: user.email, image: user.image };
    return;
  }

  // Meteor resume token: look up hashed token in Meteor's users collection
  if (lowerHeader.startsWith("bearer ") && !looksLikeJwt(authHeader!.slice("bearer ".length))) {
    const rawToken = authHeader!.slice("bearer ".length);
    if (!rawToken.startsWith(PAT_PREFIX)) {
      // Meteor hashes resume tokens with SHA256 then base64
      const hashedToken = createHash("sha256").update(rawToken).digest("base64");
      const db = getDB();
      const meteorUser = await db.collection("users").findOne({
        "services.resume.loginTokens.hashedToken": hashedToken,
      });
      if (meteorUser) {
        const email = meteorUser.emails?.[0]?.address ?? "";
        // Get full profile from Fastify user collection
        const fastifyUser = await usersCollection().findOne({
          email: email.toLowerCase(),
        });
        if (fastifyUser) {
          req.user = {
            id: fastifyUser._id.toString(),
            name: fastifyUser.name,
            email: fastifyUser.email,
            image: fastifyUser.image,
          };
          return;
        }
        // Fallback: use Meteor user data directly
        req.user = {
          id: meteorUser._id.toString(),
          name: meteorUser.profile?.name ?? email,
          email,
          image: null,
        };
        return;
      }
    }
  }

  // Better-auth-issued JWT access token: stateless local verification.
  if (lowerHeader.startsWith("bearer ")) {
    const rawToken = authHeader!.slice("bearer ".length);
    if (looksLikeJwt(rawToken)) {
      const jwtUser = await verifyJwt(rawToken);
      if (jwtUser) {
        req.user = jwtUser;
        return;
      }
      return reply.status(401).send({ error: "Invalid or expired token" });
    }
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
      const user = await usersCollection().findOne({ _id: toId(oidcToken.userId) });
      if (!user) {
        return reply.status(401).send({ error: "Unauthorized" });
      }
      req.user = { id: user._id.toString(), name: user.name, email: user.email, image: user.image };
      return;
    }
  }

  return reply.status(401).send({ error: "Unauthorized" });
}

// Extend Fastify types globally
declare module "fastify" {
  interface FastifyRequest {
    user?: AppUser;
    session?: unknown;
  }
}
