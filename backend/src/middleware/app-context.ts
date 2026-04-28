import { FastifyRequest, FastifyReply } from "fastify";

export type AppId = "timeharbor" | "timehuddle";

/**
 * Reads the X-App-Id header and attaches it to the request.
 * Falls back to "timeharbor" if the header is missing or unrecognised.
 */
export async function appContext(req: FastifyRequest, _reply: FastifyReply) {
  const raw = (req.headers["x-app-id"] as string)?.toLowerCase();
  req.appId = raw === "timehuddle" ? "timehuddle" : "timeharbor";
}

declare module "fastify" {
  interface FastifyRequest {
    appId?: AppId;
  }
}
