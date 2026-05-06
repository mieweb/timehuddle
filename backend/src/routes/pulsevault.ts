import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import pulseVault, { createLocalStorage, createMp4Sniffer } from "@mieweb/pulsevault";
import { fromNodeHeaders } from "better-auth/node";
import { requireAuth } from "../middleware/require-auth.js";
import { auth } from "../lib/auth.js";
import { ticketService } from "../services/ticket.service.js";
import { attachmentService } from "../services/attachment.service.js";
import { reserveVideo, consumeReservation } from "../services/video-reserve.service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, "../../data/videos");

// Shared storage instance — used by both the versioned and compat registrations.
const storage = createLocalStorage({ workspaceDir: dataDir });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function authorizeHandler(request: any, ctx: any) {
  if (ctx.phase === "resolve") return;
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(request.headers as Record<string, string | string[]>),
  });
  if (!session) {
    throw Object.assign(new Error("Unauthorized"), { statusCode: 401 });
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function onUploadCompleteHandler(request: any, ctx: any) {
  const reservation = consumeReservation(ctx.videoid);
  if (!reservation) return;

  const proto = (request.headers["x-forwarded-proto"] as string | undefined) ?? "http";
  const host =
    (request.headers["x-forwarded-host"] as string | undefined) ??
    (request.headers["host"] as string | undefined) ??
    "localhost:4000";
  const videoUrl = `${proto}://${host}/v1/video/${ctx.videoid}`;

  await attachmentService.create(
    reservation.userId,
    videoUrl,
    "video",
    { kind: "ticket", id: reservation.ticketId },
    { title: `Video ${ctx.videoid.slice(0, 8)}` }
  );
}

// Compat: old Pulse Cam configs that saved the bare server URL (http://host:4000) call
// POST /reserve, POST /upload, PATCH /upload/:id etc. at root level.
// Pulse Cam has no session — uploads at the compat path are unauthenticated.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function openAuthorizeHandler(_request: any, ctx: any) {
  if (ctx.phase === "resolve") return; // playback always open
  // Allow unauthenticated uploads from Pulse Cam on the compat (root) path.
}

export async function pulseVaultCompatRoutes(app: FastifyInstance) {
  // /reserve at root — Pulse Cam calls this before each upload
  app.post("/reserve", async (_req, reply) => {
    return reply.status(200).send({ videoid: randomUUID() });
  });

  await app.register(pulseVault, {
    prefix: "",
    storage,
    maxUploadSize: 1 * 1024 * 1024 * 1024,
    allowedExtensions: [".mp4"],
    validatePayload: createMp4Sniffer(storage),
    authorize: openAuthorizeHandler,
    onUploadComplete: onUploadCompleteHandler,
  });
}

export async function pulseVaultRoutes(app: FastifyInstance) {
  // POST /v1/pulsevault/reserve — authenticated users reserve a videoid for a ticket.
  app.post(
    "/pulsevault/reserve",
    {
      onRequest: [requireAuth],
      schema: {
        tags: ["Attachments"],
        summary: "Reserve a videoid for a TUS video upload attached to a ticket",
        body: {
          type: "object",
          required: ["ticketId"],
          properties: {
            ticketId: { type: "string", pattern: "^[0-9a-f]{24}$" },
          },
        },
        response: {
          201: {
            type: "object",
            properties: {
              videoid: { type: "string" },
            },
          },
          404: {
            type: "object",
            properties: { error: { type: "string" } },
          },
        },
      },
    },
    async (req, reply) => {
      const { ticketId } = req.body as { ticketId: string };
      const userId = req.user!.id;

      const ticket = await ticketService.findById(ticketId);
      if (!ticket) {
        return reply.status(404).send({ error: "Ticket not found" });
      }

      const videoid = randomUUID();
      reserveVideo(videoid, ticketId, userId);
      return reply.status(201).send({ videoid });
    }
  );

  // POST /v1/video/reserve — Pulse Cam calls {server}/reserve before each upload.
  // Returns a fresh videoid. If a ticket reservation was already made via
  // /v1/pulsevault/reserve (per-ticket QR flow), onUploadComplete will pick it up.
  // Accept empty bodies — Pulse Cam may POST with no body but Content-Type: application/json.
  app.addContentTypeParser("application/json", { parseAs: "string" }, function (_req, body, done) {
    if (!body || (body as string).trim() === "") {
      done(null, {});
    } else {
      try {
        done(null, JSON.parse(body as string));
      } catch (err) {
        done(err as Error, undefined);
      }
    }
  });

  app.post(
    "/video/reserve",
    {
      schema: {
        tags: ["Attachments"],
        summary: "Pulse Cam: reserve a fresh videoid before TUS upload",
        response: {
          200: {
            type: "object",
            properties: { videoid: { type: "string" } },
          },
        },
      },
    },
    async (_req, reply) => {
      const videoid = randomUUID();
      return reply.status(200).send({ videoid });
    }
  );

  await app.register(pulseVault, {
    prefix: "/video",
    storage,
    maxUploadSize: 1 * 1024 * 1024 * 1024, // 1 GiB
    allowedExtensions: [".mp4"],
    validatePayload: createMp4Sniffer(storage),
    authorize: authorizeHandler,
    onUploadComplete: onUploadCompleteHandler,
  });
}
