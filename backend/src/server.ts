import "dotenv/config";
import { fileURLToPath } from "url";
import path from "path";
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import multipart from "@fastify/multipart"; // Register Fastify multipart plugin for file uploads
import fastifyStatic from "@fastify/static";
import { connectDB } from "./lib/db.js";
import { ensureMongooseConnected } from "./lib/mongoose.js";
import { ensureIndexes } from "./lib/ensure-indexes.js";
import { auth } from "./lib/auth.js";
import { appContext } from "./middleware/app-context.js";
import { healthRoutes } from "./routes/health.js";
import { userRoutes } from "./routes/users.js";
import { orgRoutes } from "./routes/org.js";
import { ticketRoutes } from "./routes/tickets.js";
import { teamRoutes } from "./routes/teams.js";
import { clockRoutes } from "./routes/clock.js";
import { timerRoutes } from "./routes/timers.js";
import { notificationRoutes } from "./routes/notifications.js";
import { attachmentRoutes } from "./routes/attachments.js";
import { messageRoutes } from "./routes/messages.js";
import { activityRoutes } from "./routes/activity.js";
import { workRoutes } from "./routes/work.js";
import { pulseVaultRoutes, pulseVaultCompatRoutes } from "./routes/pulsevault.js";
import { presenceRoutes } from "./routes/presence.js";
import { channelRoutes } from "./routes/channels.js";
import { tokenRoutes } from "./routes/tokens.js";
import { startClockMonitor } from "./services/clock-monitor.service.js";

