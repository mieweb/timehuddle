import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import pulseVault, {
  createLocalStorage,
  createMp4Sniffer,
  buildUploadLink,
} from "@mieweb/pulsevault";
import { requireAuth } from "../middleware/require-auth.js";
import { verifyWsToken } from "../lib/ws-auth.js";
import { mediaItemsCollection, teamsCollection } from "../models/index.js";
import { ticketService } from "../services/ticket.service.js";
import { attachmentService } from "../services/attachment.service.js";
import { mediaService } from "../services/media.service.js";
import {
  reserveVideo,
  reserveVideoForLibrary,
  getReservation,
  verifyReservationToken,
  consumeReservation,
} from "../services/video-reserve.service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, "../../data/videos");

type ReserveTarget = "ticket" | "library";
type ReserveRequestBody = {
  target?: ReserveTarget;
  ticketId?: string;
  videoid?: string;
};

function extractBearerToken(request: any): string | undefined {
  const authHeader = request.headers?.authorization;
  if (typeof authHeader !== "string") return undefined;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim();
}

function pulseVaultHttpError(statusCode: number, message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode });
}

async function resolveUploadedFilename(ctx: any): Promise<string> {
  const metadataFilename =
    ctx?.metadata?.filename ?? ctx?.meta?.filename ?? ctx?.upload?.metadata?.filename;

  if (typeof metadataFilename === "string" && metadataFilename.trim()) {
    return path.basename(metadataFilename.trim());
  }

  // Local Pulsevault storage writes original upload metadata to a sidecar.
  try {
    const sidecarPath = path.join(dataDir, ctx.videoid, ".pulsevault.json");
    const raw = await fs.readFile(sidecarPath, "utf8");
    const parsed = JSON.parse(raw) as { filename?: unknown };
    if (typeof parsed.filename === "string" && parsed.filename.trim()) {
      return path.basename(parsed.filename.trim());
    }
  } catch {
    // Ignore and fall back below.
  }

  return `${ctx.videoid}.mp4`;
}

function resolveUploadedTitle(filename: string, fallbackVideoid: string): string {
  const parsed = path.parse(filename).name.trim();
  const normalized = parsed.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  return normalized || `Video ${fallbackVideoid.slice(0, 8)}`;
}

// Shared storage instance — used by both the versioned and compat registrations.
const storage = createLocalStorage({ workspaceDir: dataDir });

async function authorizeHandler(request: any, ctx: any) {
  if (ctx.phase !== "resolve") {
    const bearerToken = extractBearerToken(request);
    if (bearerToken && verifyReservationToken(ctx.videoid, bearerToken)) {
      return;
    }
  }

  const bearerHeader = (request.headers as any)["authorization"] as string | undefined;
  const rawToken = bearerHeader?.replace(/^bearer /i, "");
  const wsUser = await verifyWsToken(rawToken);
  if (!wsUser) {
    throw pulseVaultHttpError(401, "Unauthorized");
  }

  if (ctx.phase === "resolve") {
    // Tighten playback visibility for media library videos to match
    // /v1/media/user/:userId shared-team gating.
    const mediaItem = await mediaItemsCollection().findOne({ videoid: ctx.videoid });
    if (mediaItem) {
      if (mediaItem.userId === wsUser.id) return;
      const sharedTeam = await teamsCollection().findOne({
        members: { $all: [wsUser.id, mediaItem.userId] },
        isPersonal: { $ne: true },
      });
      if (!sharedTeam) {
        throw pulseVaultHttpError(403, "Forbidden");
      }
    }
    // Non-media resolve paths still require auth; deeper per-entity auth can be
    // tightened in a follow-up without reopening public read access.
    return;
  }

  const reservation = getReservation(ctx.videoid);
  if (!reservation) {
    throw pulseVaultHttpError(403, "Video reservation required");
  }
  if (reservation.userId !== wsUser.id) {
    throw pulseVaultHttpError(403, "Forbidden");
  }
}

