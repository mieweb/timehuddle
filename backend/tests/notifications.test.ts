/**
 * Notifications routes — integration tests.
 *
 * Fixture setup (beforeAll):
 *  - USER_A  : receives notifications, tests all CRUD ops
 *  - USER_B  : separate user — cannot access USER_A's notifications
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { ObjectId } from "mongodb";
import { buildApp } from "../src/server.js";
import { connectDB, client } from "../src/lib/db.js";
import { auth } from "../src/lib/auth.js";
import { notificationsCollection } from "../src/models/index.js";
import type { Notification } from "../src/models/notification.model.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const USER_A = { name: "Notif Alpha", email: "notif-alpha@test.dev", password: "Password1!" };
const USER_B = { name: "Notif Beta", email: "notif-beta@test.dev", password: "Password1!" };

let app: FastifyInstance;
let cookieA: string;
let cookieB: string;
let userAId: string;

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

async function seedNotification(userId: string, overrides: Partial<Notification> = {}) {
  const doc: Notification = {
    _id: new ObjectId(),
    userId,
    title: "Test notification",
    body: "Test body",
    read: false,
    createdAt: new Date(),
    ...overrides,
  };
  await notificationsCollection().insertOne(doc);
  return doc;
}

// ─── Setup / Teardown ─────────────────────────────────────────────────────────

beforeAll(async () => {
  await connectDB();
  app = await buildApp({ logger: false });

  // Sign up + get cookies
  for (const u of [USER_A, USER_B]) {
    await purgeUser(u.email);
    await auth.api.signUpEmail({ body: u });
  }
  cookieA = await getSessionCookie(USER_A.email, USER_A.password);
  cookieB = await getSessionCookie(USER_B.email, USER_B.password);

  const db = client.db();
  const userA = await db.collection("user").findOne({ email: USER_A.email });
  userAId = String(userA!._id);

  // Clean up any leftover notifications
  await notificationsCollection().deleteMany({ userId: userAId });
});

afterAll(async () => {
  await notificationsCollection().deleteMany({ userId: userAId });
  for (const u of [USER_A, USER_B]) await purgeUser(u.email);
  await app.close();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("GET /v1/notifications", () => {
  it("401 without auth", async () => {
    const res = await inject("GET", "/v1/notifications", "");
    expect(res.statusCode).toBe(401);
  });

  it("returns empty inbox", async () => {
    const res = await inject("GET", "/v1/notifications", cookieA);
    expect(res.statusCode).toBe(200);
    expect(res.json().notifications).toEqual([]);
  });

  it("returns notifications newest-first", async () => {
    const older = await seedNotification(userAId, { createdAt: new Date("2026-01-01T00:00:00Z") });
    const newer = await seedNotification(userAId, { createdAt: new Date("2026-06-01T00:00:00Z") });

    const res = await inject("GET", "/v1/notifications", cookieA);
    expect(res.statusCode).toBe(200);
    const ids = res.json().notifications.map((n: any) => n.id);
    expect(ids.indexOf(newer._id.toHexString())).toBeLessThan(ids.indexOf(older._id.toHexString()));

    await notificationsCollection().deleteMany({ _id: { $in: [older._id, newer._id] } });
  });
});

describe("PATCH /v1/notifications/:id/read", () => {
  it("401 without auth", async () => {
    const res = await inject("PATCH", `/v1/notifications/${new ObjectId()}/read`, "");
    expect(res.statusCode).toBe(401);
  });

  it("404 for unknown id", async () => {
    const res = await inject("PATCH", `/v1/notifications/${new ObjectId()}/read`, cookieA);
    expect(res.statusCode).toBe(404);
  });

  it("403 when notification belongs to another user", async () => {
    const n = await seedNotification(userAId);
    const res = await inject("PATCH", `/v1/notifications/${n._id.toHexString()}/read`, cookieB);
    expect(res.statusCode).toBe(403);
    await notificationsCollection().deleteOne({ _id: n._id });
  });

  it("marks a notification as read", async () => {
    const n = await seedNotification(userAId, { read: false });
    const res = await inject("PATCH", `/v1/notifications/${n._id.toHexString()}/read`, cookieA);
    expect(res.statusCode).toBe(200);
    const updated = await notificationsCollection().findOne({ _id: n._id });
    expect(updated?.read).toBe(true);
    await notificationsCollection().deleteOne({ _id: n._id });
  });
});

describe("POST /v1/notifications/read", () => {
  it("401 without auth", async () => {
    const res = await inject("POST", "/v1/notifications/read", "");
    expect(res.statusCode).toBe(401);
  });

  it("marks all notifications as read", async () => {
    const n1 = await seedNotification(userAId, { read: false });
    const n2 = await seedNotification(userAId, { read: false });

    const res = await inject("POST", "/v1/notifications/read", cookieA);
    expect(res.statusCode).toBe(200);

    const unread = await notificationsCollection()
      .find({ _id: { $in: [n1._id, n2._id] }, read: false })
      .toArray();
    expect(unread).toHaveLength(0);

    await notificationsCollection().deleteMany({ _id: { $in: [n1._id, n2._id] } });
  });
});

describe("DELETE /v1/notifications", () => {
  it("401 without auth", async () => {
    const res = await inject("DELETE", "/v1/notifications", "");
    expect(res.statusCode).toBe(401);
  });

  it("400 for empty ids array", async () => {
    const res = await inject("DELETE", "/v1/notifications", cookieA, { ids: [] });
    expect(res.statusCode).toBe(400);
  });

  it("deletes owned notifications", async () => {
    const n1 = await seedNotification(userAId);
    const n2 = await seedNotification(userAId);
    const ids = [n1._id.toHexString(), n2._id.toHexString()];

    const res = await inject("DELETE", "/v1/notifications", cookieA, { ids });
    expect(res.statusCode).toBe(200);
    expect(res.json().deletedCount).toBe(2);
  });

  it("does not delete notifications belonging to another user", async () => {
    const n = await seedNotification(userAId);
    const res = await inject("DELETE", "/v1/notifications", cookieB, {
      ids: [n._id.toHexString()],
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().deletedCount).toBe(0);
    await notificationsCollection().deleteOne({ _id: n._id });
  });
});

describe("GET /v1/notifications/:id/invite-preview", () => {
  it("401 without auth", async () => {
    const res = await inject("GET", `/v1/notifications/${new ObjectId()}/invite-preview`, "");
    expect(res.statusCode).toBe(401);
  });

  it("404 for unknown notification", async () => {
    const res = await inject("GET", `/v1/notifications/${new ObjectId()}/invite-preview`, cookieA);
    expect(res.statusCode).toBe(404);
  });

  it("400 if notification is not a team-invite", async () => {
    const n = await seedNotification(userAId, { data: { type: "message" } });
    const res = await inject(
      "GET",
      `/v1/notifications/${n._id.toHexString()}/invite-preview`,
      cookieA
    );
    expect(res.statusCode).toBe(400);
    await notificationsCollection().deleteOne({ _id: n._id });
  });

  it("403 for another user's notification", async () => {
    const n = await seedNotification(userAId, {
      data: { type: "team-invite", teamId: new ObjectId().toHexString() },
    });
    const res = await inject(
      "GET",
      `/v1/notifications/${n._id.toHexString()}/invite-preview`,
      cookieB
    );
    expect(res.statusCode).toBe(403);
    await notificationsCollection().deleteOne({ _id: n._id });
  });
});

describe("POST /v1/notifications/:id/invite-respond", () => {
  it("401 without auth", async () => {
    const res = await inject("POST", `/v1/notifications/${new ObjectId()}/invite-respond`, "");
    expect(res.statusCode).toBe(401);
  });

  it("404 for unknown notification", async () => {
    const res = await inject(
      "POST",
      `/v1/notifications/${new ObjectId()}/invite-respond`,
      cookieA,
      { action: "ignore" }
    );
    expect(res.statusCode).toBe(404);
  });

  it("400 for invalid action", async () => {
    const n = await seedNotification(userAId);
    const res = await inject(
      "POST",
      `/v1/notifications/${n._id.toHexString()}/invite-respond`,
      cookieA,
      { action: "maybe" }
    );
    expect(res.statusCode).toBe(400);
    await notificationsCollection().deleteOne({ _id: n._id });
  });

  it("ignore action deletes the notification", async () => {
    const n = await seedNotification(userAId, {
      data: { type: "team-invite", teamId: new ObjectId().toHexString() },
    });
    const res = await inject(
      "POST",
      `/v1/notifications/${n._id.toHexString()}/invite-respond`,
      cookieA,
      { action: "ignore" }
    );
    expect(res.statusCode).toBe(200);
    const still = await notificationsCollection().findOne({ _id: n._id });
    expect(still).toBeNull();
  });
});
