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

const BUSINESS_ORG_YAML = readFileSync(join(PRESETS_DIR, "business-org.yaml"), "utf-8");
const TECH_TEAMS_YAML = readFileSync(join(PRESETS_DIR, "tech-teams.yaml"), "utf-8");
const SINGLE_USER_YAML = readFileSync(join(PRESETS_DIR, "single-user.yaml"), "utf-8");

// Emails defined in the business-org preset
const BUSINESS_ORG_EMAILS = [
  "diane-owner@example.com",
  "frank-cfo@example.com",
  "maya-marketing@example.com",
  "chris-content@example.com",
  "grace-accounting@example.com",
  "olivia-analyst@example.com",
  "hana-payroll@example.com",
];

// Emails defined in the tech-teams preset
const TECH_TEAMS_EMAILS = [
  "sam-dev@example.com",
  "dana-dev@example.com",
  "pat-pm@example.com",
  "mike-builder@example.com",
  "jose-builder@example.com",
  "kat-builder@example.com",
  "lee-cad@example.com",
  "morgan-cad@example.com",
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

  // Clean up business-org preset data from any prior run
  await db.collection("user").deleteMany({ email: { $in: BUSINESS_ORG_EMAILS } });
  const bizOrg = await organizationsCollection().findOne({ slug: "midwest-services" });
  if (bizOrg) {
    const bizTeams = await teamsCollection().find({ orgId: bizOrg._id.toHexString() }).toArray();
    for (const t of bizTeams) {
      await ticketsCollection().deleteMany({ teamId: t._id.toHexString() });
    }
    await teamsCollection().deleteMany({ orgId: bizOrg._id.toHexString() });
    await organizationsCollection().deleteOne({ _id: bizOrg._id });
  }

  // Clean up tech-teams preset data from any prior run
  await db.collection("user").deleteMany({ email: { $in: TECH_TEAMS_EMAILS } });
  const techTeamCodes = ["DEVT1234", "BLDS5678", "CADX9012"];
  const techTeams = await teamsCollection()
    .find({ code: { $in: techTeamCodes } })
    .toArray();
  for (const t of techTeams) {
    await ticketsCollection().deleteMany({ teamId: t._id.toHexString() });
  }
  await teamsCollection().deleteMany({ code: { $in: techTeamCodes } });
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
  it("parses and imports the business-org preset", async () => {
    const parseRes = await app.inject({
      method: "POST",
      url: "/v1/seed/import/parse",
      headers: { cookie: sessionCookie },
      payload: { yaml: BUSINESS_ORG_YAML },
    });
    expect(parseRes.statusCode).toBe(200);
    expect(parseRes.json().ok).toBe(true);

    const importRes = await app.inject({
      method: "POST",
      url: "/v1/seed/import",
      headers: { cookie: sessionCookie },
      payload: { yaml: BUSINESS_ORG_YAML },
    });
    expect(importRes.statusCode).toBe(200);
    const body = importRes.json();
    expect(body.created.users).toBeGreaterThanOrEqual(1);
    expect(body.created.organizations).toBeGreaterThanOrEqual(1);
    expect(body.created.teams).toBeGreaterThanOrEqual(1);
    expect(body.created.tickets).toBeGreaterThanOrEqual(1);
    expect(body.summary).toContain("users");

    // Verify a known user from the preset exists in the DB
    const owner = await usersCollection().findOne({ email: "diane-owner@example.com" });
    expect(owner).not.toBeNull();
    expect(owner!.name).toBe("Diane Owner");
  });

  it("rejects malformed YAML", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/seed/import/parse",
      headers: { cookie: sessionCookie },
      payload: { yaml: "users:\n  - email: broken@example.com\n    name: [unterminated" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(false);
  });

  it("returns 404 in production mode (routes not registered)", async () => {
    // The guard runs at plugin registration time, so we need a fresh app built
    // with NODE_ENV=production — stubbing at request time has no effect.
    vi.stubEnv("NODE_ENV", "production");
    const prodApp = await buildApp();
    vi.unstubAllEnvs();
    const res = await prodApp.inject({
      method: "POST",
      url: "/v1/seed/import",
      payload: { yaml: "users: []" },
    });
    await prodApp.close();
    expect(res.statusCode).toBe(404);
  });

  it("imports the single-user preset and creates both accounts", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/seed/import",
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

  it("imports the tech-teams preset, attaching teams to the provided orgId", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/seed/import",
      headers: { cookie: sessionCookie },
      payload: { yaml: TECH_TEAMS_YAML, orgId: teamOnlyAnchorOrgId },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.created.users).toBe(8);
    expect(body.created.organizations).toBe(0);
    expect(body.created.teams).toBe(3);
    expect(body.created.tickets).toBe(6);

    // First team must be attached to the anchor org, not a newly created one
    const team = await teamsCollection().findOne({ code: "DEVT1234" });
    expect(team).not.toBeNull();
    expect(team!.orgId).toBe(teamOnlyAnchorOrgId);

    // Developers team has 3 members
    expect(team!.members).toHaveLength(3);

    // Admin (sam-dev) must also appear in members
    const sam = await usersCollection().findOne({ email: "sam-dev@example.com" });
    expect(team!.admins).toContain(sam!._id.toHexString());
    expect(team!.members).toContain(sam!._id.toHexString());
  });
});
