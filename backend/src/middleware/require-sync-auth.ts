import { FastifyRequest, FastifyReply } from "fastify";

/**
 * UUID-based auth for the encrypted sync relay.
 *
 * Authenticates via the X-Identity-UUID header sent by every sync client.
 *
 * The server is a blind relay for encrypted data, so UUID-only auth is safe:
 * - The UUID is unguessable (128-bit random, UUID v4)
 * - Data is AES-256-GCM encrypted — useless without the key
 * - The server never decrypts anything
 */
export async function requireSyncAuth(req: FastifyRequest, reply: FastifyReply) {
  const uuid = req.headers["x-identity-uuid"] as string | undefined;
  if (uuid && isValidUUID(uuid)) {
    req.user = {
      id: uuid,
      name: "Anonymous",
      email: "",
      emailVerified: false,
      image: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as typeof req.user;
    return;
  }

  return reply.status(401).send({ error: "Unauthorized" });
}

/** Basic UUID v4 format validation. */
function isValidUUID(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str);
}
