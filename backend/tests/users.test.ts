/**
 * Users routes — integration tests.
 *
 * Covers:
 *   GET  /v1/me
 *   GET  /v1/me/profile
 *   PUT  /v1/me/profile
 *   GET  /v1/users/:id  (team-scoped visibility)
 *   GET  /v1/users?ids=
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { ObjectId } from "mongodb";
import { buildApp } from "../src/server.js";
import { connectDB, client } from "../src/lib/db.js";
import { auth } from "../src/lib/auth.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ALICE = { name: "Users Alice", email: "users-alice@test.dev", password: "Password1!" };
const BOB = { name: "Users Bob", email: "users-bob@test.dev", password: "Password1!" };
// Carol has no shared team with Alice — used to test 403 enforcement
const CAROL = { name: "Users Carol", email: "users-carol@test.dev", password: "Password1!" };

let app: FastifyInstance;
let aliceCookie: string;
let carolCookie: string;
let aliceId: string;
let bobId: string;
let _carolId: string;
let sharedTeamId: string;

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

  await Promise.all([purgeUser(ALICE.email), purgeUser(BOB.email), purgeUser(CAROL.email)]);

  await auth.api.signUpEmail({ body: ALICE });
  await auth.api.signUpEmail({ body: BOB });
  await auth.api.signUpEmail({ body: CAROL });

  aliceId = String((await db.collection("user").findOne({ email: ALICE.email }))!._id);
  bobId = String((await db.collection("user").findOne({ email: BOB.email }))!._id);
  _carolId = String((await db.collection("user").findOne({ email: CAROL.email }))!._id);

  // Shared non-personal team: Alice + Bob are members, Carol is not
  const teamDoc = {
    _id: new ObjectId(),
    name: "Users Test Team",
    members: [aliceId, bobId],
    admins: [aliceId],
    code: "USERSTESTTEAM1",
    isPersonal: false,
    createdAt: new Date(),
  };
  await db.collection("teams").insertOne(teamDoc);
  sharedTeamId = teamDoc._id.toHexString();

  aliceCookie = await getSessionCookie(ALICE.email, ALICE.password);
  carolCookie = await getSessionCookie(CAROL.email, CAROL.password);
}, 20000);

afterAll(async () => {
  await client.db().collection("teams").deleteOne({ code: "USERSTESTTEAM1" });
  await Promise.all([purgeUser(ALICE.email), purgeUser(BOB.email), purgeUser(CAROL.email)]);
  await app.close();
});

// ─── GET /v1/me ───────────────────────────────────────────────────────────────

describe("GET /v1/me", () => {
  it("returns 401 without auth", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/me" });
    expect(res.statusCode).toBe(401);
  });

  it("returns session user data — 200", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { cookie: aliceCookie },
    });
    expect(res.statusCode).toBe(200);
    const { user } = res.json();
    expect(user.email).toBe(ALICE.email);
    expect(user.name).toBe(ALICE.name);
    expect(user.id).toBeDefined();
  });
});

// ─── GET /v1/me/profile ───────────────────────────────────────────────────────

describe("GET /v1/me/profile", () => {
  it("returns 401 without auth", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/me/profile" });
    expect(res.statusCode).toBe(401);
  });

  it("returns full DB profile — 200", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/me/profile",
      headers: { cookie: aliceCookie },
    });
    expect(res.statusCode).toBe(200);
    const { user } = res.json();
    expect(user.email).toBe(ALICE.email);
    expect(user.name).toBe(ALICE.name);
    expect(user.emailVerified).toBeDefined();
  });
});

// ─── PUT /v1/me/profile ───────────────────────────────────────────────────────

describe("PUT /v1/me/profile", () => {
  it("returns 401 without auth", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/v1/me/profile",
      payload: { name: "New Name" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("updates name — 200", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/v1/me/profile",
      headers: { cookie: aliceCookie },
      payload: { name: "Alice Updated" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.name).toBe("Alice Updated");
  });

  it("updates bio and website — 200", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/v1/me/profile",
      headers: { cookie: aliceCookie },
      payload: { bio: "Hello world", website: "https://example.com" },
    });
    expect(res.statusCode).toBe(200);
    const { user } = res.json();
    expect(user.bio).toBe("Hello world");
    expect(user.website).toBe("https://example.com");
  });

  it("rejects invalid website format — 400", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/v1/me/profile",
      headers: { cookie: aliceCookie },
      payload: { website: "not-a-url" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects empty name — 400", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/v1/me/profile",
      headers: { cookie: aliceCookie },
      payload: { name: "" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("strips unknown fields — 200 (Fastify removes additionalProperties silently)", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/v1/me/profile",
      headers: { cookie: aliceCookie },
      payload: { role: "admin" },
    });
    // Fastify strips unknown fields rather than rejecting; the request succeeds
    expect(res.statusCode).toBe(200);
    expect(res.json().user.role).toBeUndefined();
  });
});

// ─── GET /v1/users/:id ────────────────────────────────────────────────────────

describe("GET /v1/users/:id", () => {
  it("returns 401 without auth", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/users/${aliceId}` });
    expect(res.statusCode).toBe(401);
  });

  it("returns public profile — 200", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/users/${aliceId}`,
      headers: { cookie: aliceCookie },
    });
    expect(res.statusCode).toBe(200);
    const { user } = res.json();
    expect(user.id).toBe(aliceId);
    expect(user.name).toBeDefined();
    // email must NOT be exposed in the public profile
    expect(user.email).toBeUndefined();
  });

  it("returns 404 for unknown id", async () => {
    const unknownId = "000000000000000000000001";
    const res = await app.inject({
      method: "GET",
      url: `/v1/users/${unknownId}`,
      headers: { cookie: aliceCookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 400 for malformed id (schema validation)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/users/not-an-id",
      headers: { cookie: aliceCookie },
    });
    expect(res.statusCode).toBe(400);
  });

  it("owner can always view own profile — 200 with empty sharedTeams", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/users/${aliceId}`,
      headers: { cookie: aliceCookie },
    });
    expect(res.statusCode).toBe(200);
    const { user } = res.json();
    expect(user.id).toBe(aliceId);
    expect(user.sharedTeams).toEqual([]);
  });

  it("teammate gets 200 with sharedTeams populated", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/users/${bobId}`,
      headers: { cookie: aliceCookie },
    });
    expect(res.statusCode).toBe(200);
    const { user } = res.json();
    expect(user.id).toBe(bobId);
    expect(Array.isArray(user.sharedTeams)).toBe(true);
    expect(user.sharedTeams.length).toBeGreaterThan(0);
    const team = user.sharedTeams.find((t: any) => t.id === sharedTeamId);
    expect(team).toBeDefined();
    expect(team.name).toBe("Users Test Team");
    // Bob is not an admin of the team
    expect(team.isAdmin).toBe(false);
  });

  it("non-teammate gets 403 — no shared team", async () => {
    // Carol shares no team with Alice
    const res = await app.inject({
      method: "GET",
      url: `/v1/users/${aliceId}`,
      headers: { cookie: carolCookie },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("No shared team");
  });

  it("404 takes precedence over 403 for unknown user", async () => {
    const unknownId = "000000000000000000000099";
    const res = await app.inject({
      method: "GET",
      url: `/v1/users/${unknownId}`,
      headers: { cookie: carolCookie },
    });
    // Target doesn't exist → 404, not 403
    expect(res.statusCode).toBe(404);
  });
});

// ─── GET /v1/users?ids= ───────────────────────────────────────────────────────

describe("GET /v1/users", () => {
  it("returns 401 without auth", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/users?ids=${aliceId}` });
    expect(res.statusCode).toBe(401);
  });

  it("returns empty array when no ids param — 200", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/users",
      headers: { cookie: aliceCookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().users).toEqual([]);
  });

  it("returns matched users for valid ids — 200", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/users?ids=${aliceId},${bobId}`,
      headers: { cookie: aliceCookie },
    });
    expect(res.statusCode).toBe(200);
    const { users } = res.json();
    expect(users).toHaveLength(2);
    const ids = users.map((u: any) => u.id);
    expect(ids).toContain(aliceId);
    expect(ids).toContain(bobId);
  });

  it("silently ignores invalid ids in the batch — 200", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/users?ids=${aliceId},not-valid`,
      headers: { cookie: aliceCookie },
    });
    expect(res.statusCode).toBe(200);
    const { users } = res.json();
    expect(users).toHaveLength(1);
    expect(users[0].id).toBe(aliceId);
  });
});
