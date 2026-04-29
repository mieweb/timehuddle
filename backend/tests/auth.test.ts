import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { buildApp } from "../src/server.js";
import { connectDB, client } from "../src/lib/db.js";
import { auth } from "../src/lib/auth.js";

const TEST_USER = {
  name: "Test User",
  email: "vitest-user@example.com",
  password: "Password1!",
};

let app: FastifyInstance;
let sessionCookie: string;

beforeAll(async () => {
  await connectDB();
  app = await buildApp({ logger: false });
  await app.ready();

  // Remove leftovers from previous runs so sign-up always starts fresh
  const db = client.db();
  const existing = await db.collection("user").findOne({ email: TEST_USER.email });
  if (existing) {
    const userId = String(existing._id);
    await Promise.all([
      db.collection("account").deleteMany({ userId }),
      db.collection("session").deleteMany({ userId }),
      db.collection("user").deleteOne({ _id: existing._id }),
    ]);
  }

  // Use auth.api directly (same path as the seed script) — avoids the
  // reply.hijack() / inject incompatibility on the /api/auth/* routes.
  // Use asResponse: true to capture the real Set-Cookie values (the cookie
  // value includes a signature after the token, e.g. "token.hash=...")
  await auth.api.signUpEmail({ body: TEST_USER });
  const signInResponse = (await auth.api.signInEmail({
    body: { email: TEST_USER.email, password: TEST_USER.password },
    asResponse: true,
  })) as Response;

  // Extract name=value from each Set-Cookie header (strip attributes like Path, HttpOnly, etc.)
  const rawCookies = signInResponse.headers.getSetCookie?.() ?? [
    signInResponse.headers.get("set-cookie") ?? "",
  ];
  sessionCookie = rawCookies.map((c) => c.split(";")[0].trim()).join("; ");
}, 15000);

afterAll(async () => {
  await app.close();
});

describe("requireAuth middleware", () => {
  it("returns 401 when no session cookie is provided", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/me" });
    expect(res.statusCode).toBe(401);
  });

  it("passes through with a valid session cookie", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { cookie: sessionCookie },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe("GET /v1/me", () => {
  it("returns the authenticated user's data", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { cookie: sessionCookie },
    });

    const body = res.json();
    expect(body.user.email).toBe(TEST_USER.email);
    expect(body.user.name).toBe(TEST_USER.name);
  });
});

describe("auth.api (server-side)", () => {
  it("throws when signing in with the wrong password", async () => {
    await expect(
      auth.api.signInEmail({ body: { email: TEST_USER.email, password: "wrong!" } })
    ).rejects.toThrow();
  });
});
