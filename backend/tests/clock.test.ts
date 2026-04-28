/**
 * Clock routes — integration tests.
 *
 * Fixture setup (beforeAll):
 *  - WORKER  : clocks in/out, owns the clock events
 *  - ADMIN   : team admin (can adjust times)
 *  - OTHER   : not in the team
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { ObjectId } from "mongodb";
import { buildApp } from "../src/server.js";
import { connectDB, client } from "../src/lib/db.js";
import { auth } from "../src/lib/auth.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const WORKER = { name: "Clock Worker", email: "clock-worker@test.dev", password: "Password1!" };
const ADMIN = { name: "Clock Admin", email: "clock-admin@test.dev", password: "Password1!" };
const OTHER = { name: "Clock Other", email: "clock-other@test.dev", password: "Password1!" };

let app: FastifyInstance;
let workerCookie: string;
let adminCookie: string;
let otherCookie: string;
let workerId: string;
let adminId: string;
let teamId: string;
let clockEventId: string;
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

  await Promise.all([purgeUser(WORKER.email), purgeUser(ADMIN.email), purgeUser(OTHER.email)]);

  await auth.api.signUpEmail({ body: WORKER });
  await auth.api.signUpEmail({ body: ADMIN });
  await auth.api.signUpEmail({ body: OTHER });

  workerId = String((await db.collection("user").findOne({ email: WORKER.email }))!._id);
  adminId = String((await db.collection("user").findOne({ email: ADMIN.email }))!._id);

  // Create test team
  const teamDoc = {
    _id: new ObjectId(),
    name: "Clock Team",
    members: [workerId, adminId],
    admins: [adminId],
    code: "CLOCKTEAM1",
    isPersonal: false,
    createdAt: new Date(),
  };
  await db.collection("teams").insertOne(teamDoc);
  teamId = teamDoc._id.toHexString();

  // Create a ticket for the worker to use
  const ticketDoc = {
    _id: new ObjectId(),
    teamId,
    title: "Clock Test Ticket",
    github: "",
    accumulatedTime: 0,
    status: "open",
    createdBy: workerId,
    assignedTo: workerId,
    createdAt: new Date(),
  };
  await db.collection("tickets").insertOne(ticketDoc);
  ticketId = ticketDoc._id.toHexString();

  workerCookie = await getSessionCookie(WORKER.email, WORKER.password);
  adminCookie = await getSessionCookie(ADMIN.email, ADMIN.password);
  otherCookie = await getSessionCookie(OTHER.email, OTHER.password);
}, 20000);

afterAll(async () => {
  const db = client.db();
  await db.collection("teams").deleteOne({ code: "CLOCKTEAM1" });
  await db.collection("clockevents").deleteMany({ teamId });
  await db.collection("tickets").deleteMany({ teamId });
  await Promise.all([purgeUser(WORKER.email), purgeUser(ADMIN.email), purgeUser(OTHER.email)]);
  await app.close();
});

// ─── Auth gates ───────────────────────────────────────────────────────────────

describe("auth gate", () => {
  it("POST /v1/clock/start — 401 without cookie", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/clock/start",
      payload: { teamId: "abc" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("POST /v1/clock/stop — 401 without cookie", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/clock/stop",
      payload: { teamId: "abc" },
    });
    expect(res.statusCode).toBe(401);
  });
});

// ─── POST /v1/clock/start ─────────────────────────────────────────────────────

describe("POST /v1/clock/start", () => {
  it("clocks in — 200, returns event", async () => {
    const res = await inject("POST", "/v1/clock/start", workerCookie, { teamId });
    expect(res.statusCode).toBe(200);
    const { event } = res.json();
    expect(event.userId).toBe(workerId);
    expect(event.teamId).toBe(teamId);
    expect(event.endTime).toBeNull();
    expect(typeof event.startTimestamp).toBe("number");
    clockEventId = event.id;
  });

  it("clocking in again closes the previous event and opens a new one", async () => {
    const res = await inject("POST", "/v1/clock/start", workerCookie, { teamId });
    expect(res.statusCode).toBe(200);
    const { event } = res.json();
    expect(event.id).not.toBe(clockEventId);
    clockEventId = event.id; // use the latest one
  });

  it("returns 403 when user is not a team member", async () => {
    const res = await inject("POST", "/v1/clock/start", otherCookie, { teamId });
    expect(res.statusCode).toBe(403);
  });
});

// ─── GET /v1/clock/active ─────────────────────────────────────────────────────

describe("GET /v1/clock/active", () => {
  it("returns the active event for worker — 200", async () => {
    const res = await inject("GET", "/v1/clock/active", workerCookie);
    expect(res.statusCode).toBe(200);
    const { event } = res.json();
    expect(event.id).toBe(clockEventId);
    expect(event.endTime).toBeNull();
  });

  it("returns null when user has no active event — 200", async () => {
    const res = await inject("GET", "/v1/clock/active", adminCookie);
    expect(res.statusCode).toBe(200);
    expect(res.json().event).toBeNull();
  });
});

// ─── POST /v1/clock/:id/ticket/start ─────────────────────────────────────────

describe("POST /v1/clock/:id/ticket/start", () => {
  it("adds a ticket to the active clock event — 200", async () => {
    const now = Date.now();
    const res = await inject("POST", `/v1/clock/${clockEventId}/ticket/start`, workerCookie, {
      ticketId,
      now,
    });
    expect(res.statusCode).toBe(200);
    const { event } = res.json();
    const entry = event.tickets.find((t: any) => t.ticketId === ticketId);
    expect(entry).toBeDefined();
    expect(entry.startTimestamp).toBe(now);
  });

  it("returns 404 for a non-existent clock event", async () => {
    const fakeId = new ObjectId().toHexString();
    const res = await inject("POST", `/v1/clock/${fakeId}/ticket/start`, workerCookie, {
      ticketId,
      now: Date.now(),
    });
    expect(res.statusCode).toBe(404);
  });
});

// ─── POST /v1/clock/:id/ticket/stop ──────────────────────────────────────────

describe("POST /v1/clock/:id/ticket/stop", () => {
  it("stops the running ticket timer — 200", async () => {
    const now = Date.now() + 5000;
    const res = await inject("POST", `/v1/clock/${clockEventId}/ticket/stop`, workerCookie, {
      ticketId,
      now,
    });
    expect(res.statusCode).toBe(200);
    const { event } = res.json();
    const entry = event.tickets.find((t: any) => t.ticketId === ticketId);
    expect(entry.startTimestamp).toBeNull();
    expect(entry.accumulatedTime).toBeGreaterThan(0);
  });
});

// ─── PUT /v1/clock/:id/youtube ────────────────────────────────────────────────

describe("PUT /v1/clock/:id/youtube", () => {
  it("sets the YouTube link — 200", async () => {
    const link = "https://youtube.com/shorts/abc123";
    const res = await inject("PUT", `/v1/clock/${clockEventId}/youtube`, workerCookie, {
      youtubeShortLink: link,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().event.youtubeShortLink).toBe(link);
  });

  it("returns 404 for unknown event", async () => {
    const fakeId = new ObjectId().toHexString();
    const res = await inject("PUT", `/v1/clock/${fakeId}/youtube`, workerCookie, {
      youtubeShortLink: "https://youtube.com/shorts/xyz",
    });
    expect(res.statusCode).toBe(404);
  });
});

// ─── POST /v1/clock/stop ──────────────────────────────────────────────────────

describe("POST /v1/clock/stop", () => {
  it("clocks out — 200, sets endTime", async () => {
    const res = await inject("POST", "/v1/clock/stop", workerCookie, { teamId });
    expect(res.statusCode).toBe(200);
    const { event } = res.json();
    expect(event.endTime).not.toBeNull();
    expect(event.accumulatedTime).toBeGreaterThanOrEqual(0);
  });

  it("returns 404 when already clocked out", async () => {
    const res = await inject("POST", "/v1/clock/stop", workerCookie, { teamId });
    expect(res.statusCode).toBe(404);
  });
});

// ─── GET /v1/clock/events ─────────────────────────────────────────────────────

describe("GET /v1/clock/events", () => {
  it("returns all events for the worker — 200", async () => {
    const res = await inject("GET", "/v1/clock/events", workerCookie);
    expect(res.statusCode).toBe(200);
    const { events } = res.json();
    expect(Array.isArray(events)).toBe(true);
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].userId).toBe(workerId);
  });
});

// ─── PUT /v1/clock/:id/times ─────────────────────────────────────────────────

describe("PUT /v1/clock/:id/times", () => {
  it("admin can adjust start time — 200", async () => {
    const newStart = Date.now() - 3600_000; // 1 hour ago
    const res = await inject("PUT", `/v1/clock/${clockEventId}/times`, adminCookie, {
      startTimestamp: newStart,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().event.startTimestamp).toBe(newStart);
  });

  it("non-admin returns 403", async () => {
    const res = await inject("PUT", `/v1/clock/${clockEventId}/times`, workerCookie, {
      startTimestamp: Date.now(),
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns 422 if endTimestamp < startTimestamp", async () => {
    const now = Date.now();
    const res = await inject("PUT", `/v1/clock/${clockEventId}/times`, adminCookie, {
      startTimestamp: now,
      endTimestamp: now - 1000,
    });
    expect(res.statusCode).toBe(422);
  });
});

// ─── GET /v1/clock/timesheet ─────────────────────────────────────────────────

describe("GET /v1/clock/timesheet", () => {
  it("worker can view their own timesheet — 200", async () => {
    const today = new Date().toISOString().split("T")[0];
    const res = await inject(
      "GET",
      `/v1/clock/timesheet?userId=${workerId}&startDate=${today}&endDate=${today}`,
      workerCookie
    );
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.sessions)).toBe(true);
    expect(body.summary).toBeDefined();
    expect(body.summary.totalSessions).toBeGreaterThan(0);
  });

  it("admin can view worker timesheet (shared team) — 200", async () => {
    const today = new Date().toISOString().split("T")[0];
    const res = await inject(
      "GET",
      `/v1/clock/timesheet?userId=${workerId}&startDate=${today}&endDate=${today}`,
      adminCookie
    );
    expect(res.statusCode).toBe(200);
  });

  it("other user gets 403", async () => {
    const today = new Date().toISOString().split("T")[0];
    const res = await inject(
      "GET",
      `/v1/clock/timesheet?userId=${workerId}&startDate=${today}&endDate=${today}`,
      otherCookie
    );
    expect(res.statusCode).toBe(403);
  });
});