async function onUploadCompleteHandler(request: any, ctx: any) {
  const reservation = consumeReservation(ctx.videoid);
  if (!reservation) return;

  const filename = await resolveUploadedFilename(ctx);
  const title = resolveUploadedTitle(filename, ctx.videoid);

  const proto = (request.headers["x-forwarded-proto"] as string | undefined) ?? "http";
  const host =
    (request.headers["x-forwarded-host"] as string | undefined) ??
    (request.headers["host"] as string | undefined) ??
    "localhost:4000";
  const videoUrl = `${proto}://${host}/v1/video/${ctx.videoid}`;

  if (reservation.context.kind === "library") {
    await mediaService.create(reservation.userId, {
      type: "video",
      mimeType: "video/mp4",
      url: videoUrl,
      videoid: ctx.videoid,
      filename,
      size: ctx.size ?? 0,
      title,
    });
  } else {
    await attachmentService.create(
      reservation.userId,
      videoUrl,
      "video",
      { kind: "ticket", id: reservation.context.ticketId },
      { title }
    );
  }
}

async function createReserveResponse(
  req: any,
  userId: string,
  body: ReserveRequestBody
): Promise<{ videoid: string; uploadToken: string; uploadLink?: string }> {
  const target: ReserveTarget = body.target ?? "ticket";

  if (target === "library") {
    const videoid = randomUUID();
    const uploadToken = reserveVideoForLibrary(videoid, userId);

    // Generate uploadLink with proper protocol detection
    const betterAuthUrl = process.env.BETTER_AUTH_URL;
    const defaultProto = betterAuthUrl ? new URL(betterAuthUrl).protocol.replace(":", "") : "http";
    const proto = (req.headers["x-forwarded-proto"] as string | undefined) ?? defaultProto;
    const host =
      (req.headers["x-forwarded-host"] as string | undefined) ??
      (req.headers["host"] as string | undefined) ??
      "localhost:4000";
    const uploadLink = buildUploadLink({ server: `${proto}://${host}`, videoid });

    return { videoid, uploadToken, uploadLink };
  }

  if (!body.ticketId) {
    throw pulseVaultHttpError(400, "ticketId is required for ticket uploads");
  }

  const ticket = await ticketService.findById(body.ticketId);
  if (!ticket) {
    throw pulseVaultHttpError(404, "Ticket not found");
  }

  let videoid = body.videoid ?? randomUUID();

  if (body.videoid) {
    const alreadyReady = await storage.resolve(body.videoid);
    if (alreadyReady) {
      videoid = randomUUID();
    } else {
      await storage.remove?.(body.videoid);
    }
  }

  const uploadToken = reserveVideo(videoid, body.ticketId, userId);

  // Use BETTER_AUTH_URL's protocol if available (production), otherwise fall back to x-forwarded-proto or http
  const betterAuthUrl = process.env.BETTER_AUTH_URL;
  const defaultProto = betterAuthUrl ? new URL(betterAuthUrl).protocol.replace(":", "") : "http";

  const proto = (req.headers["x-forwarded-proto"] as string | undefined) ?? defaultProto;
  const host =
    (req.headers["x-forwarded-host"] as string | undefined) ??
    (req.headers["host"] as string | undefined) ??
    "localhost:4000";
  const uploadLink = buildUploadLink({ server: `${proto}://${host}`, videoid });

  return { videoid, uploadToken, uploadLink };
}

// Compat: old Pulse Cam configs that saved the bare server URL (http://host:4000) call
// POST /reserve, POST /upload, PATCH /upload/:id etc. at root level.
// Pulse Cam has no session — uploads at the compat path are unauthenticated.

async function openAuthorizeHandler(_request: any, ctx: any) {
  if (ctx.phase === "resolve") return; // playback always open
  // Allow unauthenticated uploads from Pulse Cam on the compat (root) path.
}

/**
 * Wraps `reply.raw.setHeader` so any `Location: http://…` written by the
 * underlying @tus/server (which bypasses Fastify's reply lifecycle by writing
 * straight to the Node response) is rewritten to `https://…` whenever the
 * client connected to our reverse proxy over TLS. Without this rewrite,
 * browsers served from an HTTPS frontend block the follow-up TUS PATCH as
 * Mixed Content.
 *
 * Registered as a `preHandler` hook on the scopes that mount pulsevault.
 */
