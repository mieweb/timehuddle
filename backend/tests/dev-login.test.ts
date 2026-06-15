import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { connectDB } from "../src/lib/db.js";

vi.stubEnv("NODE_ENV", "production");

let app: FastifyInstance;

beforeAll(async () => {
  await connectDB();
  const { buildApp } = await import("../src/server.js");
  app = await buildApp({ logger: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  vi.unstubAllEnvs();
});

describe("dev auth route", () => {
  it("returns 404 in production", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/dev/member-sign-in",
      payload: { domain: "organization", role: "member", joinTeam: true },
    });

    expect(res.statusCode).toBe(404);
  });
});
