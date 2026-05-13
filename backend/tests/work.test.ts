/**
 * Work routes — integration tests for GET /v1/work/summary/user/:userId
 *
 * Scenarios:
 *  1. Unauthenticated → 401
 *  2. User can view their own summary — returns items array
 *  3. Teammate can view another user's summary → 200
 *  4. Non-teammate (outsider) → 403
 *  5. Summary lists tickets worked on within the last 48 h
 *  6. User with no timers sees own empty summary → 200 []
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { ObjectId } from "mongodb";
import { buildApp } from "../src/server.js";
import { connectDB, client } from "../src/lib/db.js";
import { auth } from "../src/lib/auth.js";
import { ensureIndexes } from "../src/lib/ensure-indexes.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const OWNER = { name: "Work Owner", email: "work-owner@test.dev", password: "Password1!" };
const MEMBER = { name: "Work Member", email: "work-member@test.dev", password: "Password1!" };
const OUTSIDER = { name: "Work Outsider", email: "work-outsider@test.dev", password: "Password1!" };

let app: FastifyInstance;
let ownerCookie: string;
let memberCookie: string;
let outsiderCookie: string;
let ownerId: string;
let outsiderId: string;
let teamId: string;
let ticketId: string;

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

// ─── Setup / Teardown ─────────────────────────────────────────────────────────

beforeAll(async () => {
  await connectDB();
  await ensureIndexes();
  app = await buildApp({ logger: false });
  await app.ready();

  const db = client.db();

  await Promise.all([purgeUser(OWNER.email), purgeUser(MEMBER.email), purgeUser(OUTSIDER.email)]);
  await auth.api.signUpEmail({ body: OWNER });
  await auth.api.signUpEmail({ body: MEMBER });
  await auth.api.signUpEmail({ body: OUTSIDER });

  ownerId = String((await db.collection("user").findOne({ email: OWNER.email }))!._id);
  const memberId = String((await db.collection("user").findOne({ email: MEMBER.email }))!._id);
  outsiderId = String((await db.collection("user").findOne({ email: OUTSIDER.email }))!._id);

  ownerCookie = await getSessionCookie(OWNER.email, OWNER.password);
  memberCookie = await getSessionCookie(MEMBER.email, MEMBER.password);
  outsiderCookie = await getSessionCookie(OUTSIDER.email, OUTSIDER.password);

  // Create a non-personal team with owner (admin) + member — direct DB insert
  const teamDoc = {
    _id: new ObjectId(),
    name: "Work Summary Team",
    members: [ownerId, memberId],
    admins: [ownerId],
    code: "WORKSUMM",
    createdAt: new Date(),
  };
  await db.collection("teams").insertOne(teamDoc);
  teamId = teamDoc._id.toHexString();

  // Create a ticket owned by the owner
  const ticketDoc = {
    _id: new ObjectId(),
    teamId,
    title: "Work Summary Ticket",
    status: "open",
    priority: "medium",
    createdBy: ownerId,
    assignedTo: ownerId,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  await db.collection("tickets").insertOne(ticketDoc);
  ticketId = ticketDoc._id.toHexString();

  // Create a work item + completed timer in the last 48 h for the owner
  const workItemDoc = {
    _id: new ObjectId(),
    userId: ownerId,
    ticketId,
    date: new Date().toISOString().slice(0, 10),
    durationSeconds: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  await db.collection("workitems").insertOne(workItemDoc);

  const now = Date.now();
  await db.collection("timers").insertOne({
    _id: new ObjectId(),
    userId: ownerId,
    workItemId: workItemDoc._id.toHexString(),
    startTime: now - 30 * 60 * 1000, // 30 min ago
    endTime: now - 5 * 60 * 1000, // 5 min ago
    createdAt: new Date(),
  });
}, 20000);

afterAll(async () => {
  const db = client.db();
  await db.collection("timers").deleteMany({ userId: ownerId });
  await db.collection("workitems").deleteMany({ userId: ownerId });
  await db.collection("tickets").deleteMany({ teamId });
  await db.collection("teams").deleteOne({ _id: new ObjectId(teamId) });
  await Promise.all([purgeUser(OWNER.email), purgeUser(MEMBER.email), purgeUser(OUTSIDER.email)]);
  await app.close();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("GET /v1/work/summary/user/:userId", () => {
  it("unauthenticated → 401", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/work/summary/user/${ownerId}`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("owner can view their own summary — 200 with items array", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/work/summary/user/${ownerId}`,
      headers: { cookie: ownerCookie },
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().items)).toBe(true);
  });

  it("summary includes the ticket worked on in the last 48 h", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/work/summary/user/${ownerId}`,
      headers: { cookie: ownerCookie },
    });
    const items: { id: string; title: string }[] = res.json().items;
    const found = items.find((i) => i.id === ticketId);
    expect(found).toBeDefined();
    expect(found?.title).toBe("Work Summary Ticket");
  });

  it("teammate can view another user's summary — 200", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/work/summary/user/${ownerId}`,
      headers: { cookie: memberCookie },
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().items)).toBe(true);
  });

  it("outsider (no shared team) → 403", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/work/summary/user/${ownerId}`,
      headers: { cookie: outsiderCookie },
    });
    expect(res.statusCode).toBe(403);
  });

  it("user with no timers sees their own empty summary — 200 []", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/work/summary/user/${outsiderId}`,
      headers: { cookie: outsiderCookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().items).toEqual([]);
  });
});