async function rewriteRawLocationHeader(request: any, reply: any) {
  const forwardedProto =
    typeof request.headers["x-forwarded-proto"] === "string"
      ? (request.headers["x-forwarded-proto"] as string).split(",")[0]?.trim()
      : undefined;
  if (forwardedProto !== "https") return;

  const raw = reply.raw;
  const originalSetHeader = raw.setHeader.bind(raw);
  raw.setHeader = (name: string, value: any) => {
    if (
      typeof name === "string" &&
      name.toLowerCase() === "location" &&
      typeof value === "string" &&
      value.startsWith("http://")
    ) {
      return originalSetHeader(name, "https://" + value.slice("http://".length));
    }
    return originalSetHeader(name, value);
  };

  const fixLocationValue = (v: any) =>
    typeof v === "string" && v.startsWith("http://") ? "https://" + v.slice("http://".length) : v;

  const originalWriteHead = raw.writeHead.bind(raw);
  raw.writeHead = (statusCode: number, ...rest: any[]) => {
    // Node accepts writeHead(status, [name, value, ...]) — a flat array — as
    // well as writeHead(status, { name: value }) and writeHead(status, reason,
    // headers). srvx (used internally by @tus/server) emits the flat-array
    // form, so we must handle both shapes.
    for (const arg of rest) {
      if (!arg) continue;
      if (Array.isArray(arg)) {
        for (let i = 0; i + 1 < arg.length; i += 2) {
          if (typeof arg[i] === "string" && arg[i].toLowerCase() === "location") {
            arg[i + 1] = fixLocationValue(arg[i + 1]);
          }
        }
      } else if (typeof arg === "object") {
        for (const key of Object.keys(arg)) {
          if (key.toLowerCase() === "location") {
            arg[key] = fixLocationValue(arg[key]);
          }
        }
      }
    }
    return originalWriteHead(statusCode, ...rest);
  };
}

export async function pulseVaultCompatRoutes(app: FastifyInstance) {
  // /reserve at root — Pulse Cam calls this before each upload
  app.post("/reserve", async (_req, reply) => {
    return reply.status(200).send({ videoid: randomUUID() });
  });

  await app.register(async (scope) => {
    scope.addHook("preHandler", rewriteRawLocationHeader);
    await scope.register(pulseVault, {
      prefix: "",
      storage,
      maxUploadSize: 1 * 1024 * 1024 * 1024,
      allowedExtensions: [".mp4"],
      validatePayload: createMp4Sniffer(storage),
      authorize: openAuthorizeHandler,
      onUploadComplete: onUploadCompleteHandler,
      decoratorName: "pulseVaultCompat",
    });
  });
}

export async function pulseVaultRoutes(app: FastifyInstance) {
  // POST /v1/video/reserve — authenticated reserve endpoint for all app uploads.
  // target=ticket (default): requires ticketId and supports optional videoid for resume.
  // target=library: reserves a media-library upload id.
  app.post(
    "/video/reserve",
    {
      onRequest: [requireAuth],
      schema: {
        tags: ["Attachments"],
        summary: "Reserve a videoid for ticket or media-library TUS uploads",
        body: {
          type: "object",
          properties: {
            target: { type: "string", enum: ["ticket", "library"] },
            ticketId: { type: "string", pattern: "^[0-9a-f]{24}$" },
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
              uploadToken: { type: "string" },
              uploadLink: {
                type: "string",
                description: "pulsecam:// deep link for ticket upload pairing",
              },
            },
          },
          400: {
            type: "object",
            properties: { error: { type: "string" } },
          },
          404: {
            type: "object",
            properties: { error: { type: "string" } },
          },
        },
      },
    },
    async (req, reply) => {
      const reserved = await createReserveResponse(
        req,
        req.user!.id,
        (req.body ?? {}) as ReserveRequestBody
      );
      return reply.status(201).send(reserved);
    }
  );

  await app.register(async (scope) => {
    scope.addHook("preHandler", rewriteRawLocationHeader);
    await scope.register(pulseVault, {
      prefix: "/video",
      storage,
      maxUploadSize: 1 * 1024 * 1024 * 1024, // 1 GiB
      allowedExtensions: [".mp4"],
      validatePayload: createMp4Sniffer(storage),
      authorize: authorizeHandler,
      onUploadComplete: onUploadCompleteHandler,
      decoratorName: "pulseVaultV1",
    });
  });
}
