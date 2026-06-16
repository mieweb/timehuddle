import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/server.js";
import { auth } from "../src/lib/auth.js";
import { client, connectDB } from "../src/lib/db.js";
import {
  usersCollection,
  organizationsCollection,
  teamsCollection,
  ticketsCollection,
  enterprisesCollection,
} from "../src/models/index.js";

const SEED_USER = {
  name: "Seeder Field Test User",
  email: "seeder-field-test@test.dev",
  password: "Password1!",
};

// Unique prefix so these docs don't collide with other test runs
const P = "fieldtest";

const YAML = `
users:
  - email: ${P}-owner@example.com
    name: Field Owner
    username: ${P}-owner
  - email: ${P}-admin@example.com
    name: Field Admin
    username: ${P}-admin
  - email: ${P}-member@example.com
    name: Field Member

enterprise:
  name: ${P} Enterprise
  slug: ${P}-enterprise
  owners:
    - ${P}-owner@example.com
  admins:
    - ${P}-admin@example.com
  organizations:
    - name: ${P} Org
      slug: ${P}-org
      allowAutoJoin: false
      owners:
        - ${P}-owner@example.com
      admins:
        - ${P}-admin@example.com
      teams:
        - name: ${P} Team
          code: FTEST001
          members:
            - ${P}-owner@example.com
            - ${P}-admin@example.com
            - ${P}-member@example.com
          admins:
            - ${P}-admin@example.com
          tickets:
            - title: Field test ticket
              status: in-progress
              priority: high
              createdBy: ${P}-owner@example.com
              assignedTo:
                - ${P}-admin@example.com
                - ${P}-member@example.com
            - title: Second field ticket
              status: open
              priority: low
              createdBy: ${P}-admin@example.com
`;

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

  // Clean up this test's seeded data from any prior run
  const ownerEmail = `${P}-owner@example.com`;
  const adminEmail = `${P}-admin@example.com`;
  const memberEmail = `${P}-member@example.com`;
  await Promise.all([
    db.collection("user").deleteMany({ email: { $in: [ownerEmail, adminEmail, memberEmail] } }),
    organizationsCollection().deleteOne({ slug: `${P}-org` }),
    enterprisesCollection().deleteOne({ slug: `${P}-enterprise` }),
  ]);
  const team = await teamsCollection().findOne({ code: "FTEST001" });
  if (team) {
    await ticketsCollection().deleteMany({ teamId: team._id.toHexString() });
    await teamsCollection().deleteOne({ _id: team._id });
  }

  // Set up auth user for session
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

