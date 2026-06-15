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
const ORG_ADMIN = {
  name: "Org Admin",
  email: "ticket-org-admin@test.dev",
  password: "Password1!",
};
const ENTERPRISE_ADMIN = {
  name: "Enterprise Admin",
  email: "ticket-enterprise-admin@test.dev",
  password: "Password1!",
};

let app: FastifyInstance;
let ownerCookie: string;
let memberCookie: string;
let outsiderCookie: string;
let orgAdminCookie: string;
let enterpriseAdminCookie: string;
let ownerId: string;
let memberId: string;
let outsiderId: string;
let orgAdminId: string;
let enterpriseAdminId: string;
let teamId: string;
let orgId: string;
let enterpriseId: string;

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
  await Promise.all([
    purgeUser(OWNER.email),
    purgeUser(MEMBER.email),
    purgeUser(OUTSIDER.email),
    purgeUser(ORG_ADMIN.email),
    purgeUser(ENTERPRISE_ADMIN.email),
  ]);

  // Create users via auth API
  await auth.api.signUpEmail({ body: OWNER });
  await auth.api.signUpEmail({ body: MEMBER });
  await auth.api.signUpEmail({ body: OUTSIDER });
  await auth.api.signUpEmail({ body: ORG_ADMIN });
  await auth.api.signUpEmail({ body: ENTERPRISE_ADMIN });

  // Fetch their IDs
  ownerId = String((await db.collection("user").findOne({ email: OWNER.email }))!._id);
  memberId = String((await db.collection("user").findOne({ email: MEMBER.email }))!._id);
  outsiderId = String((await db.collection("user").findOne({ email: OUTSIDER.email }))!._id);
  orgAdminId = String((await db.collection("user").findOne({ email: ORG_ADMIN.email }))!._id);
  enterpriseAdminId = String(
    (await db.collection("user").findOne({ email: ENTERPRISE_ADMIN.email }))!._id
  );

  const enterpriseDoc = {
    _id: new ObjectId(),
    name: "Tickets Test Enterprise",
    slug: `tickets-test-enterprise-${Date.now()}`,
    owners: [],
    admins: [enterpriseAdminId],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  await db.collection("enterprises").insertOne(enterpriseDoc);
  enterpriseId = enterpriseDoc._id.toHexString();

  const orgDoc = {
    _id: new ObjectId(),
    enterpriseId,
    name: "Tickets Test Org",
    slug: `tickets-test-org-${Date.now()}`,
    key: `tickets-test-org-${Date.now()}`,
    owners: [],
    admins: [orgAdminId],
    createdAt: new Date(),
  };
  await db.collection("organizations").insertOne(orgDoc);
  orgId = orgDoc._id.toHexString();

  await db.collection("org_members").insertOne({
    _id: new ObjectId(),
    orgId,
    userId: orgAdminId,
    role: "admin",
    auto: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  // Create a test team in timecore's teams collection
  const teamDoc = {
    _id: new ObjectId(),
    orgId,
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
  orgAdminCookie = await getSessionCookie(ORG_ADMIN.email, ORG_ADMIN.password);
  enterpriseAdminCookie = await getSessionCookie(ENTERPRISE_ADMIN.email, ENTERPRISE_ADMIN.password);
}, 20000);

afterAll(async () => {
  const db = client.db();
  // Clean up all test data
  await db.collection("activities").deleteMany({ teamId });
  await db.collection("tickets").deleteMany({ teamId });
  await db.collection("teams").deleteOne({ _id: new ObjectId(teamId) });
  if (orgId) {
    await db.collection("org_members").deleteMany({ orgId });
    await db.collection("organizations").deleteOne({ _id: new ObjectId(orgId) });
  }
  if (enterpriseId) {
    await db.collection("enterprises").deleteOne({ _id: new ObjectId(enterpriseId) });
  }
  await Promise.all([
    purgeUser(OWNER.email),
    purgeUser(MEMBER.email),
    purgeUser(OUTSIDER.email),
    purgeUser(ORG_ADMIN.email),
    purgeUser(ENTERPRISE_ADMIN.email),
  ]);
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
  it("rejects missing teamId — 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/tickets",
      headers: { cookie: ownerCookie },
      payload: { title: "Missing team" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("creates a ticket as a team member — 201", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/tickets",
      headers: { cookie: ownerCookie },
      payload: { teamId, title: "My first ticket", github: "" },
    });
    expect(res.statusCode).toBe(201);
    const { ticket } = res.json();
    expect(ticket.id).toMatch(/^[0-9a-f]{24}$/);
    expect(ticket.title).toBe("My first ticket");
    expect(ticket.status).toBe("open");
    expect(ticket.createdBy).toBe(ownerId);
    expect(ticket.assignedTo).toEqual([ownerId]);
    expect(ticket.teamId).toBe(teamId);
    // Timer fields must NOT be present on ticket
    expect(ticket.accumulatedTime).toBeUndefined();
    expect(ticket.startTimestamp).toBeUndefined();
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

  it("another team member can update — 200", async () => {
    const res = await app.inject({
      method: "PUT",
      url: `/v1/tickets/${ticketId}`,
      headers: { cookie: memberCookie },
      payload: { title: "Hijack" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ticket.title).toBe("Hijack");
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

  it("same-team member can batch-update — 200", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/tickets/batch-status",
      headers: { cookie: memberCookie },
      payload: { ticketIds: [id1], status: "open", teamId },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().modified).toBe(1);
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
      payload: { assignedToUserIds: [memberId] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ticket.assignedTo).toEqual([memberId]);
  });

  it("admin can unassign (null) — 200", async () => {
    const res = await app.inject({
      method: "PUT",
      url: `/v1/tickets/${ticketId}/assign`,
      headers: { cookie: ownerCookie },
      payload: { assignedToUserIds: [] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ticket.assignedTo).toEqual([]);
  });

  it("assigning to outsider (not in team) — 422", async () => {
    const res = await app.inject({
      method: "PUT",
      url: `/v1/tickets/${ticketId}/assign`,
      headers: { cookie: ownerCookie },
      payload: { assignedToUserIds: [outsiderId] },
    });
    expect(res.statusCode).toBe(422);
  });

  it("same-team member can assign — 200", async () => {
    const res = await app.inject({
      method: "PUT",
      url: `/v1/tickets/${ticketId}/assign`,
      headers: { cookie: memberCookie },
      payload: { assignedToUserIds: [memberId] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ticket.assignedTo).toEqual([memberId]);
  });
});

describe("org admin outside team", () => {
  it("can list team tickets — 200", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/tickets?teamId=${teamId}`,
      headers: { cookie: orgAdminCookie },
    });
    expect(res.statusCode).toBe(200);
  });

  it("can update ticket fields — 200", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/v1/tickets",
      headers: { cookie: ownerCookie },
      payload: { teamId, title: "Org admin update target" },
    });
    const ticketId = createRes.json().ticket.id as string;

    const updateRes = await app.inject({
      method: "PUT",
      url: `/v1/tickets/${ticketId}`,
      headers: { cookie: orgAdminCookie },
      payload: { description: "Updated by org admin" },
    });
    expect(updateRes.statusCode).toBe(200);
    expect(updateRes.json().ticket.description).toBe("Updated by org admin");
  });

  it("can assign and batch-status — 200", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/v1/tickets",
      headers: { cookie: ownerCookie },
      payload: { teamId, title: "Org admin ops target" },
    });
    const ticketId = createRes.json().ticket.id as string;

    const assignRes = await app.inject({
      method: "PUT",
      url: `/v1/tickets/${ticketId}/assign`,
      headers: { cookie: orgAdminCookie },
      payload: { assignedToUserIds: [memberId] },
    });
    expect(assignRes.statusCode).toBe(200);

    const batchRes = await app.inject({
      method: "POST",
      url: "/v1/tickets/batch-status",
      headers: { cookie: orgAdminCookie },
      payload: { ticketIds: [ticketId], status: "blocked", teamId },
    });
    expect(batchRes.statusCode).toBe(200);
    expect(batchRes.json().modified).toBe(1);
  });

  it("can delete outside team — 200", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/v1/tickets",
      headers: { cookie: ownerCookie },
      payload: { teamId, title: "Org admin delete target" },
    });
    const ticketId = createRes.json().ticket.id as string;

    const deleteRes = await app.inject({
      method: "DELETE",
      url: `/v1/tickets/${ticketId}`,
      headers: { cookie: orgAdminCookie },
    });
    expect(deleteRes.statusCode).toBe(200);
    expect(deleteRes.json().ok).toBe(true);
  });
});

describe("enterprise admin outside org/team", () => {
  it("can list team tickets — 200", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/tickets?teamId=${teamId}`,
      headers: { cookie: enterpriseAdminCookie },
    });
    expect(res.statusCode).toBe(200);
  });

  it("can update and delete ticket fields — 200", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/v1/tickets",
      headers: { cookie: ownerCookie },
      payload: { teamId, title: "Enterprise admin target" },
    });
    const ticketId = createRes.json().ticket.id as string;

    const updateRes = await app.inject({
      method: "PUT",
      url: `/v1/tickets/${ticketId}`,
      headers: { cookie: enterpriseAdminCookie },
      payload: { description: "Updated by enterprise admin" },
    });
    expect(updateRes.statusCode).toBe(200);
    expect(updateRes.json().ticket.description).toBe("Updated by enterprise admin");

    const deleteRes = await app.inject({
      method: "DELETE",
      url: `/v1/tickets/${ticketId}`,
      headers: { cookie: enterpriseAdminCookie },
    });
    expect(deleteRes.statusCode).toBe(200);
    expect(deleteRes.json().ok).toBe(true);
  });
});

describe("ticket activity log emission", () => {
  it("records create, update, status, assign, delete, and batch status actions", async () => {
    const db = client.db();
    await db.collection("activities").deleteMany({ userId: ownerId, teamId });

    const createRes = await app.inject({
      method: "POST",
      url: "/v1/tickets",
      headers: { cookie: ownerCookie },
      payload: { teamId, title: "Activity ticket" },
    });
    expect(createRes.statusCode).toBe(201);
    const activityTicketId = createRes.json().ticket.id as string;

    const updateRes = await app.inject({
      method: "PUT",
      url: `/v1/tickets/${activityTicketId}`,
      headers: { cookie: ownerCookie },
      payload: { title: "Activity ticket updated" },
    });
    expect(updateRes.statusCode).toBe(200);

    const statusRes = await app.inject({
      method: "PATCH",
      url: `/v1/tickets/${activityTicketId}/status-priority`,
      headers: { cookie: ownerCookie },
      payload: { status: "reviewed", priority: "high" },
    });
    expect(statusRes.statusCode).toBe(200);

    const assignRes = await app.inject({
      method: "PUT",
      url: `/v1/tickets/${activityTicketId}/assign`,
      headers: { cookie: ownerCookie },
      payload: { assignedToUserIds: [memberId] },
    });
    expect(assignRes.statusCode).toBe(200);

    const batchCreateRes = await app.inject({
      method: "POST",
      url: "/v1/tickets",
      headers: { cookie: ownerCookie },
      payload: { teamId, title: "Batch activity ticket" },
    });
    expect(batchCreateRes.statusCode).toBe(201);
    const batchTicketId = batchCreateRes.json().ticket.id as string;

    const batchStatusRes = await app.inject({
      method: "POST",
      url: "/v1/tickets/batch-status",
      headers: { cookie: ownerCookie },
      payload: { ticketIds: [batchTicketId], status: "closed", teamId },
    });
    expect(batchStatusRes.statusCode).toBe(200);

    const deleteRes = await app.inject({
      method: "DELETE",
      url: `/v1/tickets/${activityTicketId}`,
      headers: { cookie: ownerCookie },
    });
    expect(deleteRes.statusCode).toBe(200);

    const activities = await db
      .collection("activities")
      .find({
        userId: ownerId,
        teamId,
        "payload.ticketId": { $in: [activityTicketId, batchTicketId] },
      })
      .toArray();

    expect(
      activities.some((a) => a.type === "ticket.created" && a.payload.ticketId === activityTicketId)
    ).toBe(true);
    expect(
      activities.some(
        (a) =>
          a.type === "ticket.updated" &&
          a.payload.action === "edited" &&
          a.payload.ticketId === activityTicketId
      )
    ).toBe(true);
    expect(
      activities.some(
        (a) =>
          a.type === "ticket.updated" &&
          a.payload.action === "status-priority-changed" &&
          a.payload.ticketId === activityTicketId
      )
    ).toBe(true);
    expect(
      activities.some(
        (a) =>
          a.type === "ticket.updated" &&
          a.payload.action === "assigned" &&
          a.payload.ticketId === activityTicketId
      )
    ).toBe(true);
    expect(
      activities.some(
        (a) =>
          a.type === "ticket.updated" &&
          a.payload.action === "deleted" &&
          a.payload.ticketId === activityTicketId
      )
    ).toBe(true);
    expect(
      activities.some(
        (a) =>
          a.type === "ticket.updated" &&
          a.payload.action === "batch-status-changed" &&
          a.payload.ticketId === batchTicketId
      )
    ).toBe(true);
  });
});
