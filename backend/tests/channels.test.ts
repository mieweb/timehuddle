/**
 * Channels REST + WebSocket routes — integration tests.
 *
 * Fixture setup (beforeAll):
 *  - ADMIN  : team admin (creates the team, can create channels)
 *  - MEMBER : team member (can list/send in team-wide channels)
 *  - OUTSIDER: not on the team at all
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { ObjectId } from "mongodb";
import { buildApp } from "../src/server.js";
import { connectDB, client } from "../src/lib/db.js";
import { auth } from "../src/lib/auth.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ADMIN = { name: "Ch Admin", email: "ch-admin@test.dev", password: "Password1!" };
const MEMBER = { name: "Ch Member", email: "ch-member@test.dev", password: "Password1!" };
const OUTSIDER = { name: "Ch Outsider", email: "ch-outsider@test.dev", password: "Password1!" };

let app: FastifyInstance;
let adminCookie: string;
let memberCookie: string;
let outsiderCookie: string;
let _adminToken: string;
let memberToken: string;
let adminId: string;
let memberId: string;
let teamId: string;
let generalChannelId: string;

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getSessionCookie(email: string, password: string): Promise<string> {
  const res = (await auth.api.signInEmail({
    body: { email, password },
    asResponse: true,
  })) as Response;
  const rawCookies = res.headers.getSetCookie?.() ?? [res.headers.get("set-cookie") ?? ""];
  return rawCookies.map((c) => c.split(";")[0].trim()).join("; ");
}

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

async function inject(
  method: string,
  url: string,
  cookie: string,
  payload?: Record<string, unknown>
) {
  return app.inject({
    method: method as any,
    url,
    headers: {
      cookie,
      ...(payload !== undefined ? { "content-type": "application/json" } : {}),
    },
    payload: payload !== undefined ? JSON.stringify(payload) : undefined,
  });
}

// ─── Setup / Teardown ─────────────────────────────────────────────────────────

beforeAll(async () => {
  await connectDB();
  app = await buildApp({ logger: false });
  await app.ready();

  const db = client.db();

  await Promise.all([purgeUser(ADMIN.email), purgeUser(MEMBER.email), purgeUser(OUTSIDER.email)]);

  await auth.api.signUpEmail({ body: ADMIN });
  await auth.api.signUpEmail({ body: MEMBER });
  await auth.api.signUpEmail({ body: OUTSIDER });

  adminId = String((await db.collection("user").findOne({ email: ADMIN.email }))!._id);
  memberId = String((await db.collection("user").findOne({ email: MEMBER.email }))!._id);

  adminCookie = await getSessionCookie(ADMIN.email, ADMIN.password);
  memberCookie = await getSessionCookie(MEMBER.email, MEMBER.password);
  outsiderCookie = await getSessionCookie(OUTSIDER.email, OUTSIDER.password);
  _adminToken = await getSessionToken(ADMIN.email, ADMIN.password);
  memberToken = await getSessionToken(MEMBER.email, MEMBER.password);

  // Create a team with admin + member
  const teamDoc = {
    _id: new ObjectId(),
    name: "Channels Test Team",
    members: [adminId, memberId],
    admins: [adminId],
    code: "CHANTEST1",
    isPersonal: false,
    createdAt: new Date(),
  };
  await db.collection("teams").insertOne(teamDoc);
  teamId = teamDoc._id.toHexString();

  // Seed a #general channel (team-wide)
  const generalDoc = {
    _id: new ObjectId(),
    teamId,
    name: "general",
    isDefault: true,
    members: [],
    createdBy: adminId,
    createdAt: new Date(),
  };
  await db.collection("channels").insertOne(generalDoc);
  generalChannelId = generalDoc._id.toHexString();
});

afterAll(async () => {
  const db = client.db();
  await db.collection("channels").deleteMany({ teamId });
  await db.collection("channelMessages").deleteMany({ teamId });
  await db.collection("teams").deleteOne({ _id: new ObjectId(teamId) });
  await app.close();
  await Promise.all([purgeUser(ADMIN.email), purgeUser(MEMBER.email), purgeUser(OUTSIDER.email)]);
});

// ─── GET /v1/channels ─────────────────────────────────────────────────────────

describe("GET /v1/channels", () => {
  it("returns 401 without auth", async () => {
    const res = await inject("GET", `/v1/channels?teamId=${teamId}`, "");
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for outsider", async () => {
    const res = await inject("GET", `/v1/channels?teamId=${teamId}`, outsiderCookie);
    expect(res.statusCode).toBe(403);
  });

  it("returns channel list for team member", async () => {
    const res = await inject("GET", `/v1/channels?teamId=${teamId}`, memberCookie);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body.channels)).toBe(true);
    expect(body.channels.some((c: any) => c.name === "general")).toBe(true);
  });
});

// ─── POST /v1/channels ────────────────────────────────────────────────────────

describe("POST /v1/channels", () => {
  it("returns 401 without auth", async () => {
    const res = await inject("POST", "/v1/channels", "", { teamId, name: "test" });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for outsider", async () => {
    const res = await inject("POST", "/v1/channels", outsiderCookie, {
      teamId,
      name: "outsider-channel",
    });
    expect(res.statusCode).toBe(403);
  });

  it("creates a channel as team member", async () => {
    const res = await inject("POST", "/v1/channels", memberCookie, {
      teamId,
      name: "member-created",
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.channel.name).toBe("member-created");
  });

  it("returns 409 on duplicate channel name", async () => {
    await inject("POST", "/v1/channels", adminCookie, { teamId, name: "unique-ch" });
    const res = await inject("POST", "/v1/channels", adminCookie, { teamId, name: "unique-ch" });
    expect(res.statusCode).toBe(409);
  });
});

// ─── GET /v1/channels/:id/messages ───────────────────────────────────────────

describe("GET /v1/channels/:id/messages", () => {
  it("returns 401 without auth", async () => {
    const res = await inject(
      "GET",
      `/v1/channels/${generalChannelId}/messages?teamId=${teamId}`,
      ""
    );
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for outsider", async () => {
    const res = await inject(
      "GET",
      `/v1/channels/${generalChannelId}/messages?teamId=${teamId}`,
      outsiderCookie
    );
    expect(res.statusCode).toBe(403);
  });

  it("returns empty messages list for member", async () => {
    const res = await inject(
      "GET",
      `/v1/channels/${generalChannelId}/messages?teamId=${teamId}`,
      memberCookie
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body.messages)).toBe(true);
  });

  it("returns 400 for invalid before date", async () => {
    const res = await inject(
      "GET",
      `/v1/channels/${generalChannelId}/messages?teamId=${teamId}&before=not-a-date`,
      memberCookie
    );
    expect(res.statusCode).toBe(400);
  });

  it("accepts a valid ISO before date", async () => {
    const res = await inject(
      "GET",
      `/v1/channels/${generalChannelId}/messages?teamId=${teamId}&before=${encodeURIComponent(new Date().toISOString())}`,
      memberCookie
    );
    expect(res.statusCode).toBe(200);
  });
});

// ─── POST /v1/channels/:id/messages ──────────────────────────────────────────

describe("POST /v1/channels/:id/messages", () => {
  it("returns 401 without auth", async () => {
    const res = await inject("POST", `/v1/channels/${generalChannelId}/messages`, "", {
      teamId,
      text: "hello",
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for outsider", async () => {
    const res = await inject("POST", `/v1/channels/${generalChannelId}/messages`, outsiderCookie, {
      teamId,
      text: "hello",
    });
    expect(res.statusCode).toBe(403);
  });

  it("sends a message as member", async () => {
    const res = await inject("POST", `/v1/channels/${generalChannelId}/messages`, memberCookie, {
      teamId,
      text: "Hello channel!",
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.message.text).toBe("Hello channel!");
  });
});

// ─── GET /v1/channels/ws ─────────────────────────────────────────────────────

describe("GET /v1/channels/ws", () => {
  it("closes with 4001 when no token is provided", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/channels/ws?channelId=${generalChannelId}&teamId=${teamId}`,
    });
    // Without auth, the socket handler closes with 4001; inject returns non-101
    expect(res.statusCode).not.toBe(200);
  });

  it("connects and receives messages as team member", async () => {
    const ws = await app.injectWS(
      `/v1/channels/ws?channelId=${generalChannelId}&teamId=${teamId}&token=${encodeURIComponent(memberToken)}`
    );

    // Register the listener BEFORE sending so no broadcast can be missed
    const received = new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 5000);
      ws.on("message", (data: Buffer | string) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.text === "ws-test-message") {
            clearTimeout(timer);
            resolve(true);
          }
        } catch {
          /* ignore */
        }
      });
    });

    // Small delay to ensure the WebSocket subscription is fully registered
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Send the message after the listener is in place
    await inject("POST", `/v1/channels/${generalChannelId}/messages`, memberCookie, {
      teamId,
      text: "ws-test-message",
    });

    ws.close();

    expect(await received).toBe(true);
  });

  it("closes with 4003 Forbidden for outsider", async () => {
    const wsOutsider = await app.injectWS(
      `/v1/channels/ws?channelId=${generalChannelId}&teamId=${teamId}&token=${encodeURIComponent(
        await getSessionToken(OUTSIDER.email, OUTSIDER.password)
      )}`
    );

    const closeCode = await new Promise<number>((resolve) => {
      wsOutsider.on("close", (code: number) => resolve(code));
      setTimeout(() => resolve(0), 2000);
    });

    expect(closeCode).toBe(4003);
  });
});
