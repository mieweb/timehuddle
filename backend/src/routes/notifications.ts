import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { auth } from "../lib/auth.js";
import { notificationService, subscribe } from "../services/notification.service.js";
import { pushService } from "../services/push.service.js";
import { respondToShiftReminder } from "../services/clock.service.js";

const deleteSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
});

const shiftRespondSchema = z.object({
  action: z.enum(["agree", "disagree"]),
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

  // POST /v1/notifications/:id/shift-respond — agree or disagree to shift-end auto-clockout
  app.post("/notifications/:id/shift-respond", async (req, reply) => {
    const session = await auth.api.getSession({ headers: req.headers as any });
    if (!session?.user) return reply.status(401).send({ error: "Unauthorized" });

    const { id } = req.params as { id: string };
    const parsed = shiftRespondSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid" });
    }

    const result = await respondToShiftReminder(session.user.id, id, parsed.data.action);
    if (result === "not-found") return reply.status(404).send({ error: "Not found" });
    if (result === "forbidden") return reply.status(403).send({ error: "Forbidden" });
    if (result === "bad-request")
      return reply.status(400).send({ error: "Not a shift-end reminder" });
    if (result === "already-closed")
      return reply.status(409).send({ error: "Clock session already closed" });
    return reply.send({ ok: true });
  });

  // GET /v1/notifications/ws — WebSocket (new notifications pushed in real-time)
  app.get("/notifications/ws", { websocket: true }, async (socket, req) => {
    const { token: queryToken } = req.query as { token?: string };
    const headers: Record<string, string> = { ...(req.headers as any) };
    if (queryToken) headers["authorization"] = `Bearer ${queryToken}`;
    const session = await auth.api.getSession({ headers });
    if (!session?.user) {
      socket.close(4001, "Unauthorized");
      return;
    }

    const userId = session.user.id;
    const unsub = subscribe(userId, (n) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(n));
    });

    socket.on("close", unsub);
  });

  // POST /v1/notifications/push-subscribe — register a push subscription
  app.post("/notifications/push-subscribe", async (req, reply) => {
    const session = await auth.api.getSession({ headers: req.headers as any });
    if (!session?.user) return reply.status(401).send({ error: "Unauthorized" });

    const body = req.body as {
      type?: string;
      endpoint?: string;
      keys?: { p256dh?: string; auth?: string };
      expirationTime?: number | null;
      token?: string;
      platform?: string;
    };

    if (body.type === "native") {
      if (!body.token || !body.platform) {
        return reply.status(400).send({ error: "token and platform required for native" });
      }
      if (body.platform !== "ios" && body.platform !== "android") {
        return reply.status(400).send({ error: "platform must be ios or android" });
      }
      await pushService.registerDeviceToken(session.user.id, body.token, body.platform);
      return reply.send({ ok: true });
    }

    // Default: webpush
    if (!body.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
      return reply.status(400).send({ error: "endpoint and keys required for webpush" });
    }
    await pushService.saveWebPush(session.user.id, {
      endpoint: body.endpoint,
      keys: { p256dh: body.keys.p256dh, auth: body.keys.auth },
      expirationTime: body.expirationTime,
    });
    return reply.send({ ok: true });
  });

  // POST /v1/notifications/push-unsubscribe — remove all push subscriptions for the user
  app.post("/notifications/push-unsubscribe", async (req, reply) => {
    const session = await auth.api.getSession({ headers: req.headers as any });
    if (!session?.user) return reply.status(401).send({ error: "Unauthorized" });

    await pushService.removeAll(session.user.id);
    return reply.send({ ok: true });
  });

  // POST /v1/notifications/test-push — send a test push to the requesting user
  app.post("/notifications/test-push", async (req, reply) => {
    const session = await auth.api.getSession({ headers: req.headers as any });
    if (!session?.user) return reply.status(401).send({ error: "Unauthorized" });

    await pushService.sendToUser(session.user.id, {
      title: "TimeHuddle Test",
      body: "Push notifications are working!",
      tag: "test-push",
      data: { type: "test", url: "/app/notifications" },
    });
    return reply.send({ ok: true });
  });
}
