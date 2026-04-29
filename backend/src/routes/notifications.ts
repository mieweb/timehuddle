import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { auth } from "../lib/auth.js";
import { notificationService, subscribeSse } from "../services/notification.service.js";

const deleteSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
});

const inviteRespondSchema = z.object({
  action: z.enum(["join", "ignore"]),
});

export async function notificationRoutes(app: FastifyInstance) {
  // GET /v1/notifications — inbox
  app.get("/notifications", async (req, reply) => {
    const session = await auth.api.getSession({ headers: req.headers as any });
    if (!session?.user) return reply.status(401).send({ error: "Unauthorized" });

    const notifications = await notificationService.getInbox(session.user.id);
    return reply.send({ notifications });
  });

  // PATCH /v1/notifications/:id/read — mark one read
  app.patch("/notifications/:id/read", async (req, reply) => {
    const session = await auth.api.getSession({ headers: req.headers as any });
    if (!session?.user) return reply.status(401).send({ error: "Unauthorized" });

    const { id } = req.params as { id: string };
    const result = await notificationService.markOneRead(session.user.id, id);
    if (result === "not-found") return reply.status(404).send({ error: "Not found" });
    if (result === "forbidden") return reply.status(403).send({ error: "Forbidden" });
    return reply.send({ ok: true });
  });

  // POST /v1/notifications/read — mark all read
  app.post("/notifications/read", async (req, reply) => {
    const session = await auth.api.getSession({ headers: req.headers as any });
    if (!session?.user) return reply.status(401).send({ error: "Unauthorized" });

    await notificationService.markAllRead(session.user.id);
    return reply.send({ ok: true });
  });

  // DELETE /v1/notifications — bulk delete { ids: string[] }
  app.delete("/notifications", async (req, reply) => {
    const session = await auth.api.getSession({ headers: req.headers as any });
    if (!session?.user) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = deleteSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid" });
    }

    const result = await notificationService.deleteMany(session.user.id, parsed.data.ids);
    return reply.send(result);
  });

  // GET /v1/notifications/:id/invite-preview — team invite preview
  app.get("/notifications/:id/invite-preview", async (req, reply) => {
    const session = await auth.api.getSession({ headers: req.headers as any });
    if (!session?.user) return reply.status(401).send({ error: "Unauthorized" });

    const { id } = req.params as { id: string };
    const result = await notificationService.getInvitePreview(session.user.id, id);
    if (result === "not-found") return reply.status(404).send({ error: "Not found" });
    if (result === "forbidden") return reply.status(403).send({ error: "Forbidden" });
    if (result === "bad-request") return reply.status(400).send({ error: "Not a team invite" });
    return reply.send(result);
  });

  // POST /v1/notifications/:id/invite-respond — accept or ignore invite
  app.post("/notifications/:id/invite-respond", async (req, reply) => {
    const session = await auth.api.getSession({ headers: req.headers as any });
    if (!session?.user) return reply.status(401).send({ error: "Unauthorized" });

    const { id } = req.params as { id: string };
    const parsed = inviteRespondSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid" });
    }

    const result = await notificationService.respondToInvite(
      session.user.id,
      id,
      parsed.data.action
    );
    if (result === "not-found") return reply.status(404).send({ error: "Not found" });
    if (result === "forbidden") return reply.status(403).send({ error: "Forbidden" });
    if (result === "bad-request") return reply.status(400).send({ error: "Not a team invite" });
    return reply.send({ ok: true });
  });

  // GET /v1/notifications/stream — SSE (new notifications pushed in real-time)
  app.get("/notifications/stream", async (req, reply) => {
    const session = await auth.api.getSession({ headers: req.headers as any });
    if (!session?.user) return reply.status(401).send({ error: "Unauthorized" });

    const userId = session.user.id;

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

    const unsub = subscribeSse(userId, (n) => {
      reply.raw.write(`data: ${JSON.stringify(n)}\n\n`);
    });
    const ping = setInterval(() => reply.raw.write(": ping\n\n"), 25_000);

    req.raw.on("close", () => {
      clearInterval(ping);
      unsub();
    });
  });
}
