import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "../lib/auth.js";
import { channelService, subscribeChannel } from "../services/channel.service.js";

const createChannelSchema = z.object({
  teamId: z.string().min(1),
  name: z.string().trim().min(1).max(50),
  description: z.string().trim().max(200).optional(),
  members: z.array(z.string()).optional(),
});

const sendMessageSchema = z.object({
  teamId: z.string().min(1),
  text: z.string().trim().min(1).max(5000),
});

export async function channelRoutes(app: FastifyInstance) {
  // GET /v1/channels?teamId= — list channels for a team
  app.get("/channels", async (req, reply) => {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!session?.user) return reply.status(401).send({ error: "Unauthorized" });

    const { teamId } = req.query as Record<string, string>;
    if (!teamId) return reply.status(400).send({ error: "teamId required" });

    const result = await channelService.getChannels(teamId, session.user.id);
    if (result === "forbidden") return reply.status(403).send({ error: "Forbidden" });
    return reply.send({ channels: result });
  });

  // POST /v1/channels — create a channel (any team member)
  app.post("/channels", async (req, reply) => {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!session?.user) return reply.status(401).send({ error: "Unauthorized" });

    const parsed = createChannelSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid" });
    }

    const { teamId, name, description, members } = parsed.data;
    const result = await channelService.createChannel(
      teamId,
      session.user.id,
      name,
      description,
      members
    );
    if (result === "not-found") return reply.status(404).send({ error: "Team not found" });
    if (result === "forbidden") return reply.status(403).send({ error: "Forbidden" });
    if (result === "duplicate")
      return reply.status(409).send({ error: "Channel name already exists" });
    return reply.status(201).send({ channel: result });
  });

  // GET /v1/channels/:id/messages?teamId=&before=&limit=
  app.get("/channels/:id/messages", async (req, reply) => {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!session?.user) return reply.status(401).send({ error: "Unauthorized" });

    const { id } = req.params as { id: string };
    const { teamId, before, limit } = req.query as Record<string, string>;
    if (!teamId) return reply.status(400).send({ error: "teamId required" });

    const beforeDate = before ? new Date(before) : undefined;
    if (beforeDate !== undefined && isNaN(beforeDate.getTime())) {
      return reply.status(400).send({ error: "Invalid 'before' date" });
    }
    const parsedLimit = limit ? Math.min(parseInt(limit, 10) || 50, 100) : 50;

    const result = await channelService.getMessages(id, teamId, session.user.id, {
      before: beforeDate,
      limit: parsedLimit,
    });
    if (result === "forbidden") return reply.status(403).send({ error: "Forbidden" });
    return reply.send({ messages: result.messages, hasMore: result.hasMore });
  });

  // POST /v1/channels/:id/messages — send a message
  app.post("/channels/:id/messages", async (req, reply) => {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!session?.user) return reply.status(401).send({ error: "Unauthorized" });

    const { id } = req.params as { id: string };
    const parsed = sendMessageSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid" });
    }

    const { teamId, text } = parsed.data;
    const result = await channelService.sendMessage(id, teamId, session.user.id, text);
    if (result === "not-found") return reply.status(404).send({ error: "Not found" });
    if (result === "forbidden") return reply.status(403).send({ error: "Forbidden" });
    return reply.status(201).send({ message: result });
  });

  // GET /v1/channels/ws?channelId=&teamId=&token= — WebSocket stream
  app.get("/channels/ws", { websocket: true }, async (socket, req) => {
    const {
      token: queryToken,
      channelId,
      teamId,
    } = req.query as {
      token?: string;
      channelId?: string;
      teamId?: string;
    };

    const headers: Record<string, string> = { ...(req.headers as any) };
    if (queryToken) headers["authorization"] = `Bearer ${queryToken}`;
    const session = await auth.api.getSession({ headers });
    if (!session?.user) {
      socket.close(4001, "Unauthorized");
      return;
    }

    if (!channelId || !teamId) {
      socket.close(4000, "channelId and teamId required");
      return;
    }

    // Validate membership via service
    const channels = await channelService.getChannels(teamId, session.user.id);
    if (channels === "forbidden") {
      socket.close(4003, "Forbidden");
      return;
    }
    if (!channels.some((c) => c.id === channelId)) {
      socket.close(4003, "Forbidden");
      return;
    }

    const unsub = subscribeChannel(channelId, (msg) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
    });

    socket.on("close", unsub);
  });
}
