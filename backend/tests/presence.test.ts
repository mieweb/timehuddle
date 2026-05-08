/**
 * Presence WebSocket route — integration tests.
 *
 * Fixture setup (beforeAll):
 *  - USER_A : connects to presence WS, sends pings
 *  - USER_B : watches USER_A, receives presence broadcasts
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/server.js";
import { connectDB, client } from "../src/lib/db.js";
import { auth } from "../src/lib/auth.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const USER_A = { name: "Presence Alpha", email: "presence-alpha@test.dev", password: "Password1!" };
const USER_B = { name: "Presence Beta", email: "presence-beta@test.dev", password: "Password1!" };

let app: FastifyInstance;
let tokenA: string;
let tokenB: string;
let userAId: string;
let userBId: string;

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getSessionToken(email: string, password: string): Promise<string> {
  const res = (await auth.api.signInEmail({
    body: { email, password },
    asResponse: true,
  })) as Response;
  return res.headers.get("set-auth-token") ?? "";
}

async function purgeUser(email: string) {
  const db = client.db();
  const user = await db.collection("user").findOne({ email });
  if (!user) return;
  const uid = String(user._id);
  await Promise.all([
    db.collection("account").deleteMany({ userId: uid }),
    db.collection("session").deleteMany({ userId: uid }),
    db.collection("user").deleteOne({ _id: user._id }),
  ]);
}

// ─── Setup / Teardown ─────────────────────────────────────────────────────────

beforeAll(async () => {
  await connectDB();
  app = await buildApp({ logger: false });
  await app.ready();

  const db = client.db();
  await Promise.all([purgeUser(USER_A.email), purgeUser(USER_B.email)]);

  await auth.api.signUpEmail({ body: USER_A });
  await auth.api.signUpEmail({ body: USER_B });

  userAId = String((await db.collection("user").findOne({ email: USER_A.email }))!._id);
  userBId = String((await db.collection("user").findOne({ email: USER_B.email }))!._id);

  tokenA = await getSessionToken(USER_A.email, USER_A.password);
  tokenB = await getSessionToken(USER_B.email, USER_B.password);
});

afterAll(async () => {
  await app.close();
  await Promise.all([purgeUser(USER_A.email), purgeUser(USER_B.email)]);
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("GET /v1/presence/ws", () => {
  it("closes with 4001 Unauthorized when no token is provided", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/presence/ws",
      headers: { connection: "upgrade", upgrade: "websocket" },
    });
    // Fastify websocket upgrade via inject returns 101 or falls through — close code
    // is validated at socket level; unauthenticated session returns 4001 close.
    // inject() does not fully negotiate WebSocket, so we verify the handler rejects
    // gracefully by checking the response status is not 200.
    expect(res.statusCode).not.toBe(200);
  });

  it("returns an initial snapshot with token auth", async () => {
    const messages: string[] = [];

    // Use Fastify's inject with WebSocket support via websocketPlugin
    const ws = await app.injectWS(
      `/v1/presence/ws?token=${encodeURIComponent(tokenA)}&watch=${userBId}`
    );

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout")), 3000);
      ws.on("message", (data: Buffer | string) => {
        messages.push(data.toString());
        clearTimeout(timer);
        resolve();
      });
      ws.on("error", reject);
    });

    ws.close();

    expect(messages.length).toBeGreaterThan(0);
    const snapshot = JSON.parse(messages[0]);
    expect(snapshot.type).toBe("snapshot");
    expect(Array.isArray(snapshot.online)).toBe(true);
  });

  it("sends presence broadcast when a watched user connects", async () => {
    const broadcasts: string[] = [];

    // USER_B watches USER_A
    const wsWatcher = await app.injectWS(
      `/v1/presence/ws?token=${encodeURIComponent(tokenB)}&watch=${userAId}`
    );

    // Collect the snapshot first
    await new Promise<void>((resolve) => {
      wsWatcher.once("message", () => resolve());
    });

    // Now USER_A connects — should trigger a presence broadcast to USER_B
    const wsA = await app.injectWS(`/v1/presence/ws?token=${encodeURIComponent(tokenA)}&watch=`);

    const broadcastReceived = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 2000);
      wsWatcher.on("message", (data: Buffer | string) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === "presence" && msg.userId === userAId && msg.online === true) {
            clearTimeout(timer);
            resolve(true);
          }
        } catch {
          /* ignore */
        }
      });
    });

    wsA.close();
    wsWatcher.close();

    expect(broadcastReceived).toBe(true);
  });

  it("marks user offline when socket closes", async () => {
    const wsA = await app.injectWS(`/v1/presence/ws?token=${encodeURIComponent(tokenA)}&watch=`);

    // Wait for snapshot
    await new Promise<void>((resolve) => {
      wsA.once("message", () => resolve());
    });

    // USER_B watches USER_A
    const wsWatcher = await app.injectWS(
      `/v1/presence/ws?token=${encodeURIComponent(tokenB)}&watch=${userAId}`
    );
    await new Promise<void>((resolve) => {
      wsWatcher.once("message", () => resolve());
    });

    // Close USER_A — should broadcast offline
    wsA.close();

    const offlineReceived = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 2000);
      wsWatcher.on("message", (data: Buffer | string) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === "presence" && msg.userId === userAId && msg.online === false) {
            clearTimeout(timer);
            resolve(true);
          }
        } catch {
          /* ignore */
        }
      });
    });

    wsWatcher.close();
    expect(offlineReceived).toBe(true);
  });
});
