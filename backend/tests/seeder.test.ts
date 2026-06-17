import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/server.js";
import { auth } from "../src/lib/auth.js";
import { client, connectDB } from "../src/lib/db.js";
import { ObjectId } from "mongodb";
import {
  organizationsCollection,
  teamsCollection,
  ticketsCollection,
  usersCollection,
} from "../src/models/index.js";

// Load the same presets the SeederPage uses — this is the "shared code path".
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PRESETS_DIR = join(__dirname, "../../src/features/seeder/presets");

const ORG_WITH_TEAM_YAML = readFileSync(join(PRESETS_DIR, "org-with-team.yaml"), "utf-8");
const TEAM_ONLY_YAML = readFileSync(join(PRESETS_DIR, "team-only.yaml"), "utf-8");
const SINGLE_USER_YAML = readFileSync(join(PRESETS_DIR, "single-user.yaml"), "utf-8");

// Emails defined in the org-with-team preset
const DEMO_EMAILS = ["demo-owner@example.com", "demo-admin@example.com", "demo-member@example.com"];

// Emails defined in the team-only preset
const TEAM_ONLY_EMAILS = [
  "sarah-team-lead@example.com",
  "alex-developer@example.com",
  "jordan-designer@example.com",
  "casey-qa@example.com",
  "morgan-product@example.com",
];

// Emails defined in the single-user preset
const SINGLE_USER_EMAILS = ["quick-user@example.com", "quick-admin@example.com"];

const SEED_USER = {
  name: "Seed Import User",
  email: "seed-import-user@test.dev",
  password: "Password1!",
};

let app: FastifyInstance;
let sessionCookie: string;
let teamOnlyAnchorOrgId: string;

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

  // Clean up org-with-team preset data from any prior run
  await db.collection("user").deleteMany({ email: { $in: DEMO_EMAILS } });
  const demoOrg = await organizationsCollection().findOne({ slug: "demo-org" });
  if (demoOrg) {
    const demoTeam = await teamsCollection().findOne({
      orgId: demoOrg._id.toHexString(),
      code: "DEMO1234",
    });
    if (demoTeam) {
      await ticketsCollection().deleteMany({ teamId: demoTeam._id.toHexString() });
      await teamsCollection().deleteOne({ _id: demoTeam._id });
    }
    await organizationsCollection().deleteOne({ _id: demoOrg._id });
  }

  // Clean up team-only preset data from any prior run
  await db.collection("user").deleteMany({ email: { $in: TEAM_ONLY_EMAILS } });
  const dappTeams = await teamsCollection().find({ code: "DAPP1234" }).toArray();
  for (const t of dappTeams) {
    await ticketsCollection().deleteMany({ teamId: t._id.toHexString() });
  }
  await teamsCollection().deleteMany({ code: "DAPP1234" });
  await organizationsCollection().deleteMany({ slug: { $in: ["seeder-test-anchor-org"] } });

  // Create a stable anchor org that the team-only preset will attach its teams to
  const anchorOrgObjectId = new ObjectId();
  await organizationsCollection().insertOne({
    _id: anchorOrgObjectId,
    name: "Seeder Test Anchor Org",
    slug: "seeder-test-anchor-org",
    owners: [],
    admins: [],
    allowAutoJoin: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  teamOnlyAnchorOrgId = anchorOrgObjectId.toHexString();

  // Clean up single-user preset data from any prior run
  await db.collection("user").deleteMany({ email: { $in: SINGLE_USER_EMAILS } });

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

  it("imports the single-user preset and creates both accounts", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/dev/seed/import",
      headers: { cookie: sessionCookie },
      payload: { yaml: SINGLE_USER_YAML },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.created.users).toBe(2);
    expect(body.created.teams).toBe(0);
    expect(body.created.organizations).toBe(0);

    const quickUser = await usersCollection().findOne({ email: "quick-user@example.com" });
    expect(quickUser).not.toBeNull();
    expect(quickUser!.name).toBe("Quick User");
    expect(quickUser!.username).toBe("quick-user");

    const quickAdmin = await usersCollection().findOne({ email: "quick-admin@example.com" });
    expect(quickAdmin).not.toBeNull();
    expect(quickAdmin!.name).toBe("Quick Admin");
  });

  it("imports the team-only preset, attaching the team to the provided orgId", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/dev/seed/import",
      headers: { cookie: sessionCookie },
      payload: { yaml: TEAM_ONLY_YAML, orgId: teamOnlyAnchorOrgId },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.created.users).toBe(5);
    expect(body.created.organizations).toBe(0);
    expect(body.created.teams).toBe(1);
    expect(body.created.tickets).toBe(2);

    // Team must be attached to the anchor org, not a newly created one
    const team = await teamsCollection().findOne({ code: "DAPP1234" });
    expect(team).not.toBeNull();
    expect(team!.orgId).toBe(teamOnlyAnchorOrgId);

    // All 5 members must be in the team's members array
    expect(team!.members).toHaveLength(5);

    // Admins (sarah + alex) must also appear in members
    const sarah = await usersCollection().findOne({ email: "sarah-team-lead@example.com" });
    const alex = await usersCollection().findOne({ email: "alex-developer@example.com" });
    expect(team!.admins).toContain(sarah!._id.toHexString());
    expect(team!.admins).toContain(alex!._id.toHexString());
    expect(team!.members).toContain(sarah!._id.toHexString());
    expect(team!.members).toContain(alex!._id.toHexString());
  });
});
