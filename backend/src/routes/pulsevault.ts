import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import pulseVault, {
  createLocalStorage,
  createMp4Sniffer,
  buildUploadLink,
} from "@mieweb/pulsevault";
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

async function authorizeHandler(request: any, ctx: any) {
  if (ctx.phase === "resolve") return; // playback is open
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(request.headers as Record<string, string | string[]>),
  });
  if (!session) {
    throw { statusCode: 401, message: "Unauthorized" };
  }
}

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
    decoratorName: "pulseVaultCompat",
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
            // Optional: client passes an existing videoid to re-register an in-progress
            // recording session (e.g. after PulseCam is closed and reopened).
            videoid: {
              type: "string",
              pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
            },
          },
        },
        response: {
          201: {
            type: "object",
            properties: {
              videoid: { type: "string" },
              uploadLink: { type: "string", description: "pulsecam:// deep link for QR pairing" },
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
      const { ticketId, videoid: existingVideoid } = req.body as {
        ticketId: string;
        videoid?: string;
      };
      const userId = req.user!.id;

      const ticket = await ticketService.findById(ticketId);
      if (!ticket) {
        return reply.status(404).send({ error: "Ticket not found" });
      }

      // Re-use a client-supplied videoid when the user is resuming a recording session
      // (e.g. PulseCam was closed before uploading and is now being reopened).
      // This keeps PulseCam's local segments associated with the same ticket.
      let videoid = existingVideoid ?? randomUUID();

      if (existingVideoid) {
        const alreadyReady = await storage.resolve(existingVideoid);
        if (alreadyReady) {
          // The previous upload completed — don't overwrite it; start fresh.
          videoid = randomUUID();
        } else {
          // No sidecar or a stale "uploading" entry — clear leftover partial
          // data so the TUS server can accept a new POST without 409.
          await storage.remove?.(existingVideoid);
        }
      }

      reserveVideo(videoid, ticketId, userId);

      const proto = (req.headers["x-forwarded-proto"] as string | undefined) ?? "http";
      const host =
        (req.headers["x-forwarded-host"] as string | undefined) ??
        (req.headers["host"] as string | undefined) ??
        "localhost:4000";
      const uploadLink = buildUploadLink({ server: `${proto}://${host}`, videoid });

      return reply.status(201).send({ videoid, uploadLink });
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
    decoratorName: "pulseVaultV1",
  });
}
