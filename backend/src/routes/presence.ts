import type { FastifyInstance } from "fastify";
import { verifyWsToken } from "../lib/ws-auth.js";
import { presenceService } from "../services/presence.service.js";

export async function presenceRoutes(app: FastifyInstance) {
  // GET /v1/presence/ws — WebSocket heartbeat channel.
  //
  // Protocol:
  //   • On connect: server marks the user online and sends the current online
  //     set for the user IDs the client wants to watch (passed as ?watch=id1,id2,...).
  //   • Client sends { type: "ping" } every 30 s to refresh the timeout.
  //   • Server broadcasts { type: "presence", userId, online: boolean } to all
  //     connected clients that are watching the affected userId.
  //   • On disconnect: user is marked offline after TIMEOUT_MS.
  app.get("/presence/ws", { websocket: true }, async (socket, req) => {
    const { token: queryToken, watch: watchParam } = req.query as {
      token?: string;
      watch?: string;
    };
    const rawToken = queryToken ?? req.headers["authorization"]?.replace(/^bearer /i, "");
    const wsUser = await verifyWsToken(rawToken);
    if (!wsUser) {
      socket.close(4001, "Unauthorized");
      return;
    }

    const userId = wsUser.id;
    const watchIds = watchParam ? watchParam.split(",").filter(Boolean) : [];

    // Mark this user as online
    presenceService.markOnline(userId);

    // Send initial snapshot — who among watchIds is currently online
    if (socket.readyState === socket.OPEN) {
      socket.send(
        JSON.stringify({
          type: "snapshot",
          online: [...presenceService.getOnlineSet(watchIds)],
        })
      );
    }

    // Subscribe to presence changes for the watched users
    const unsub = presenceService.subscribe((changedId, isOnline) => {
      if (!watchIds.includes(changedId)) return;
      if (socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify({ type: "presence", userId: changedId, online: isOnline }));
      }
    });

    // Client heartbeat
    socket.on("message", (raw: Buffer | string) => {
      try {
        const msg = JSON.parse(raw.toString()) as { type?: string };
        if (msg.type === "ping") presenceService.markOnline(userId);
      } catch {
        /* ignore malformed messages */
      }
    });

    socket.on("close", () => {
      unsub();
      presenceService.markOffline(userId);
    });
  });
}
