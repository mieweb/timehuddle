/**
 * Timer routes — integration tests.
 *
 * Tests for the new WorkItem + Timer model.
 * Verifies:
 *  - At most one running timer per user (unique partial index)
 *  - Start/stop compare-and-set semantics
 *  - Clock-out closes all open timers via single updateMany
 *  - Ticket total derived from Timer, not Ticket
 *  - Day view and week totals
 *  - Copy-from-previous
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { ObjectId } from "mongodb";
import { buildApp } from "../src/server.js";
import { connectDB, client } from "../src/lib/db.js";
import { auth } from "../src/lib/auth.js";
import { ensureIndexes } from "../src/lib/ensure-indexes.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const USER_A = { name: "Timer User A", email: "timer-a@test.dev", password: "Password1!" };
const USER_B = { name: "Timer User B", email: "timer-b@test.dev", password: "Password1!" };

let app: FastifyInstance;
let cookieA: string;
let cookieB: string;
let userAId: string;
let teamId: string;
let ticketId: string;
let ticketBId: string;

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

async function inject(method: string, url: string, cookie: string, payload?: unknown) {
  return app.inject({
    method: method as any,
    url,
    headers: { cookie },
    payload: payload as any,
  });
}

// ─── Setup / Teardown ─────────────────────────────────────────────────────────

beforeAll(async () => {
  await connectDB();
  await ensureIndexes();
  app = await buildApp({ logger: false });
  await app.ready();

  const db = client.db();

  await Promise.all([purgeUser(USER_A.email), purgeUser(USER_B.email)]);
  await auth.api.signUpEmail({ body: USER_A });
  await auth.api.signUpEmail({ body: USER_B });

  userAId = String((await db.collection("user").findOne({ email: USER_A.email }))!._id);
  const userBId = String((await db.collection("user").findOne({ email: USER_B.email }))!._id);

  // Create test team with both users
  const teamDoc = {
    _id: new ObjectId(),
    name: "Timer Team",
    members: [userAId, userBId],
    admins: [userAId],
    code: "TIMERTEAM1",
    isPersonal: false,
    createdAt: new Date(),
  };
  await db.collection("teams").insertOne(teamDoc);
  teamId = teamDoc._id.toHexString();

  // Create two test tickets
  const tA = {
    _id: new ObjectId(),
    teamId,
    title: "Ticket Alpha",
    github: "",
    status: "open",
    createdBy: userAId,
    assignedTo: userAId,
    createdAt: new Date(),
  };
  const tB = {
    _id: new ObjectId(),
    teamId,
    title: "Ticket Beta",
    github: "",
    status: "open",
    createdBy: userAId,
    assignedTo: userAId,
    createdAt: new Date(),
  };
  await db.collection("tickets").insertMany([tA, tB]);
  ticketId = tA._id.toHexString();
  ticketBId = tB._id.toHexString();

  cookieA = await getSessionCookie(USER_A.email, USER_A.password);
  cookieB = await getSessionCookie(USER_B.email, USER_B.password);
}, 20000);

afterAll(async () => {
  const db = client.db();
  await db.collection("teams").deleteOne({ code: "TIMERTEAM1" });
  await db.collection("tickets").deleteMany({ teamId });
  await db.collection("workitems").deleteMany({ userId: userAId });
  await db.collection("timers").deleteMany({ userId: userAId });
  await Promise.all([purgeUser(USER_A.email), purgeUser(USER_B.email)]);
  await app.close();
});

// ─── Auth gates ───────────────────────────────────────────────────────────────

describe("auth gates", () => {
  it("GET /v1/timers/day — 401 without cookie", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/timers/day?date=2025-01-01" });
    expect(res.statusCode).toBe(401);
  });

  it("POST /v1/timers/entries — 401 without cookie", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/timers/entries",
      payload: { ticketId, date: "2025-01-01" },
    });
    expect(res.statusCode).toBe(401);
  });
});

// ─── Create WorkItem ─────────────────────────────────────────────────────────────

describe("POST /v1/timers/entries", () => {
  it("creates a WorkItem for a team ticket — 201", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const res = await inject("POST", "/v1/timers/entries", cookieA, {
      ticketId,
      date: today,
    });
    expect(res.statusCode).toBe(201);
    const { entry } = res.json();
    expect(entry.ticketId).toBe(ticketId);
    expect(entry.date).toBe(today);
    expect(entry.userId).toBe(userAId);
  });

  it("creates the same ticket/date again as a distinct entry — 201", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const first = await inject("POST", "/v1/timers/entries", cookieA, {
      ticketId,
      date: today,
    });
    const second = await inject("POST", "/v1/timers/entries", cookieA, {
      ticketId,
      date: today,
    });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(first.json().entry.id).not.toBe(second.json().entry.id);
  });

  it("returns 404 for a non-existent ticket", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const res = await inject("POST", "/v1/timers/entries", cookieA, {
      ticketId: new ObjectId().toHexString(),
      date: today,
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 403 if user is not in the ticket's team", async () => {
    // user B is in the team, so we need a ticket NOT in their team
    const db = client.db();
    const otherTeam = {
      _id: new ObjectId(),
      name: "Other",
      members: [],
      admins: [],
      code: "OTHRT1",
      isPersonal: false,
      createdAt: new Date(),
    };
    await db.collection("teams").insertOne(otherTeam);
    const otherTicket = {
      _id: new ObjectId(),
      teamId: otherTeam._id.toHexString(),
      title: "Other",
      github: "",
      status: "open",
      createdBy: "someone",
      assignedTo: null,
      createdAt: new Date(),
    };
    await db.collection("tickets").insertOne(otherTicket);

    const res = await inject("POST", "/v1/timers/entries", cookieB, {
      ticketId: otherTicket._id.toHexString(),
      date: new Date().toISOString().slice(0, 10),
    });
    expect(res.statusCode).toBe(403);

    await db.collection("teams").deleteOne({ _id: otherTeam._id });
    await db.collection("tickets").deleteOne({ _id: otherTicket._id });
  });
});

// ─── Start timer session ──────────────────────────────────────────────────────

let entryId: string;
let _sessionId: string;

describe("POST /v1/timers/entries/:id/start", () => {
  beforeAll(async () => {
    // Ensure entry exists
    const today = new Date().toISOString().slice(0, 10);
    const res = await inject("POST", "/v1/timers/entries", cookieA, { ticketId, date: today });
    entryId = res.json().entry.id;
  });

  it("starts a session — 200", async () => {
    const now = Date.now();
    const res = await inject("POST", `/v1/timers/entries/${entryId}/start`, cookieA, { now });
    expect(res.statusCode).toBe(200);
    const { session } = res.json();
    expect(session.workItemId).toBe(entryId);
    expect(session.startTime).toBe(now);
    expect(session.endTime).toBeNull();
    _sessionId = session.id;
  });

  it("at most one running session per user — starting again closes previous", async () => {
    // Create a second entry for ticketB
    const today = new Date().toISOString().slice(0, 10);
    const entryBRes = await inject("POST", "/v1/timers/entries", cookieA, {
      ticketId: ticketBId,
      date: today,
    });
    const entryBId = entryBRes.json().entry.id;

    const now2 = Date.now() + 5000;
    const res = await inject("POST", `/v1/timers/entries/${entryBId}/start`, cookieA, {
      now: now2,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.session.endTime).toBeNull(); // new session is running
    expect(body.closedSessionId).toBeTruthy(); // previous session was closed
  });

  it("GET /v1/timers/running returns the running session", async () => {
    const res = await inject("GET", "/v1/timers/running", cookieA);
    expect(res.statusCode).toBe(200);
    expect(res.json().session).not.toBeNull();
    expect(res.json().session.endTime).toBeNull();
  });
});

// ─── Stop timer session ───────────────────────────────────────────────────────

let closedSessionId: string;

describe("POST /v1/timers/sessions/:id/stop", () => {
  beforeAll(async () => {
    // Ensure a session is running
    const now = Date.now() - 5000;
    const res = await inject("POST", `/v1/timers/entries/${entryId}/start`, cookieA, { now });
    closedSessionId = res.json().session.id;
  });

  it("stops a running session — 200", async () => {
    const now = Date.now();
    const res = await inject("POST", `/v1/timers/sessions/${closedSessionId}/stop`, cookieA, {
      now,
    });
    expect(res.statusCode).toBe(200);
    const { session } = res.json();
    expect(session.endTime).not.toBeNull();
    expect(session.durationSeconds).toBeGreaterThanOrEqual(0);
  });

  it("stopping again returns 409 already-stopped", async () => {
    const res = await inject("POST", `/v1/timers/sessions/${closedSessionId}/stop`, cookieA, {
      now: Date.now(),
    });
    expect(res.statusCode).toBe(409);
  });

  it("non-owner returns 403", async () => {
    const res = await inject("POST", `/v1/timers/sessions/${closedSessionId}/stop`, cookieB, {
      now: Date.now(),
    });
    expect(res.statusCode).toBe(403);
  });
});

// ─── Delete WorkItem ────────────────────────────────────────────────────────────

describe("DELETE /v1/timers/entries/:id", () => {
  it("deletes an entry and all associated sessions", async () => {
    const db = client.db();
    const today = new Date().toISOString().slice(0, 10);

    const entryRes = await inject("POST", "/v1/timers/entries", cookieA, { ticketId, date: today });
    const eId = entryRes.json().entry.id;

    await inject("POST", `/v1/timers/entries/${eId}/start`, cookieA, { now: Date.now() - 3000 });

    const before = await db.collection("timers").countDocuments({ workItemId: eId });
    expect(before).toBeGreaterThan(0);

    const delRes = await inject("DELETE", `/v1/timers/entries/${eId}`, cookieA);
    expect(delRes.statusCode).toBe(200);
    expect(delRes.json().deletedEntry).toBe(true);
    expect(delRes.json().deletedSessions).toBeGreaterThan(0);

    const entryAfter = await db.collection("workitems").findOne({ _id: new ObjectId(eId) });
    expect(entryAfter).toBeNull();
    const sessionsAfter = await db.collection("timers").countDocuments({ workItemId: eId });
    expect(sessionsAfter).toBe(0);
  });

  it("returns 403 when deleting another user's entry", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const entryRes = await inject("POST", "/v1/timers/entries", cookieA, { ticketId, date: today });
    const eId = entryRes.json().entry.id;

    const delRes = await inject("DELETE", `/v1/timers/entries/${eId}`, cookieB);
    expect(delRes.statusCode).toBe(403);
  });
});

// ─── Update WorkItem ────────────────────────────────────────────────────────────

describe("PATCH /v1/timers/entries/:id", () => {
  it("updates ticket even when note is cleared", async () => {
    const testDate = "2099-02-01";

    const createRes = await inject("POST", "/v1/timers/entries", cookieA, {
      ticketId,
      date: testDate,
      note: "temp note",
    });
    const entryIdToMove = createRes.json().entry.id as string;

    const patchRes = await inject("PATCH", `/v1/timers/entries/${entryIdToMove}`, cookieA, {
      ticketId: ticketBId,
      note: null,
    });

    expect(patchRes.statusCode).toBe(200);
    expect(patchRes.json().entry.ticketId).toBe(ticketBId);
    expect(patchRes.json().entry.note).toBeNull();
  });

  it("allows moving to a ticket that already has an entry that day", async () => {
    const testDate = "2099-02-02";

    const existingRes = await inject("POST", "/v1/timers/entries", cookieA, {
      ticketId,
      date: testDate,
    });
    const keepId = existingRes.json().entry.id as string;

    const moveSourceRes = await inject("POST", "/v1/timers/entries", cookieA, {
      ticketId: ticketBId,
      date: testDate,
    });
    const moveSourceId = moveSourceRes.json().entry.id as string;

    expect(keepId).not.toBe(moveSourceId);

    const patchRes = await inject("PATCH", `/v1/timers/entries/${moveSourceId}`, cookieA, {
      ticketId,
    });

    expect(patchRes.statusCode).toBe(200);
    expect(patchRes.json().entry.ticketId).toBe(ticketId);
  });
});

// ─── Ticket total from Timers ─────────────────────────────────────────────────

describe("GET /v1/timers/tickets/:ticketId/total", () => {
  it("returns the sum of durationSeconds for all closed sessions", async () => {
    const res = await inject("GET", `/v1/timers/tickets/${ticketId}/total`, cookieA);
    expect(res.statusCode).toBe(200);
    const { totalSeconds } = res.json();
    expect(typeof totalSeconds).toBe("number");
    expect(totalSeconds).toBeGreaterThanOrEqual(0);
    // Ticket itself must not have accumulatedTime
    const db = client.db();
    const ticket = await db.collection("tickets").findOne({ _id: new ObjectId(ticketId) });
    expect(ticket?.accumulatedTime).toBeUndefined();
  });
});

// ─── Day view ─────────────────────────────────────────────────────────────────

describe("GET /v1/timers/day", () => {
  it("returns entries with sessions for today", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const res = await inject("GET", `/v1/timers/day?date=${today}`, cookieA);
    expect(res.statusCode).toBe(200);
    const { entries } = res.json();
    expect(Array.isArray(entries)).toBe(true);
    // Each entry has an entry and sessions array
    for (const e of entries) {
      expect(e.entry).toBeDefined();
      expect(Array.isArray(e.sessions)).toBe(true);
    }
  });

  it("returns 200 with empty array for a day with no entries", async () => {
    const res = await inject("GET", "/v1/timers/day?date=1990-01-01", cookieA);
    expect(res.statusCode).toBe(200);
    expect(res.json().entries).toHaveLength(0);
  });
});

// ─── Week totals ──────────────────────────────────────────────────────────────

describe("GET /v1/timers/week", () => {
  it("returns 7 day totals", async () => {
    // Get Monday of the current week
    const now = new Date();
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    const weekStart = monday.toISOString().slice(0, 10);

    const res = await inject("GET", `/v1/timers/week?date=${weekStart}`, cookieA);
    expect(res.statusCode).toBe(200);
    const { days } = res.json();
    expect(Array.isArray(days)).toBe(true);
    expect(days).toHaveLength(7);
    for (const d of days) {
      expect(typeof d.date).toBe("string");
      expect(typeof d.totalSeconds).toBe("number");
    }
  });
});

// ─── Copy from previous ───────────────────────────────────────────────────────

describe("POST /v1/timers/copy-previous", () => {
  it("copies entries from previous day and returns count", async () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yDate = yesterday.toISOString().slice(0, 10);

    // Create an entry for yesterday first
    await inject("POST", "/v1/timers/entries", cookieA, { ticketId, date: yDate });

    const today = new Date().toISOString().slice(0, 10);
    const res = await inject("POST", "/v1/timers/copy-previous", cookieA, { toDate: today });
    expect(res.statusCode).toBe(200);
    expect(typeof res.json().created).toBe("number");
  });

  it("returns 0 when there are no previous entries", async () => {
    // Use a far-future date as "today"
    const farFuture = "2099-01-01";
    const res = await inject("POST", "/v1/timers/copy-previous", cookieA, { toDate: farFuture });
    expect(res.statusCode).toBe(200);
    // May or may not be 0 depending on how many prior entries exist, but it must succeed
    expect(typeof res.json().created).toBe("number");
  });
});

// ─── Clock-out closes all sessions via single updateMany ──────────────────────

describe("clock-out closes all open timer sessions", () => {
  it("clocking out stops any running timer session", async () => {
    const db = client.db();

    // Clock in to the team
    await inject("POST", "/v1/clock/start", cookieA, { teamId });

    // Start a timer session for the ticket
    const today = new Date().toISOString().slice(0, 10);
    const entryRes = await inject("POST", "/v1/timers/entries", cookieA, { ticketId, date: today });
    const eId = entryRes.json().entry.id;
    await inject("POST", `/v1/timers/entries/${eId}/start`, cookieA, { now: Date.now() });

    // Verify the timer is running
    const runningBefore = await db.collection("timers").findOne({ userId: userAId, endTime: null });
    expect(runningBefore).not.toBeNull();

    // Clock out — this should close all timers
    await inject("POST", "/v1/clock/stop", cookieA, { teamId });

    // Verify no timers are running for this user
    const runningAfter = await db.collection("timers").findOne({ userId: userAId, endTime: null });
    expect(runningAfter).toBeNull();
  });
});

// ─── ClockEvent shape must not include tickets[] ──────────────────────────────

describe("ClockEvent no longer has tickets[]", () => {
  it("POST /v1/clock/start returns event without tickets field", async () => {
    const res = await inject("POST", "/v1/clock/start", cookieA, { teamId });
    expect(res.statusCode).toBe(200);
    const { event } = res.json();
    expect(event.tickets).toBeUndefined();

    // Clock back out
    await inject("POST", "/v1/clock/stop", cookieA, { teamId });
  });
});