describe("seed import — field-level verification", () => {
  it("imports the YAML and returns correct counts", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/dev/seed/import",
      headers: { cookie: sessionCookie },
      payload: { yaml: YAML },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.created.users).toBe(3);
    expect(body.created.enterprises).toBe(1);
    expect(body.created.organizations).toBe(1);
    expect(body.created.teams).toBe(1);
    expect(body.created.tickets).toBe(2);
  });

  it("creates users with correct name and username", async () => {
    const owner = await usersCollection().findOne({ email: `${P}-owner@example.com` });
    expect(owner).not.toBeNull();
    expect(owner!.name).toBe("Field Owner");
    expect(owner!.username).toBe(`${P}-owner`);
    expect(owner!.emailVerified).toBe(true);

    const member = await usersCollection().findOne({ email: `${P}-member@example.com` });
    expect(member).not.toBeNull();
    expect(member!.name).toBe("Field Member");
    expect(member!.username).toBeNull();
  });

  it("creates the enterprise with correct owners and admins", async () => {
    const owner = await usersCollection().findOne({ email: `${P}-owner@example.com` });
    const admin = await usersCollection().findOne({ email: `${P}-admin@example.com` });
    expect(owner).not.toBeNull();
    expect(admin).not.toBeNull();

    const enterprise = await enterprisesCollection().findOne({ slug: `${P}-enterprise` });
    expect(enterprise).not.toBeNull();
    expect(enterprise!.name).toBe(`${P} Enterprise`);
    expect(enterprise!.owners).toContain(owner!._id.toHexString());
    expect(enterprise!.admins).toContain(admin!._id.toHexString());
  });

  it("creates the organization with correct slug, owners, and allowAutoJoin", async () => {
    const owner = await usersCollection().findOne({ email: `${P}-owner@example.com` });
    const admin = await usersCollection().findOne({ email: `${P}-admin@example.com` });

    const org = await organizationsCollection().findOne({ slug: `${P}-org` });
    expect(org).not.toBeNull();
    expect(org!.name).toBe(`${P} Org`);
    expect(org!.allowAutoJoin).toBe(false);
    expect(org!.owners).toContain(owner!._id.toHexString());
    expect(org!.admins).toContain(admin!._id.toHexString());
  });

  it("creates the team with correct members, admins, and code", async () => {
    const owner = await usersCollection().findOne({ email: `${P}-owner@example.com` });
    const admin = await usersCollection().findOne({ email: `${P}-admin@example.com` });
    const member = await usersCollection().findOne({ email: `${P}-member@example.com` });

    const team = await teamsCollection().findOne({ code: "FTEST001" });
    expect(team).not.toBeNull();
    expect(team!.name).toBe(`${P} Team`);
    expect(team!.members).toContain(owner!._id.toHexString());
    expect(team!.members).toContain(admin!._id.toHexString());
    expect(team!.members).toContain(member!._id.toHexString());
    // admin is in members list so should be promoted
    expect(team!.admins).toContain(admin!._id.toHexString());
    // owner was not listed as admin
    expect(team!.admins).not.toContain(owner!._id.toHexString());
  });

  it("creates tickets with correct status, priority, and assignments", async () => {
    const admin = await usersCollection().findOne({ email: `${P}-admin@example.com` });
    const member = await usersCollection().findOne({ email: `${P}-member@example.com` });
    const owner = await usersCollection().findOne({ email: `${P}-owner@example.com` });
    const team = await teamsCollection().findOne({ code: "FTEST001" });
    expect(team).not.toBeNull();

    const tickets = await ticketsCollection().find({ teamId: team!._id.toHexString() }).toArray();
    expect(tickets).toHaveLength(2);

    const primary = tickets.find((t) => t.title === "Field test ticket");
    expect(primary).not.toBeUndefined();
    expect(primary!.status).toBe("in-progress");
    expect(primary!.priority).toBe("high");
    expect(primary!.createdBy).toBe(owner!._id.toHexString());
    expect(primary!.assignedTo).toContain(admin!._id.toHexString());
    expect(primary!.assignedTo).toContain(member!._id.toHexString());

    const second = tickets.find((t) => t.title === "Second field ticket");
    expect(second).not.toBeUndefined();
    expect(second!.status).toBe("open");
    expect(second!.priority).toBe("low");
    expect(second!.createdBy).toBe(admin!._id.toHexString());
    expect(second!.assignedTo).toHaveLength(0);
  });

  it("is idempotent — re-importing the same YAML updates rather than duplicates", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/dev/seed/import",
      headers: { cookie: sessionCookie },
      payload: { yaml: YAML },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.created.users).toBe(0);
    expect(body.created.organizations).toBe(0);
    expect(body.created.teams).toBe(0);
    // tickets skip existing by title+teamId
    expect(body.created.tickets).toBe(0);

    const tickets = await ticketsCollection()
      .find({ teamId: (await teamsCollection().findOne({ code: "FTEST001" }))!._id.toHexString() })
      .toArray();
    expect(tickets).toHaveLength(2);
  });

  it("auto-creates loginable users for referenced emails not in the users list", async () => {
    const yaml = `
users:
  - email: known@example.com
    name: Known
organizations:
  - name: Ghost Org
    slug: ghost-org-fieldtest
    owners:
      - ghost@example.com
`;
    const res = await app.inject({
      method: "POST",
      url: "/v1/dev/seed/import",
      headers: { cookie: sessionCookie },
      payload: { yaml },
    });
    expect(res.statusCode).toBe(200);

    // The referenced-only email becomes a real user, even though it was never
    // listed under `users:`.
    const ghost = await usersCollection().findOne({ email: "ghost@example.com" });
    expect(ghost).not.toBeNull();
    expect(ghost!.emailVerified).toBe(true);

    // ...and it has a credential account, so it can actually log in.
    // (better-auth's mongo adapter stores account.userId as an ObjectId.)
    const account = await client.db().collection("account").findOne({
      userId: ghost!._id,
    });
    expect(account).not.toBeNull();

    // It is wired in as an org owner.
    const org = await organizationsCollection().findOne({ slug: "ghost-org-fieldtest" });
    expect(org!.owners).toContain(ghost!._id.toHexString());
  });
});
