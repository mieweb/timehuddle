/**
 * Personal Access Token routes — integration tests.
 *
 * Covers:
 *   GET    /v1/me/tokens         — list tokens
 *   POST   /v1/me/tokens         — create token (returns raw once)
 *   DELETE /v1/me/tokens/:id     — revoke token
 *   requireAuth middleware        — Bearer PAT auth branch
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/server.js";
import { connectDB, client } from "../src/lib/db.js";
import { auth } from "../src/lib/auth.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ALICE = { name: "Tokens Alice", email: "tokens-alice@test.dev", password: "Password1!" };
const BOB = { name: "Tokens Bob", email: "tokens-bob@test.dev", password: "Password1!" };

let app: FastifyInstance;
let aliceCookie: string;
let bobCookie: string;
let aliceId: string;

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
    db.collection("personal_access_tokens").deleteMany({ userId }),
    db.collection("user").deleteOne({ _id: user._id }),
  ]);
}

// ─── Setup / Teardown ─────────────────────────────────────────────────────────

beforeAll(async () => {
  await connectDB();
  app = await buildApp({ logger: false });
  await app.ready();

  await Promise.all([purgeUser(ALICE.email), purgeUser(BOB.email)]);

  await auth.api.signUpEmail({ body: ALICE });
  await auth.api.signUpEmail({ body: BOB });

  aliceId = String((await client.db().collection("user").findOne({ email: ALICE.email }))!._id);

  aliceCookie = await getSessionCookie(ALICE.email, ALICE.password);
  bobCookie = await getSessionCookie(BOB.email, BOB.password);
}, 20000);

afterAll(async () => {
  await Promise.all([purgeUser(ALICE.email), purgeUser(BOB.email)]);
  await app.close();
});

// ─── GET /v1/me/tokens ────────────────────────────────────────────────────────

describe("GET /v1/me/tokens", () => {
  it("returns 401 without auth", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/me/tokens" });
    expect(res.statusCode).toBe(401);
  });

  it("returns an empty list initially", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/me/tokens",
      headers: { cookie: aliceCookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.tokens).toBeInstanceOf(Array);
    expect(body.tokens).toHaveLength(0);
  });
});

// ─── POST /v1/me/tokens ───────────────────────────────────────────────────────

describe("POST /v1/me/tokens", () => {
  it("returns 401 without auth", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/me/tokens",
      payload: { name: "CI Token" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 400 when name is empty", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/me/tokens",
      headers: { cookie: aliceCookie },
      payload: { name: "" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("creates a token and returns raw value once — 201", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/me/tokens",
      headers: { cookie: aliceCookie },
      payload: { name: "My CI Token" },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.token).toMatch(/^th_pat_/);
    expect(body.name).toBe("My CI Token");
  });

  it("stores only the hash — raw token not in DB", async () => {
    const createRes = await app.inject({
      method: "POST",
      url: "/v1/me/tokens",
      headers: { cookie: aliceCookie },
      payload: { name: "Hash Check Token" },
    });
    const { token } = createRes.json() as { token: string };

    const stored = await client
      .db()
      .collection("personal_access_tokens")
      .findOne({ userId: aliceId });

    expect(stored).not.toBeNull();
    // tokenHash should not equal raw token value
    expect(stored!.tokenHash).not.toBe(token);
    // tokenHash should look like a sha256 hex (64 chars)
    expect(stored!.tokenHash).toMatch(/^[0-9a-f]{64}$/);

    // Cleanup
    await client
      .db()
      .collection("personal_access_tokens")
      .deleteMany({ userId: aliceId, name: "Hash Check Token" });
  });
});

// ─── Auth via Bearer PAT ──────────────────────────────────────────────────────

describe("PAT Bearer auth via requireAuth middleware", () => {
  let rawToken: string;
  let tokenId: string;

  beforeAll(async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/me/tokens",
      headers: { cookie: aliceCookie },
      payload: { name: "Bearer Test Token" },
    });
    rawToken = res.json().token;

    const listRes = await app.inject({
      method: "GET",
      url: "/v1/me/tokens",
      headers: { cookie: aliceCookie },
    });
    const tokens = listRes.json().tokens as Array<{ _id: string; name: string }>;
    tokenId = tokens.find((t) => t.name === "Bearer Test Token")!._id;
  });

  afterAll(async () => {
    // Ensure cleanup even if revoke test is skipped
    await client
      .db()
      .collection("personal_access_tokens")
      .deleteMany({ userId: aliceId, name: "Bearer Test Token" });
  });

  it("authenticates via Bearer token — can GET /v1/me", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { authorization: `Bearer ${rawToken}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.email).toBe(ALICE.email);
  });

  it("accepts bearer (lowercase scheme) per RFC 7235", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { authorization: `bearer ${rawToken}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it("returns 401 for invalid token", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { authorization: "Bearer th_pat_invalid000000000000" },
    });
    expect(res.statusCode).toBe(401);
  });
});

// ─── DELETE /v1/me/tokens/:id ─────────────────────────────────────────────────

describe("DELETE /v1/me/tokens/:id", () => {
  let tokenId: string;
  let rawToken: string;

  beforeAll(async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/me/tokens",
      headers: { cookie: aliceCookie },
      payload: { name: "Revoke Test Token" },
    });
    rawToken = res.json().token;

    const listRes = await app.inject({
      method: "GET",
      url: "/v1/me/tokens",
      headers: { cookie: aliceCookie },
    });
    const tokens = listRes.json().tokens as Array<{ _id: string; name: string }>;
    tokenId = tokens.find((t) => t.name === "Revoke Test Token")!._id;
  });

  it("returns 401 without auth", async () => {
    const res = await app.inject({ method: "DELETE", url: `/v1/me/tokens/${tokenId}` });
    expect(res.statusCode).toBe(401);
  });

  it("returns 404 for invalid ObjectId", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/v1/me/tokens/not-an-id",
      headers: { cookie: aliceCookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it("prevents cross-user revocation — returns 404", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/me/tokens/${tokenId}`,
      headers: { cookie: bobCookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it("revokes own token — 200", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/me/tokens/${tokenId}`,
      headers: { cookie: aliceCookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(true);
  });

  it("revoked token returns 401 for Bearer auth", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { authorization: `Bearer ${rawToken}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 404 for already-revoked token", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/me/tokens/${tokenId}`,
      headers: { cookie: aliceCookie },
    });
    expect(res.statusCode).toBe(404);
  });
});
