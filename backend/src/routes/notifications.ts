import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../middleware/require-auth.js";
import { verifyWsToken } from "../lib/ws-auth.js";
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

const joinRequestRespondSchema = z.object({
  action: z.enum(["approve", "decline"]),
});

export async function notificationRoutes(app: FastifyInstance) {
  // GET /v1/notifications — inbox
  app.get("/notifications", { preHandler: requireAuth }, async (req, reply) => {
    const notifications = await notificationService.getInbox(req.user!.id);
    return reply.send({ notifications });
  });

  // PATCH /v1/notifications/:id/read — mark one read
  app.patch("/notifications/:id/read", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const result = await notificationService.markOneRead(req.user!.id, id);
    if (result === "not-found") return reply.status(404).send({ error: "Not found" });
    if (result === "forbidden") return reply.status(403).send({ error: "Forbidden" });
    return reply.send({ ok: true });
  });

  // POST /v1/notifications/read — mark all read
  app.post("/notifications/read", { preHandler: requireAuth }, async (req, reply) => {
    await notificationService.markAllRead(req.user!.id);
    return reply.send({ ok: true });
  });

  // DELETE /v1/notifications — bulk delete { ids: string[] }
  app.delete("/notifications", { preHandler: requireAuth }, async (req, reply) => {
    const parsed = deleteSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid" });
    }

    const result = await notificationService.deleteMany(req.user!.id, parsed.data.ids);
    return reply.send(result);
  });

  // GET /v1/notifications/:id/invite-preview — team invite preview
  app.get("/notifications/:id/invite-preview", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const result = await notificationService.getInvitePreview(req.user!.id, id);
    if (result === "not-found") return reply.status(404).send({ error: "Not found" });
    if (result === "forbidden") return reply.status(403).send({ error: "Forbidden" });
    if (result === "bad-request") return reply.status(400).send({ error: "Not a team invite" });
    return reply.send(result);
  });

  // POST /v1/notifications/:id/invite-respond — accept or ignore invite
  app.post("/notifications/:id/invite-respond", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = inviteRespondSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid" });
    }

    const result = await notificationService.respondToInvite(req.user!.id, id, parsed.data.action);
    if (result === "not-found") return reply.status(404).send({ error: "Not found" });
    if (result === "forbidden") return reply.status(403).send({ error: "Forbidden" });
    if (result === "bad-request") return reply.status(400).send({ error: "Not a team invite" });
    return reply.send({ ok: true });
  });

  // GET /v1/notifications/:id/join-request-preview — team join request preview
  app.get(
    "/notifications/:id/join-request-preview",
    { preHandler: requireAuth },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const result = await notificationService.getJoinRequestPreview(req.user!.id, id);
      if (result === "not-found") return reply.status(404).send({ error: "Not found" });
      if (result === "forbidden") return reply.status(403).send({ error: "Forbidden" });
      if (result === "bad-request")
        return reply.status(400).send({ error: "Not a team join request" });
      return reply.send(result);
    }
  );

  // POST /v1/notifications/:id/join-request-respond — approve or decline join request
  app.post(
    "/notifications/:id/join-request-respond",
    { preHandler: requireAuth },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const parsed = joinRequestRespondSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid" });
      }

      const result = await notificationService.respondToJoinRequest(
        req.user!.id,
        id,
        parsed.data.action
      );
      if (result === "not-found") return reply.status(404).send({ error: "Not found" });
      if (result === "forbidden") return reply.status(403).send({ error: "Forbidden" });
      if (result === "bad-request")
        return reply.status(400).send({ error: "Not a team join request" });
      if (result === "already-processed")
        return reply.status(409).send({ error: "Request already processed" });
      return reply.send({ ok: true });
    }
  );

  // POST /v1/notifications/:id/shift-respond — agree or disagree to shift-end auto-clockout
  app.post("/notifications/:id/shift-respond", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = shiftRespondSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid" });
    }

    const result = await respondToShiftReminder(req.user!.id, id, parsed.data.action);
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
    const rawToken = queryToken ?? req.headers["authorization"]?.replace(/^bearer /i, "");
    const wsUser = await verifyWsToken(rawToken);
    if (!wsUser) {
      socket.close(4001, "Unauthorized");
      return;
    }

    const userId = wsUser.id;
    const unsub = subscribe(userId, (n) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(n));
    });

    socket.on("close", unsub);
  });

  // POST /v1/notifications/push-subscribe — register a push subscription
  app.post("/notifications/push-subscribe", { preHandler: requireAuth }, async (req, reply) => {
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
      await pushService.registerDeviceToken(req.user!.id, body.token, body.platform);
      return reply.send({ ok: true });
    }

    // Default: webpush
    if (!body.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
      return reply.status(400).send({ error: "endpoint and keys required for webpush" });
    }
    await pushService.saveWebPush(req.user!.id, {
      endpoint: body.endpoint,
      keys: { p256dh: body.keys.p256dh, auth: body.keys.auth },
      expirationTime: body.expirationTime,
    });
    return reply.send({ ok: true });
  });

  // POST /v1/notifications/push-unsubscribe — remove all push subscriptions for the user
  app.post("/notifications/push-unsubscribe", { preHandler: requireAuth }, async (req, reply) => {
    await pushService.removeAll(req.user!.id);
    return reply.send({ ok: true });
  });

  // POST /v1/notifications/test-push — send a test push to the requesting user
  app.post("/notifications/test-push", { preHandler: requireAuth }, async (req, reply) => {
    await pushService.sendToUser(req.user!.id, {
      title: "TimeHuddle Test",
      body: "Push notifications are working!",
      tag: "test-push",
      data: { type: "test", url: "/app/notifications" },
    });
    return reply.send({ ok: true });
  });
}
