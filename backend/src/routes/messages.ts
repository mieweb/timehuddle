import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../middleware/require-auth.js";
import { verifyWsToken } from "../lib/ws-auth.js";
import { messageService, subscribe } from "../services/message.service.js";

const sendSchema = z.object({
  teamId: z.string().min(1),
  toUserId: z.string().min(1),
  text: z.string().trim().min(1).max(5000),
  adminId: z.string().min(1),
  ticketId: z.string().optional(),
});

export async function messageRoutes(app: FastifyInstance) {
  // GET /v1/messages?teamId=&adminId=&memberId=
  app.get("/messages", { preHandler: requireAuth }, async (req, reply) => {
    const { teamId, adminId, memberId, before, limit } = req.query as Record<string, string>;
    if (!teamId || !adminId || !memberId) {
      return reply.status(400).send({ error: "teamId, adminId, memberId required" });
    }

    const beforeDate = before ? new Date(before) : undefined;
    if (beforeDate !== undefined && isNaN(beforeDate.getTime())) {
      return reply.status(400).send({ error: "Invalid 'before' date" });
    }
    const parsedLimit = limit ? Math.min(parseInt(limit, 10) || 50, 100) : 50;
    const result = await messageService.getThread(req.user!.id, teamId, adminId, memberId, {
      before: beforeDate,
      limit: parsedLimit,
    });
    if (result === "forbidden") return reply.status(403).send({ error: "Forbidden" });
    return reply.send({ messages: result.messages, hasMore: result.hasMore });
  });

  // POST /v1/messages
  app.post("/messages", { preHandler: requireAuth }, async (req, reply) => {
    const parsed = sendSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid" });
    }

    const result = await messageService.send(req.user!.id, parsed.data);
    if (result === "not-found") return reply.status(404).send({ error: "Team not found" });
    if (result === "forbidden") return reply.status(403).send({ error: "Forbidden" });
    return reply.send({ message: result });
  });

  // GET /v1/messages/ws?threadId=  (WebSocket)
  app.get("/messages/ws", { websocket: true }, async (socket, req) => {
    const { token: queryToken, threadId } = req.query as {
      token?: string;
      threadId?: string;
    };
    const headers: Record<string, string> = { ...(req.headers as any) };
    if (queryToken) headers["authorization"] = `Bearer ${queryToken}`;
    const rawToken = queryToken ?? req.headers["authorization"]?.replace(/^bearer /i, "");
    const wsUser = await verifyWsToken(rawToken);
    if (!wsUser) {
      socket.close(4001, "Unauthorized");
      return;
    }

    if (!threadId) {
      socket.close(4000, "threadId required");
      return;
    }

    // threadId = "teamId:adminId:memberId" — validate participant
    const parts = threadId.split(":");
    const adminId = parts[1];
    const memberId = parts[2];
    if (wsUser.id !== adminId && wsUser.id !== memberId) {
      socket.close(4003, "Forbidden");
      return;
    }

    const unsub = subscribe(threadId, (msg) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
    });

    socket.on("close", unsub);
  });
}
