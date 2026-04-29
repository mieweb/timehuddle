import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FastifyInstance } from "fastify";
import { buildApp } from "../src/server.js";
import { connectDB } from "../src/lib/db.js";

let app: FastifyInstance;

beforeAll(async () => {
  await connectDB();
  app = await buildApp({ logger: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe("GET /health", () => {
  it("returns 200 with status ok", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("ok");
    expect(body.timestamp).toBeDefined();
  });
});
