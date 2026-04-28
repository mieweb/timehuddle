/**
 * Ticket routes — integration tests.
 *
 * Test levels:
 *  1. Auth gate  — unauthenticated requests return 401
 *  2. Service    — TicketService methods tested via app.inject (exercising DB)
 *  3. REST       — full HTTP round-trips (status codes, response shapes, error cases)
 *
 * Fixture setup (beforeAll):
 *  - OWNER  : admin of the test team, creates most test tickets
 *  - MEMBER : regular team member
 *  - OUTSIDER: registered user, NOT in the team
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { ObjectId } from "mongodb";
import { buildApp } from "../src/server.js";
import { connectDB, client } from "../src/lib/db.js";
import { auth } from "../src/lib/auth.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const OWNER = { name: "Ticket Owner", email: "ticket-owner@test.dev", password: "Password1!" };
const MEMBER = { name: "Team Member", email: "ticket-member@test.dev", password: "Password1!" };
const OUTSIDER = { name: "Outsider", email: "ticket-outsider@test.dev", password: "Password1!" };

let app: FastifyInstance;
let ownerCookie: string;
let memberCookie: string;
let outsiderCookie: string;
let ownerId: string;
let memberId: string;
let outsiderId: string;
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

// ─── Setup / Teardown ─────────────────────────────────────────────────────────

beforeAll(async () => {
  await connectDB();
  app = await buildApp({ logger: false });
  await app.ready();

  const db = client.db();

  // Clean up any fixtures left from previous runs
  await Promise.all([purgeUser(OWNER.email), purgeUser(MEMBER.email), purgeUser(OUTSIDER.email)]);

  // Create users via auth API
  await auth.api.signUpEmail({ body: OWNER });
  await auth.api.signUpEmail({ body: MEMBER });
  await auth.api.signUpEmail({ body: OUTSIDER });

  // Fetch their IDs
  ownerId = String((await db.collection("user").findOne({ email: OWNER.email }))!._id);
  memberId = String((await db.collection("user").findOne({ email: MEMBER.email }))!._id);
  outsiderId = String((await db.collection("user").findOne({ email: OUTSIDER.email }))!._id);

  // Create a test team in timecore's teams collection
  const teamDoc = {
    _id: new ObjectId(),
    name: "Test Team",
    members: [ownerId, memberId],
    admins: [ownerId],
    code: "TESTCODE",
    createdAt: new Date(),
  };
  await db.collection("teams").insertOne(teamDoc);
  teamId = teamDoc._id.toHexString();

  // Get session cookies
  ownerCookie = await getSessionCookie(OWNER.email, OWNER.password);
  memberCookie = await getSessionCookie(MEMBER.email, MEMBER.password);
  outsiderCookie = await getSessionCookie(OUTSIDER.email, OUTSIDER.password);
}, 20000);

afterAll(async () => {
  const db = client.db();
  // Clean up all test data
  await db.collection("tickets").deleteMany({ teamId });
  await db.collection("teams").deleteOne({ _id: new ObjectId(teamId) });
  await Promise.all([purgeUser(OWNER.email), purgeUser(MEMBER.email), purgeUser(OUTSIDER.email)]);
  await app.close();
});

// ─── Auth Gate ────────────────────────────────────────────────────────────────

describe("auth gate", () => {
  it("GET /v1/tickets — 401 without cookie", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/tickets?teamId=${teamId}` });
    expect(res.statusCode).toBe(401);
  });

  it("POST /v1/tickets — 401 without cookie", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/tickets",
      payload: { teamId, title: "Test" },
    });
    expect(res.statusCode).toBe(401);
  });
});

// ─── Create ───────────────────────────────────────────────────────────────────

describe("POST /v1/tickets", () => {
  it("creates a ticket as a team member — 201", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/tickets",
      headers: { cookie: ownerCookie },
      payload: { teamId, title: "My first ticket", github: "", accumulatedTime: 0 },
    });
    expect(res.statusCode).toBe(201);
    const { ticket } = res.json();
    expect(ticket.id).toMatch(/^[0-9a-f]{24}$/);
    expect(ticket.title).toBe("My first ticket");
    expect(ticket.status).toBe("open");
    expect(ticket.createdBy).toBe(ownerId);
    expect(ticket.assignedTo).toBe(ownerId);
    expect(ticket.teamId).toBe(teamId);
  });

  it("creates a ticket as a regular member (not admin) — 201", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/tickets",
      headers: { cookie: memberCookie },
      payload: { teamId, title: "Member ticket", github: "https://github.com/org/repo/issues/1" },
    });
    expect(res.statusCode).toBe(201);
    const { ticket } = res.json();
    expect(ticket.createdBy).toBe(memberId);
  });

  it("rejects creation for a team the user is not in — 403", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/tickets",
      headers: { cookie: outsiderCookie },
      payload: { teamId, title: "Should fail" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("rejects a missing title — 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/tickets",
      headers: { cookie: ownerCookie },
      payload: { teamId },
    });
    expect(res.statusCode).toBe(400);
  });
});

// ─── List ─────────────────────────────────────────────────────────────────────

describe("GET /v1/tickets", () => {
  it("returns all non-deleted tickets for the team — 200", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/tickets?teamId=${teamId}`,
      headers: { cookie: ownerCookie },
    });
    expect(res.statusCode).toBe(200);
    const { tickets } = res.json();
    expect(Array.isArray(tickets)).toBe(true);
    expect(tickets.length).toBeGreaterThanOrEqual(1);
    expect(tickets.every((t: { status: string }) => t.status !== "deleted")).toBe(true);
  });

  it("allows a regular member to list — 200", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/tickets?teamId=${teamId}`,
      headers: { cookie: memberCookie },
    });
    expect(res.statusCode).toBe(200);
  });

  it("rejects outsider — 403", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/tickets?teamId=${teamId}`,
      headers: { cookie: outsiderCookie },
    });
    expect(res.statusCode).toBe(403);
  });

  it("requires teamId query param — 400", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/tickets",
      headers: { cookie: ownerCookie },
    });
    expect(res.statusCode).toBe(400);
  });
});

// ─── Update ───────────────────────────────────────────────────────────────────

describe("PUT /v1/tickets/:id", () => {
  let ticketId: string;

  beforeAll(async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/tickets",
      headers: { cookie: ownerCookie },
      payload: { teamId, title: "Update me" },
    });
    ticketId = res.json().ticket.id;
  });

  it("owner can update title — 200", async () => {
    const res = await app.inject({
      method: "PUT",
      url: `/v1/tickets/${ticketId}`,
      headers: { cookie: ownerCookie },
      payload: { title: "Updated title" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ticket.title).toBe("Updated title");
  });

  it("another team member cannot update — 403", async () => {
    const res = await app.inject({
      method: "PUT",
      url: `/v1/tickets/${ticketId}`,
      headers: { cookie: memberCookie },
      payload: { title: "Hijack" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns 404 for unknown id", async () => {
    const res = await app.inject({
      method: "PUT",
      url: `/v1/tickets/${new ObjectId().toHexString()}`,
      headers: { cookie: ownerCookie },
      payload: { title: "Ghost" },
    });
    expect(res.statusCode).toBe(404);
  });
});

// ─── Delete ───────────────────────────────────────────────────────────────────

describe("DELETE /v1/tickets/:id", () => {
  let ticketId: string;

  beforeAll(async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/tickets",
      headers: { cookie: ownerCookie },
      payload: { teamId, title: "Delete me" },
    });
    ticketId = res.json().ticket.id;
  });

  it("non-owner cannot delete — 403", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/tickets/${ticketId}`,
      headers: { cookie: memberCookie },
    });
    expect(res.statusCode).toBe(403);
  });

  it("owner can delete (soft) — 200", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/tickets/${ticketId}`,
      headers: { cookie: ownerCookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
  });

  it("deleted ticket does not appear in list", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/tickets?teamId=${teamId}`,
      headers: { cookie: ownerCookie },
    });
    const { tickets } = res.json();
    expect(tickets.find((t: { id: string }) => t.id === ticketId)).toBeUndefined();
  });
});

// ─── Timer ────────────────────────────────────────────────────────────────────

describe("ticket timer (start / stop)", () => {
  let ticketId: string;

  beforeAll(async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/tickets",
      headers: { cookie: ownerCookie },
      payload: { teamId, title: "Timer ticket", accumulatedTime: 10 },
    });
    ticketId = res.json().ticket.id;
  });

  it("start sets startTimestamp — 200", async () => {
    const now = Date.now();
    const res = await app.inject({
      method: "POST",
      url: `/v1/tickets/${ticketId}/start`,
      headers: { cookie: ownerCookie },
      payload: { now },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ticket.startTimestamp).toBe(now);
  });

  it("non-owner cannot start timer — 403", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/tickets/${ticketId}/start`,
      headers: { cookie: memberCookie },
      payload: { now: Date.now() },
    });
    expect(res.statusCode).toBe(403);
  });

  it("stop accumulates elapsed time and clears startTimestamp — 200", async () => {
    // Simulate 30 seconds passing
    const startNow = Date.now() - 30_000;
    await app.inject({
      method: "POST",
      url: `/v1/tickets/${ticketId}/start`,
      headers: { cookie: ownerCookie },
      payload: { now: startNow },
    });

    const stopNow = startNow + 30_000;
    const res = await app.inject({
      method: "POST",
      url: `/v1/tickets/${ticketId}/stop`,
      headers: { cookie: ownerCookie },
      payload: { now: stopNow },
    });
    expect(res.statusCode).toBe(200);
    const { ticket } = res.json();
    // initial 10s + 30s elapsed = 40s
    expect(ticket.accumulatedTime).toBe(40);
    expect(ticket.startTimestamp).toBeNull();
  });
});

// ─── Batch Status ─────────────────────────────────────────────────────────────

describe("POST /v1/tickets/batch-status", () => {
  let id1: string;
  let id2: string;

  beforeAll(async () => {
    const [r1, r2] = await Promise.all([
      app.inject({
        method: "POST",
        url: "/v1/tickets",
        headers: { cookie: ownerCookie },
        payload: { teamId, title: "Batch A" },
      }),
      app.inject({
        method: "POST",
        url: "/v1/tickets",
        headers: { cookie: ownerCookie },
        payload: { teamId, title: "Batch B" },
      }),
    ]);
    id1 = r1.json().ticket.id;
    id2 = r2.json().ticket.id;
  });

  it("team admin can batch-update status — 200", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/tickets/batch-status",
      headers: { cookie: ownerCookie },
      payload: { ticketIds: [id1, id2], status: "reviewed", teamId },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().modified).toBe(2);
  });

  it("reviewed status sets reviewedBy on the ticket", async () => {
    const db = client.db();
    const ticket = await db.collection("tickets").findOne({ _id: new ObjectId(id1) });
    expect(ticket?.reviewedBy).toBe(ownerId);
    expect(ticket?.reviewedAt).toBeDefined();
  });

  it("non-admin member cannot batch-update — 403", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/tickets/batch-status",
      headers: { cookie: memberCookie },
      payload: { ticketIds: [id1], status: "open", teamId },
    });
    expect(res.statusCode).toBe(403);
  });

  it("outsider cannot batch-update — 403", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/tickets/batch-status",
      headers: { cookie: outsiderCookie },
      payload: { ticketIds: [id1], status: "open", teamId },
    });
    expect(res.statusCode).toBe(403);
  });
});

// ─── Assign ───────────────────────────────────────────────────────────────────

describe("PUT /v1/tickets/:id/assign", () => {
  let ticketId: string;

  beforeAll(async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/tickets",
      headers: { cookie: ownerCookie },
      payload: { teamId, title: "Assign me" },
    });
    ticketId = res.json().ticket.id;
  });

  it("admin can assign to a team member — 200", async () => {
    const res = await app.inject({
      method: "PUT",
      url: `/v1/tickets/${ticketId}/assign`,
      headers: { cookie: ownerCookie },
      payload: { assignedToUserId: memberId },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ticket.assignedTo).toBe(memberId);
  });

  it("admin can unassign (null) — 200", async () => {
    const res = await app.inject({
      method: "PUT",
      url: `/v1/tickets/${ticketId}/assign`,
      headers: { cookie: ownerCookie },
      payload: { assignedToUserId: null },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ticket.assignedTo).toBeNull();
  });

  it("assigning to outsider (not in team) — 422", async () => {
    const res = await app.inject({
      method: "PUT",
      url: `/v1/tickets/${ticketId}/assign`,
      headers: { cookie: ownerCookie },
      payload: { assignedToUserId: outsiderId },
    });
    expect(res.statusCode).toBe(422);
  });

  it("non-admin member cannot assign — 403", async () => {
    const res = await app.inject({
      method: "PUT",
      url: `/v1/tickets/${ticketId}/assign`,
      headers: { cookie: memberCookie },
      payload: { assignedToUserId: memberId },
    });
    expect(res.statusCode).toBe(403);
  });
});
