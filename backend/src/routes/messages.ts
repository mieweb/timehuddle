import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { auth } from "../lib/auth.js";
import { messageService, subscribeSse } from "../services/message.service.js";

const sendSchema = z.object({
  teamId: z.string().min(1),
  toUserId: z.string().min(1),
  text: z.string().trim().min(1).max(5000),
  adminId: z.string().min(1),
  ticketId: z.string().optional(),
});

export async function messageRoutes(app: FastifyInstance) {
  // GET /v1/messages?teamId=&adminId=&memberId=
  app.get("/messages", async (req, reply) => {
    const session = await auth.api.getSession({ headers: req.headers as any });
    if (!session?.user) return reply.status(401).send({ error: "Unauthorized" });

    const { teamId, adminId, memberId } = req.query as Record<string, string>;
    if (!teamId || !adminId || !memberId) {
      return reply.status(400).send({ error: "teamId, adminId, memberId required" });
    }

    const result = await messageService.getThread(session.user.id, teamId, adminId, memberId);
    if (result === "forbidden") return reply.status(403).send({ error: "Forbidden" });
    return reply.send({ messages: result });
  });

  // POST /v1/messages
  app.post("/messages", async (req, reply) => {
    const session = await auth.api.getSession({ headers: req.headers as any });
    if (!session?.user) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = sendSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid" });
    }

    const result = await messageService.send(session.user.id, parsed.data);
    if (result === "not-found") return reply.status(404).send({ error: "Team not found" });
    if (result === "forbidden") return reply.status(403).send({ error: "Forbidden" });
    return reply.send({ message: result });
  });

  // GET /v1/messages/stream?threadId=  (SSE)
  app.get("/messages/stream", async (req, reply) => {
    const session = await auth.api.getSession({ headers: req.headers as any });
    if (!session?.user) return reply.status(401).send({ error: "Unauthorized" });

    const { threadId } = req.query as { threadId?: string };
    if (!threadId) return reply.status(400).send({ error: "threadId required" });

    // threadId = "teamId:adminId:memberId" — validate participant
    const parts = threadId.split(":");
    const adminId = parts[1];
    const memberId = parts[2];
    if (session.user.id !== adminId && session.user.id !== memberId) {
      return reply.status(403).send({ error: "Forbidden" });
    }

    // Hijack the response — prevents Fastify from finalizing/closing it.
    // Because hijack() bypasses @fastify/cors hooks, we must set CORS headers manually.
    reply.hijack();

    const trustedOrigins = process.env.TRUSTED_ORIGINS
      ? process.env.TRUSTED_ORIGINS.split(",").map((o) => o.trim())
      : [];
    const requestOrigin = req.headers.origin ?? "";
    const allowOrigin = trustedOrigins.includes(requestOrigin) ? requestOrigin : "";

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      ...(allowOrigin && {
        "Access-Control-Allow-Origin": allowOrigin,
        "Access-Control-Allow-Credentials": "true",
      }),
    });
    reply.raw.flushHeaders();

    const unsub = subscribeSse(threadId, (msg) => {
      reply.raw.write(`data: ${JSON.stringify(msg)}\n\n`);
    });
    const ping = setInterval(() => reply.raw.write(": ping\n\n"), 25_000);

    req.raw.on("close", () => {
      clearInterval(ping);
      unsub();
    });
  });
}
