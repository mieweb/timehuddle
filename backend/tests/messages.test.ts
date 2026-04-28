/**
 * Messages routes — integration tests.
 *
 * Fixture setup (beforeAll):
 *  - ADMIN   : team admin (can message any member)
 *  - MEMBER  : team member (can message admins)
 *  - OTHER   : not in the team
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { ObjectId } from "mongodb";
import { buildApp } from "../src/server.js";
import { connectDB, client } from "../src/lib/db.js";
import { auth } from "../src/lib/auth.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ADMIN = { name: "Msg Admin", email: "msg-admin@test.dev", password: "Password1!" };
const MEMBER = { name: "Msg Member", email: "msg-member@test.dev", password: "Password1!" };
const OTHER = { name: "Msg Other", email: "msg-other@test.dev", password: "Password1!" };

let app: FastifyInstance;
let adminCookie: string;
let memberCookie: string;
let otherCookie: string;
let adminId: string;
let memberId: string;
let teamId: string;

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getSessionCookie(email: string, password: string): Promise<string> {
  const res = (await auth.api.signInEmail({
    body: { email, password },
    asResponse: true,
  })) as Response;
  const rawCookies = res.headers.getSetCookie?.() ?? [res.headers.get("set-cookie") ?? ""];
  return rawCookies.map((c) => c.split(";")[0].trim()).join("; ");
}

async function purgeUser(email: string) {
  const db = client.db();
  const user = await db.collection("user").findOne({ email });
  if (!user) return;
  const userId = String(user._id);
  await Promise.all([
    db.collection("account").deleteMany({ userId }),
    db.collection("session").deleteMany({ userId }),
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
    headers: { cookie },
    payload,
  });
}

// ─── Setup / Teardown ─────────────────────────────────────────────────────────

beforeAll(async () => {
  await connectDB();
  app = await buildApp({ logger: false });
  await app.ready();

  const db = client.db();
  await Promise.all([purgeUser(ADMIN.email), purgeUser(MEMBER.email), purgeUser(OTHER.email)]);

  await auth.api.signUpEmail({ body: ADMIN });
  await auth.api.signUpEmail({ body: MEMBER });
  await auth.api.signUpEmail({ body: OTHER });

  adminId = String((await db.collection("user").findOne({ email: ADMIN.email }))!._id);
  memberId = String((await db.collection("user").findOne({ email: MEMBER.email }))!._id);

  const teamDoc = {
    _id: new ObjectId(),
    name: "Msg Team",
    members: [memberId, adminId],
    admins: [adminId],
    code: "MSGTEAM001",
    isPersonal: false,
    createdAt: new Date(),
  };
  await db.collection("teams").insertOne(teamDoc);
  teamId = teamDoc._id.toHexString();

  adminCookie = await getSessionCookie(ADMIN.email, ADMIN.password);
  memberCookie = await getSessionCookie(MEMBER.email, MEMBER.password);
  otherCookie = await getSessionCookie(OTHER.email, OTHER.password);
}, 20000);

afterAll(async () => {
  const db = client.db();
  await db.collection("teams").deleteOne({ code: "MSGTEAM001" });
  await db.collection("messages").deleteMany({ teamId });
  await Promise.all([purgeUser(ADMIN.email), purgeUser(MEMBER.email), purgeUser(OTHER.email)]);
  await app.close();
});

// ─── Auth gates ───────────────────────────────────────────────────────────────

describe("auth gate", () => {
  it("GET /v1/messages — 401 without cookie", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/messages?teamId=abc&adminId=abc&memberId=abc`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("POST /v1/messages — 401 without cookie", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/messages",
      payload: { teamId: "abc", toUserId: "abc", text: "hi", adminId: "abc" },
    });
    expect(res.statusCode).toBe(401);
  });
});

// ─── POST /v1/messages ────────────────────────────────────────────────────────

describe("POST /v1/messages", () => {
  it("admin sends a message to member — 200", async () => {
    const res = await inject("POST", "/v1/messages", adminCookie, {
      teamId,
      toUserId: memberId,
      text: "Hello from admin",
      adminId,
    });
    expect(res.statusCode).toBe(200);
    const { message } = res.json();
    expect(message.fromUserId).toBe(adminId);
    expect(message.toUserId).toBe(memberId);
    expect(message.text).toBe("Hello from admin");
    expect(message.threadId).toBe(`${teamId}:${adminId}:${memberId}`);
  });

  it("member sends a message to admin — 200", async () => {
    const res = await inject("POST", "/v1/messages", memberCookie, {
      teamId,
      toUserId: adminId,
      text: "Hello from member",
      adminId,
    });
    expect(res.statusCode).toBe(200);
    const { message } = res.json();
    expect(message.fromUserId).toBe(memberId);
    expect(message.toUserId).toBe(adminId);
    expect(message.threadId).toBe(`${teamId}:${adminId}:${memberId}`);
  });

  it("outsider gets 403", async () => {
    const res = await inject("POST", "/v1/messages", otherCookie, {
      teamId,
      toUserId: memberId,
      text: "Sneaky",
      adminId,
    });
    expect(res.statusCode).toBe(403);
  });

  it("missing text returns 400", async () => {
    const res = await inject("POST", "/v1/messages", adminCookie, {
      teamId,
      toUserId: memberId,
      text: "   ",
      adminId,
    });
    expect(res.statusCode).toBe(400);
  });

  it("unknown team returns 404", async () => {
    const fakeTeamId = new ObjectId().toHexString();
    const res = await inject("POST", "/v1/messages", adminCookie, {
      teamId: fakeTeamId,
      toUserId: memberId,
      text: "Hello",
      adminId,
    });
    expect(res.statusCode).toBe(404);
  });
});

// ─── GET /v1/messages ─────────────────────────────────────────────────────────

describe("GET /v1/messages", () => {
  it("admin can fetch thread — 200, returns messages", async () => {
    const res = await inject(
      "GET",
      `/v1/messages?teamId=${teamId}&adminId=${adminId}&memberId=${memberId}`,
      adminCookie
    );
    expect(res.statusCode).toBe(200);
    const { messages } = res.json();
    expect(Array.isArray(messages)).toBe(true);
    expect(messages.length).toBeGreaterThanOrEqual(2);
  });

  it("member can fetch thread — 200", async () => {
    const res = await inject(
      "GET",
      `/v1/messages?teamId=${teamId}&adminId=${adminId}&memberId=${memberId}`,
      memberCookie
    );
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().messages)).toBe(true);
  });

  it("outsider gets 403", async () => {
    const res = await inject(
      "GET",
      `/v1/messages?teamId=${teamId}&adminId=${adminId}&memberId=${memberId}`,
      otherCookie
    );
    expect(res.statusCode).toBe(403);
  });

  it("missing params returns 400", async () => {
    const res = await inject("GET", `/v1/messages?teamId=${teamId}`, adminCookie);
    expect(res.statusCode).toBe(400);
  });
});
