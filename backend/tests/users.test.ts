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
import {
  enterprisesCollection,
  installationsCollection,
  organizationsCollection,
} from "../src/models/index.js";
import { DEFAULT_ORG_KEY } from "../src/lib/org-config.js";

const INSTALLATION_DOC_ID = "Installation" as const;

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
let aliceUsername: string;
let bobUsername: string;

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

  // Give Alice a username so /by/username tests can look her up
  aliceUsername = "users-alice-test";
  await db
    .collection("user")
    .updateOne({ _id: new ObjectId(aliceId) }, { $set: { username: aliceUsername } });

  bobUsername = "users-bob-test";
  await db
    .collection("user")
    .updateOne({ _id: new ObjectId(bobId) }, { $set: { username: bobUsername } });
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

  it("updates reports-to for a teammate — 200", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/v1/me/profile",
      headers: { cookie: aliceCookie },
      payload: { reportsToUserId: bobId },
    });
    expect(res.statusCode).toBe(200);
    const { user } = res.json();
    expect(user.reportsTo).toEqual({ id: bobId, name: BOB.name, username: bobUsername });
  });

  it("rejects reports-to for a non-teammate — 400", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/v1/me/profile",
      headers: { cookie: aliceCookie },
      payload: { reportsToUserId: _carolId },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("reports-to-not-teammate");
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

// ─── GET /v1/users/by/username/:username ─────────────────────────────────────

describe("GET /v1/users/by/username/:username", () => {
  it("returns 401 without auth", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/users/by/username/${aliceUsername}`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns public profile — 200", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/users/by/username/${aliceUsername}`,
      headers: { cookie: aliceCookie },
    });
    expect(res.statusCode).toBe(200);
    const { user } = res.json();
    expect(user.id).toBe(aliceId);
    expect(user.name).toBeDefined();
    expect(user.username).toBe(aliceUsername);
    // email must NOT be exposed
    expect(user.email).toBeUndefined();
  });

  it("returns 404 for unknown username", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/users/by/username/thisuserdoesnotexist99",
      headers: { cookie: aliceCookie },
    });
    expect(res.statusCode).toBe(404);
  });

  it("own profile — sharedTeams is empty", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/users/by/username/${aliceUsername}`,
      headers: { cookie: aliceCookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.sharedTeams).toEqual([]);
    expect(res.json().user.teamMemberships).toEqual([
      { id: sharedTeamId, name: "Users Test Team", role: "admin" },
    ]);
    expect(res.json().user.reportsTo).toEqual({ id: bobId, name: BOB.name, username: bobUsername });
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
    // Alice (viewer) is an admin of the team
    expect(team.isAdmin).toBe(true);
    expect(user.teamMemberships).toEqual([
      { id: sharedTeamId, name: "Users Test Team", role: "member" },
    ]);
  });

  it("non-teammate can view profile — 200", async () => {
    // Carol shares no team with Alice
    const res = await app.inject({
      method: "GET",
      url: `/v1/users/${aliceId}`,
      headers: { cookie: carolCookie },
    });
    expect(res.statusCode).toBe(200);
    const { user } = res.json();
    expect(user.id).toBe(aliceId);
    expect(Array.isArray(user.sharedTeams)).toBe(true);
    expect(user.sharedTeams).toEqual([]);
  });

  it("returns 404 for unknown user", async () => {
    const unknownId = "000000000000000000000099";
    const res = await app.inject({
      method: "GET",
      url: `/v1/users/${unknownId}`,
      headers: { cookie: carolCookie },
    });
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

// ─── GET /v1/organization/users ──────────────────────────────────────────────

describe("GET /v1/organization/users", () => {
  it("returns all users with default organization roles", async () => {
    const defaultOrg = await organizationsCollection().findOne({ slug: DEFAULT_ORG_KEY });
    expect(defaultOrg).toBeTruthy();

    const originalOwners = defaultOrg!.owners ?? [];
    const originalAdmins = defaultOrg!.admins ?? [];

    try {
      await organizationsCollection().updateOne(
        { _id: defaultOrg!._id },
        { $set: { owners: [aliceId], admins: [bobId], updatedAt: new Date() } }
      );

      const res = await app.inject({
        method: "GET",
        url: "/v1/organization/users",
        headers: { cookie: aliceCookie },
      });

      expect(res.statusCode).toBe(200);
      const { users } = res.json();
      const ids = users.map((user: any) => user.id);
      expect(ids).toEqual(expect.arrayContaining([aliceId, bobId, _carolId]));
      expect(users.find((user: any) => user.id === aliceId)?.role).toBe("owner");
      expect(users.find((user: any) => user.id === bobId)?.role).toBe("admin");
      expect(users.find((user: any) => user.id === _carolId)?.role).toBe("member");
    } finally {
      await organizationsCollection().updateOne(
        { _id: defaultOrg!._id },
        { $set: { owners: originalOwners, admins: originalAdmins, updatedAt: new Date() } }
      );
    }
  });
});

describe("Default enterprise ownership bootstrap", () => {
  it("reports owner absence and allows authenticated user to take ownership", async () => {
    const defaultOrg = await organizationsCollection().findOne({ slug: DEFAULT_ORG_KEY });
    expect(defaultOrg).toBeTruthy();
    expect(defaultOrg?.enterpriseId).toBeTruthy();

    const enterpriseId = defaultOrg!.enterpriseId as string;
    const defaultEnterprise = await enterprisesCollection().findOne({
      _id: new ObjectId(enterpriseId),
    });
    expect(defaultEnterprise).toBeTruthy();

    const originalEnterpriseOwners = defaultEnterprise!.owners ?? [];
    const originalEnterpriseAdmins = defaultEnterprise!.admins ?? [];
    const originalInstallation = await installationsCollection().findOne({
      _id: INSTALLATION_DOC_ID,
    });

    const originalOrgOwners = defaultOrg!.owners ?? [];
    const originalOrgAdmins = defaultOrg!.admins ?? [];

    try {
      await enterprisesCollection().updateOne(
        { _id: defaultEnterprise!._id },
        {
          $set: { owners: [], admins: originalEnterpriseAdmins, updatedAt: new Date() },
        }
      );
      await installationsCollection().deleteOne({ _id: INSTALLATION_DOC_ID });

      const statusRes = await app.inject({
        method: "GET",
        url: "/v1/install-status",
        headers: { cookie: aliceCookie },
      });
      expect(statusRes.statusCode).toBe(200);
      expect(statusRes.json().hasOwner).toBe(false);
      expect(statusRes.json().installCompleted).toBe(false);

      const takeRes = await app.inject({
        method: "POST",
        url: "/v1/install",
        headers: { cookie: aliceCookie },
      });
      expect(takeRes.statusCode).toBe(200);
      expect(takeRes.json().role).toBe("owner");

      const updatedEnterprise = await enterprisesCollection().findOne({
        _id: defaultEnterprise!._id,
      });
      expect(updatedEnterprise?.owners ?? []).toEqual([aliceId]);
      const updatedInstallation = await installationsCollection().findOne({
        _id: INSTALLATION_DOC_ID,
      });
      expect(updatedInstallation?.completedAt).toBeTruthy();

      const updatedOrg = await organizationsCollection().findOne({ _id: defaultOrg!._id });
      expect(updatedOrg?.owners ?? []).toEqual([aliceId]);
    } finally {
      if (originalInstallation) {
        await installationsCollection().replaceOne(
          { _id: INSTALLATION_DOC_ID },
          originalInstallation,
          { upsert: true }
        );
      } else {
        await installationsCollection().deleteOne({ _id: INSTALLATION_DOC_ID });
      }

      await enterprisesCollection().updateOne(
        { _id: defaultEnterprise!._id },
        {
          $set: {
            owners: originalEnterpriseOwners,
            admins: originalEnterpriseAdmins,
            updatedAt: new Date(),
          },
        }
      );

      await organizationsCollection().updateOne(
        { _id: defaultOrg!._id },
        {
          $set: {
            owners: originalOrgOwners,
            admins: originalOrgAdmins,
            updatedAt: new Date(),
          },
        }
      );
    }
  });

  it("backfills enterpriseId for migrated organizations during install", async () => {
    const defaultOrg = await organizationsCollection().findOne({ slug: DEFAULT_ORG_KEY });
    expect(defaultOrg).toBeTruthy();
    expect(defaultOrg?.enterpriseId).toBeTruthy();

    const defaultEnterprise = await enterprisesCollection().findOne({
      _id: new ObjectId(defaultOrg!.enterpriseId as string),
    });
    expect(defaultEnterprise).toBeTruthy();

    const originalEnterpriseOwners = defaultEnterprise!.owners ?? [];
    const originalEnterpriseAdmins = defaultEnterprise!.admins ?? [];
    const originalInstallation = await installationsCollection().findOne({
      _id: INSTALLATION_DOC_ID,
    });

    const originalOrgOwners = defaultOrg!.owners ?? [];
    const originalOrgAdmins = defaultOrg!.admins ?? [];

    const migratedOrgId = new ObjectId();

    try {
      await organizationsCollection().insertOne({
        _id: migratedOrgId,
        name: "Users Migrated Org",
        slug: "users-migrated-org",
        key: "users-migrated-org",
        owners: [],
        admins: [],
        createdAt: new Date(),
      });

      await enterprisesCollection().updateOne(
        { _id: defaultEnterprise!._id },
        {
          $set: { owners: [], admins: originalEnterpriseAdmins, updatedAt: new Date() },
        }
      );
      await organizationsCollection().updateOne(
        { _id: defaultOrg!._id },
        {
          $set: { owners: [], admins: originalOrgAdmins, updatedAt: new Date() },
        }
      );
      await installationsCollection().deleteOne({ _id: INSTALLATION_DOC_ID });

      const takeRes = await app.inject({
        method: "POST",
        url: "/v1/install",
        headers: { cookie: aliceCookie },
      });

      expect(takeRes.statusCode).toBe(200);

      const migratedOrg = await organizationsCollection().findOne({ _id: migratedOrgId });
      expect(migratedOrg?.enterpriseId).toBe(defaultOrg!.enterpriseId);
    } finally {
      await organizationsCollection().deleteOne({ _id: migratedOrgId });

      if (originalInstallation) {
        await installationsCollection().replaceOne(
          { _id: INSTALLATION_DOC_ID },
          originalInstallation,
          { upsert: true }
        );
      } else {
        await installationsCollection().deleteOne({ _id: INSTALLATION_DOC_ID });
      }

      await enterprisesCollection().updateOne(
        { _id: defaultEnterprise!._id },
        {
          $set: {
            owners: originalEnterpriseOwners,
            admins: originalEnterpriseAdmins,
            updatedAt: new Date(),
          },
        }
      );

      await organizationsCollection().updateOne(
        { _id: defaultOrg!._id },
        {
          $set: {
            owners: originalOrgOwners,
            admins: originalOrgAdmins,
            updatedAt: new Date(),
          },
        }
      );
    }
  });

  it("returns 409 when an enterprise owner already exists", async () => {
    const defaultOrg = await organizationsCollection().findOne({ slug: DEFAULT_ORG_KEY });
    expect(defaultOrg).toBeTruthy();
    expect(defaultOrg?.enterpriseId).toBeTruthy();

    const defaultEnterprise = await enterprisesCollection().findOne({
      _id: new ObjectId(defaultOrg!.enterpriseId as string),
    });
    expect(defaultEnterprise).toBeTruthy();

    const originalEnterpriseOwners = defaultEnterprise!.owners ?? [];
    const originalEnterpriseAdmins = defaultEnterprise!.admins ?? [];
    const originalInstallation = await installationsCollection().findOne({
      _id: INSTALLATION_DOC_ID,
    });

    try {
      await enterprisesCollection().updateOne(
        { _id: defaultEnterprise!._id },
        {
          $set: { owners: [bobId], admins: originalEnterpriseAdmins, updatedAt: new Date() },
        }
      );
      await installationsCollection().deleteOne({ _id: INSTALLATION_DOC_ID });

      const takeRes = await app.inject({
        method: "POST",
        url: "/v1/install",
        headers: { cookie: aliceCookie },
      });

      expect(takeRes.statusCode).toBe(409);
      expect(takeRes.json().error).toBe("Owner already exists or install is already complete");
    } finally {
      if (originalInstallation) {
        await installationsCollection().replaceOne(
          { _id: INSTALLATION_DOC_ID },
          originalInstallation,
          { upsert: true }
        );
      } else {
        await installationsCollection().deleteOne({ _id: INSTALLATION_DOC_ID });
      }

      await enterprisesCollection().updateOne(
        { _id: defaultEnterprise!._id },
        {
          $set: {
            owners: originalEnterpriseOwners,
            admins: originalEnterpriseAdmins,
            updatedAt: new Date(),
          },
        }
      );
    }
  });
});

describe("PUT /v1/org/users/:userId", () => {
  it("returns 404 when reportsToUserId does not exist", async () => {
    const defaultOrg = await organizationsCollection().findOne({ slug: DEFAULT_ORG_KEY });
    expect(defaultOrg).toBeTruthy();

    const originalOwners = defaultOrg!.owners ?? [];
    const originalAdmins = defaultOrg!.admins ?? [];

    try {
      await organizationsCollection().updateOne(
        { _id: defaultOrg!._id },
        { $set: { owners: [aliceId], admins: originalAdmins, updatedAt: new Date() } }
      );

      const unknownId = "000000000000000000000099";
      const res = await app.inject({
        method: "PUT",
        url: `/v1/org/users/${bobId}`,
        headers: { cookie: aliceCookie },
        payload: { reportsToUserId: unknownId },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe("Reports-to user not found");
    } finally {
      await organizationsCollection().updateOne(
        { _id: defaultOrg!._id },
        { $set: { owners: originalOwners, admins: originalAdmins, updatedAt: new Date() } }
      );
    }
  });
});