export async function buildApp(opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? true });
  const __dirname = path.dirname(fileURLToPath(import.meta.url));

  // Register multipart before routes and before Swagger
  await app.register(multipart, {
    limits: {
      fileSize: 10 * 1024 * 1024, // 10 MB
    },
  });

  // Swagger — must be registered before routes
  await app.register(swagger, {
    openapi: {
      info: {
        title: "Timecore API",
        description: "Shared backend API",
        version: "1.0.0",
      },
      servers: [
        { url: "https://timehubbackend.os.mieweb.org", description: "Production" },
        { url: `http://localhost:${process.env.PORT || 3001}`, description: "Local dev" },
      ],
      tags: [
        { name: "Health", description: "Health check endpoints" },
        {
          name: "Auth",
          description: "Better Auth endpoints (sign-up, sign-in, sign-out, session)",
        },
        { name: "Users", description: "User session and profile endpoints" },
        { name: "Teams", description: "Team management endpoints" },
        { name: "Tickets", description: "Ticket CRUD, timer, and admin endpoints" },
        {
          name: "Clock",
          description: "Clock in/out, ticket timers, timesheet, and SSE live stream",
        },
        {
          name: "Notifications",
          description: "User notification inbox, mark-read, delete, and SSE stream",
        },
        {
          name: "Attachments",
          description: "Generic media attachments for clock entries and tickets",
        },
        { name: "Messages", description: "Admin-member threaded messaging and SSE stream" },
        { name: "Activity", description: "Unified activity log for user and team events" },
      ],
      components: {
        securitySchemes: {
          cookieAuth: {
            type: "apiKey",
            in: "cookie",
            name: "better-auth.session_token",
          },
        },
      },
    },
  });

  await app.register(swaggerUi, {
    routePrefix: "/docs",
  });

  await app.register(cors, {
    origin: true,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    // Expose the bearer token header so Capacitor WebViews can read it after sign-in.
    exposedHeaders: ["set-auth-token"],
  });

  // Serve all uploaded files from backend/uploads/.
  await app.register(fastifyStatic, {
    root: path.resolve(__dirname, "..", "uploads"),
    prefix: "/uploads/",
    decorateReply: false,
  });

  await app.register(websocket);

  // Attach X-App-Id (timeharbor | timehuddle) to every request
  app.addHook("preHandler", appContext);

  // Better Auth handles all /api/auth/* routes.
  // We convert the Fastify request into a Web Request and pass it to
  // auth.handler directly, avoiding the body-stream issue that occurs
  // when using toNodeHandler (Fastify already consumes the body).

  // Accept application/x-www-form-urlencoded bodies (used by the OIDC token endpoint).
  // Return the raw string so betterAuthHandler can forward it as-is.
  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string" },
    (_req, body, done) => done(null, body)
  );

  async function betterAuthHandler(req: any, reply: any) {
    // Use the request URL as-is — better-auth's dynamic baseURL config
    // reads x-forwarded-host/proto headers to derive the correct origin.
    const url = `${process.env.BETTER_AUTH_URL || `http://localhost:${process.env.PORT || 3001}`}${req.url}`;
    const headers = new Headers();
    for (const [key, value] of Object.entries(
      req.headers as Record<string, string | string[] | undefined>
    )) {
      if (value !== undefined) {
        if (Array.isArray(value)) {
          value.forEach((v) => headers.append(key, v));
        } else {
          headers.set(key, value);
        }
      }
    }

    // Capacitor's native HTTP plugin may not send an Origin header.
    // Better Auth rejects requests with missing origin, so set a fallback.
    if (!headers.has("origin") || headers.get("origin") === "null") {
      headers.set("origin", "capacitor://localhost");
    }

    const hasBody = req.method !== "GET" && req.method !== "HEAD";
    const contentType = (req.headers["content-type"] as string | undefined) ?? "";
    // For URL-encoded bodies (OIDC token endpoint), forward the raw string as-is.
    // For everything else, forward as JSON (Fastify has already parsed the body).
    let body: string | undefined;
    if (hasBody) {
      if (contentType.includes("application/x-www-form-urlencoded")) {
        body = req.body as string;
      } else {
        body = JSON.stringify(req.body);
      }
    }
    const webRequest = new Request(url, {
      method: req.method,
      headers,
      body,
    });

    const response = await auth.handler(webRequest);

    reply.status(response.status);
    response.headers.forEach((value: string, key: string) => {
      // Skip CORS headers — @fastify/cors already sets them.
      // Forwarding better-auth's CORS headers too causes duplicate
      // Access-Control-Allow-Origin, which WKWebView rejects as "Load failed".
      if (key.toLowerCase().startsWith("access-control-")) return;
      reply.header(key, value);
    });

    const text = await response.text();
    reply.send(text);
  }

  // Catch-all for any auth route not explicitly listed below (hidden from docs)
  app.all("/api/auth/*", { schema: { hide: true } }, betterAuthHandler);

  // ── Documented Better Auth endpoints ────────────────────────────────
  app.post(
    "/api/auth/sign-up/email",
    {
      schema: {
        tags: ["Auth"],
        summary: "Sign up with email & password",
        body: {
          type: "object",
          required: ["email", "password", "name"],
          properties: {
            email: { type: "string", format: "email" },
            password: { type: "string", minLength: 8 },
            name: { type: "string" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              token: { type: "string" },
              user: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  email: { type: "string" },
                  name: { type: "string" },
                  emailVerified: { type: "boolean" },
                  createdAt: { type: "string", format: "date-time" },
                  updatedAt: { type: "string", format: "date-time" },
                },
              },
            },
          },
        },
      },
    },
    betterAuthHandler
  );

  app.post(
    "/api/auth/sign-in/email",
    {
      schema: {
        tags: ["Auth"],
        summary: "Sign in with email & password",
        body: {
          type: "object",
          required: ["email", "password"],
          properties: {
            email: { type: "string", format: "email" },
            password: { type: "string" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              token: { type: "string" },
              user: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  email: { type: "string" },
                  name: { type: "string" },
                  emailVerified: { type: "boolean" },
                },
              },
            },
          },
          401: {
            type: "object",
            properties: {
              message: { type: "string" },
            },
          },
        },
      },
    },
    betterAuthHandler
  );

  app.post(
    "/api/auth/sign-out",
    {
      schema: {
        tags: ["Auth"],
        summary: "Sign out (clear session cookie)",
        response: {
          200: {
            type: "object",
            properties: {
              success: { type: "boolean" },
            },
          },
        },
      },
    },
    betterAuthHandler
  );

  app.get(
    "/api/auth/get-session",
    {
      schema: {
        tags: ["Auth"],
        summary: "Get current session",
        description: "Returns the authenticated user and session. Requires a valid session cookie.",
        response: {
          200: {
            type: "object",
            properties: {
              session: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  userId: { type: "string" },
                  token: { type: "string" },
                  expiresAt: { type: "string", format: "date-time" },
                },
              },
              user: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  email: { type: "string" },
                  name: { type: "string" },
                  emailVerified: { type: "boolean" },
                },
              },
            },
          },
        },
      },
    },
    betterAuthHandler
  );

  app.post(
    "/api/auth/request-password-reset",
    {
      schema: {
        tags: ["Auth"],
        summary: "Request password reset email",
        body: {
          type: "object",
          required: ["email"],
          properties: {
            email: { type: "string", format: "email" },
            redirectTo: {
              type: "string",
              description: "URL to redirect to from the reset email link",
            },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              status: { type: "boolean" },
            },
          },
        },
      },
    },
    betterAuthHandler
  );

  app.post(
    "/api/auth/reset-password",
    {
      schema: {
        tags: ["Auth"],
        summary: "Reset password using token",
        body: {
          type: "object",
          required: ["token", "newPassword"],
          properties: {
            token: { type: "string" },
            newPassword: { type: "string", minLength: 8 },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              status: { type: "boolean" },
            },
          },
        },
      },
    },
    betterAuthHandler
  );

  app.post(
    "/api/auth/sign-in/social",
    {
      schema: {
        tags: ["Auth"],
        summary: "Initiate social OAuth sign-in",
        description:
          "Returns the OAuth provider URL to redirect to. The provider redirects back to /api/auth/callback/{provider}.",
        body: {
          type: "object",
          required: ["provider"],
          properties: {
            provider: { type: "string", enum: ["google", "github"] },
            callbackURL: {
              type: "string",
              description: "URL to redirect to after successful auth",
            },
          },
        },
        response: {
          200: {
            type: "object",
            properties: { url: { type: "string" }, redirect: { type: "boolean" } },
          },
        },
      },
    },
    betterAuthHandler
  );

  app.get(
    "/api/auth/callback/:provider",
    {
      schema: {
        tags: ["Auth"],
        summary: "OAuth callback",
        description:
          "Handles the redirect back from Google/GitHub after user authorises. Sets session cookie and redirects to callbackURL.",
        params: {
          type: "object",
          properties: {
            provider: { type: "string", enum: ["google", "github"] },
          },
        },
        response: {
          302: { type: "null", description: "Redirect to callbackURL with session cookie set" },
        },
      },
    },
    betterAuthHandler
  );

  app.get(
    "/api/auth/ok",
    {
      schema: {
        tags: ["Auth"],
        summary: "Health check for auth service",
        response: {
          200: {
            type: "object",
            properties: {
              ok: { type: "boolean" },
            },
          },
        },
      },
    },
    betterAuthHandler
  );

  // Health check
  await app.register(healthRoutes);

  // Validate WebSocket upgrade Origin to prevent cross-origin socket hijacking.
  // Capacitor native (capacitor://localhost) and local dev (null origin) are allowed.
  // TRUSTED_ORIGINS env var may include additional allowed origins (comma-separated).
  const trustedWsOrigins = new Set([
    "capacitor://localhost",
    ...(process.env.TRUSTED_ORIGINS
      ? process.env.TRUSTED_ORIGINS.split(",").map((o) => o.trim())
      : []),
    ...(process.env.APP_URL ? [new URL(process.env.APP_URL).origin] : []),
    `http://localhost:3000`,
    `http://localhost:${process.env.PORT || 4000}`,
  ]);
  app.addHook("preValidation", (req, reply, done) => {
    const upgrade = req.headers["upgrade"];
    if (!upgrade || upgrade.toLowerCase() !== "websocket") return done();
    const origin = req.headers["origin"];
    // Allow missing origin (same-origin Capacitor native, Vitest inject)
    if (!origin || origin === "null") return done();
    if (trustedWsOrigins.has(origin)) return done();
    reply.status(403).send({ error: "Forbidden origin" });
  });

  // App routes
  await app.register(userRoutes, { prefix: "/v1" });
  await app.register(orgRoutes, { prefix: "/v1" });
  await app.register(teamRoutes, { prefix: "/v1" });
  await app.register(ticketRoutes, { prefix: "/v1" });
  await app.register(clockRoutes, { prefix: "/v1" });
  await app.register(timerRoutes, { prefix: "/v1" });
  await app.register(notificationRoutes, { prefix: "/v1" });
  await app.register(attachmentRoutes, { prefix: "/v1" });
  await app.register(pulseVaultRoutes, { prefix: "/v1" });
  await app.register(messageRoutes, { prefix: "/v1" });
  await app.register(activityRoutes, { prefix: "/v1" });
  await app.register(workRoutes, { prefix: "/v1" });
  await app.register(presenceRoutes, { prefix: "/v1" });
  await app.register(channelRoutes, { prefix: "/v1" });
  await app.register(tokenRoutes, { prefix: "/v1" });

  // Compat: old Pulse Cam configs saved the bare server URL (http://host:4000) and call
  // POST /reserve, POST /upload, PATCH /upload/:id etc. at root level.
  await app.register(pulseVaultCompatRoutes);

  return app;
}

async function bootstrap() {
  await connectDB();
  await ensureMongooseConnected();
  await ensureIndexes();
  if (process.env.NODE_ENV !== "test") {
    startClockMonitor();
  }
  const app = await buildApp();
  const port = Number(process.env.PORT) || 4000;
  await app.listen({ port, host: "0.0.0.0" });
  console.log(`API running on http://localhost:${port}`);
  console.log(`Swagger UI at http://localhost:${port}/docs`);
}

// Only start the server when this file is run directly (not imported by tests)
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  bootstrap().catch(console.error);
}
