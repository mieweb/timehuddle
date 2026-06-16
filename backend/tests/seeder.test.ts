import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/server.js";
import { auth } from "../src/lib/auth.js";
import { client, connectDB } from "../src/lib/db.js";
import {
  organizationsCollection,
  teamsCollection,
  ticketsCollection,
  usersCollection,
} from "../src/models/index.js";

// Load the same preset the SeederPage uses — this is the "shared code path".
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ORG_WITH_TEAM_YAML = readFileSync(
  join(__dirname, "../../src/features/seeder/presets/org-with-team.yaml"),
  "utf-8"
);

// Emails defined in the org-with-team preset
const DEMO_EMAILS = ["demo-owner@example.com", "demo-admin@example.com", "demo-member@example.com"];

const SEED_USER = {
  name: "Seed Import User",
  email: "seed-import-user@test.dev",
  password: "Password1!",
};

let app: FastifyInstance;
let sessionCookie: string;

async function getSessionCookie(email: string, password: string): Promise<string> {
  const res = (await auth.api.signInEmail({
    body: { email, password },
    asResponse: true,
  })) as Response;
  const rawCookies = res.headers.getSetCookie?.() ?? [res.headers.get("set-cookie") ?? ""];
  return rawCookies.map((c) => c.split(";")[0].trim()).join("; ");
}

beforeAll(async () => {
  await connectDB();
  app = await buildApp({ logger: false });
  await app.ready();

  const db = client.db();

  // Clean up preset data from any prior run
  await db.collection("user").deleteMany({ email: { $in: DEMO_EMAILS } });
  const org = await organizationsCollection().findOne({ slug: "demo-org" });
  if (org) {
    const team = await teamsCollection().findOne({
      orgId: org._id.toHexString(),
      code: "DEMO1234",
    });
    if (team) {
      await ticketsCollection().deleteMany({ teamId: team._id.toHexString() });
      await teamsCollection().deleteOne({ _id: team._id });
    }
    await organizationsCollection().deleteOne({ _id: org._id });
  }

  // Auth user for the test session
  const existing = await db.collection("user").findOne({ email: SEED_USER.email });
  if (existing) {
    const userId = String(existing._id);
    await Promise.all([
      db.collection("account").deleteMany({ userId }),
      db.collection("session").deleteMany({ userId }),
      db.collection("user").deleteOne({ _id: existing._id }),
    ]);
  }

  await auth.api.signUpEmail({ body: SEED_USER });
  sessionCookie = await getSessionCookie(SEED_USER.email, SEED_USER.password);
}, 60000);

afterAll(async () => {
  if (app) await app.close();
});

describe("dev seed import routes", () => {
  it("parses and imports the org-with-team preset", async () => {
    const parseRes = await app.inject({
      method: "POST",
      url: "/v1/dev/seed/import/parse",
      headers: { cookie: sessionCookie },
      payload: { yaml: ORG_WITH_TEAM_YAML },
    });
    expect(parseRes.statusCode).toBe(200);
    expect(parseRes.json().ok).toBe(true);

    const importRes = await app.inject({
      method: "POST",
      url: "/v1/dev/seed/import",
      headers: { cookie: sessionCookie },
      payload: { yaml: ORG_WITH_TEAM_YAML },
    });
    expect(importRes.statusCode).toBe(200);
    const body = importRes.json();
    expect(body.created.users).toBeGreaterThanOrEqual(1);
    expect(body.created.organizations).toBeGreaterThanOrEqual(1);
    expect(body.created.teams).toBeGreaterThanOrEqual(1);
    expect(body.created.tickets).toBeGreaterThanOrEqual(1);
    expect(body.summary).toContain("users");

    // Verify a known user from the preset exists in the DB
    const owner = await usersCollection().findOne({ email: "demo-owner@example.com" });
    expect(owner).not.toBeNull();
    expect(owner!.name).toBe("Demo Owner");
  });

  it("rejects malformed YAML", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/dev/seed/import/parse",
      headers: { cookie: sessionCookie },
      payload: { yaml: "users:\n  - email: broken@example.com\n    name: [unterminated" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(false);
  });

  it("returns 404 in production mode", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const res = await app.inject({
      method: "POST",
      url: "/v1/dev/seed/import",
      headers: { cookie: sessionCookie },
      payload: { yaml: "users: []" },
    });
    expect(res.statusCode).toBe(404);
    vi.unstubAllEnvs();
  });
});
