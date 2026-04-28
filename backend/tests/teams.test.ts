/**
 * Team routes — integration tests.
 *
 * Fixture setup (beforeAll):
 *  - OWNER   : creates the test team (becomes admin + member)
 *  - MEMBER  : regular member (added during setup)
 *  - OUTSIDER: not in the team at all
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { ObjectId } from "mongodb";
import { buildApp } from "../src/server.js";
import { connectDB, client } from "../src/lib/db.js";
import { auth } from "../src/lib/auth.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const OWNER = { name: "Team Owner", email: "team-owner@test.dev", password: "Password1!" };
const MEMBER = { name: "Team Member", email: "team-member@test.dev", password: "Password1!" };
const OUTSIDER = { name: "Team Outsider", email: "team-outsider@test.dev", password: "Password1!" };

let app: FastifyInstance;
let ownerCookie: string;
let memberCookie: string;
let outsiderCookie: string;
let ownerId: string;
let memberId: string;
let outsiderId: string;
let teamId: string;

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

async function inject(
  method: string,
  url: string,
  cookie: string,
  payload?: Record<string, unknown>
) {
  return app.inject({
    method: method as any,
    url,
    headers: { cookie },
    payload,
  });
}

// ─── Setup / Teardown ─────────────────────────────────────────────────────────

beforeAll(async () => {
  await connectDB();
  app = await buildApp({ logger: false });
  await app.ready();

  const db = client.db();

  await Promise.all([purgeUser(OWNER.email), purgeUser(MEMBER.email), purgeUser(OUTSIDER.email)]);

  await auth.api.signUpEmail({ body: OWNER });
  await auth.api.signUpEmail({ body: MEMBER });
  await auth.api.signUpEmail({ body: OUTSIDER });

  ownerId = String((await db.collection("user").findOne({ email: OWNER.email }))!._id);
  memberId = String((await db.collection("user").findOne({ email: MEMBER.email }))!._id);
  outsiderId = String((await db.collection("user").findOne({ email: OUTSIDER.email }))!._id);

  // Create the base test team
  const teamDoc = {
    _id: new ObjectId(),
    name: "Fixture Team",
    members: [ownerId, memberId],
    admins: [ownerId],
    code: "TEAMCODE1",
    isPersonal: false,
    createdAt: new Date(),
  };
  await db.collection("teams").insertOne(teamDoc);
  teamId = teamDoc._id.toHexString();

  ownerCookie = await getSessionCookie(OWNER.email, OWNER.password);
  memberCookie = await getSessionCookie(MEMBER.email, MEMBER.password);
  outsiderCookie = await getSessionCookie(OUTSIDER.email, OUTSIDER.password);
}, 20000);

afterAll(async () => {
  const db = client.db();
  await db.collection("teams").deleteMany({ code: { $regex: /^TEAMCODE|^PERSONAL/ } });
  await Promise.all([purgeUser(OWNER.email), purgeUser(MEMBER.email), purgeUser(OUTSIDER.email)]);
  await app.close();
});

// ─── Auth gates ───────────────────────────────────────────────────────────────

describe("auth gate", () => {
  it("GET /v1/teams — 401 without cookie", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/teams" });
    expect(res.statusCode).toBe(401);
  });

  it("POST /v1/teams — 401 without cookie", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/teams", payload: { name: "X" } });
    expect(res.statusCode).toBe(401);
  });
});

// ─── GET /v1/teams ────────────────────────────────────────────────────────────

describe("GET /v1/teams", () => {
  it("returns teams for owner — 200", async () => {
    const res = await inject("GET", "/v1/teams", ownerCookie);
    expect(res.statusCode).toBe(200);
    const { teams } = res.json();
    expect(Array.isArray(teams)).toBe(true);
    const fixture = teams.find((t: any) => t.id === teamId);
    expect(fixture).toBeDefined();
    expect(fixture.name).toBe("Fixture Team");
    expect(fixture.members).toContain(ownerId);
    expect(fixture.admins).toContain(ownerId);
  });

  it("does not return the team for outsider — 200 but no fixture team", async () => {
    const res = await inject("GET", "/v1/teams", outsiderCookie);
    expect(res.statusCode).toBe(200);
    const { teams } = res.json();
    expect(teams.find((t: any) => t.id === teamId)).toBeUndefined();
  });
});

// ─── POST /v1/teams/ensure-personal ──────────────────────────────────────────

describe("POST /v1/teams/ensure-personal", () => {
  it("creates a personal workspace when none exists — 200", async () => {
    const res = await inject("POST", "/v1/teams/ensure-personal", outsiderCookie);
    expect(res.statusCode).toBe(200);
    const { team } = res.json();
    expect(team.isPersonal).toBe(true);
    expect(team.members).toContain(outsiderId);
  });

  it("is idempotent — calling twice returns same team", async () => {
    const res1 = await inject("POST", "/v1/teams/ensure-personal", ownerCookie);
    const res2 = await inject("POST", "/v1/teams/ensure-personal", ownerCookie);
    expect(res1.statusCode).toBe(200);
    expect(res2.statusCode).toBe(200);
    expect(res1.json().team.id).toBe(res2.json().team.id);
  });
});

// ─── POST /v1/teams ───────────────────────────────────────────────────────────

describe("POST /v1/teams", () => {
  it("creates a team — 201", async () => {
    const res = await inject("POST", "/v1/teams", ownerCookie, {
      name: "New Team",
      description: "A brand new team",
    });
    expect(res.statusCode).toBe(201);
    const { team } = res.json();
    expect(team.name).toBe("New Team");
    expect(team.description).toBe("A brand new team");
    expect(team.members).toContain(ownerId);
    expect(team.admins).toContain(ownerId);
    expect(team.isPersonal).toBe(false);
    expect(typeof team.code).toBe("string");
    // cleanup
    await client
      .db()
      .collection("teams")
      .deleteOne({ _id: new ObjectId(team.id) });
  });

  it("requires name — 400", async () => {
    const res = await inject("POST", "/v1/teams", ownerCookie, {});
    expect(res.statusCode).toBe(400);
  });
});

// ─── POST /v1/teams/join ──────────────────────────────────────────────────────

describe("POST /v1/teams/join", () => {
  it("joins an existing team by code — 200", async () => {
    const res = await inject("POST", "/v1/teams/join", outsiderCookie, { teamCode: "TEAMCODE1" });
    expect(res.statusCode).toBe(200);
    const { team } = res.json();
    expect(team.members).toContain(outsiderId);
    // cleanup: remove outsider from the fixture team
    await client
      .db()
      .collection("teams")
      .updateOne({ _id: new ObjectId(teamId) }, { $pull: { members: outsiderId } } as any);
  });

  it("returns 404 for bad code", async () => {
    const res = await inject("POST", "/v1/teams/join", ownerCookie, { teamCode: "BADCODE999" });
    expect(res.statusCode).toBe(404);
  });

  it("returns 409 if already a member", async () => {
    const res = await inject("POST", "/v1/teams/join", ownerCookie, { teamCode: "TEAMCODE1" });
    expect(res.statusCode).toBe(409);
  });
});

// ─── PUT /v1/teams/:id/name ───────────────────────────────────────────────────

describe("PUT /v1/teams/:id/name", () => {
  it("admin can rename — 200", async () => {
    const res = await inject("PUT", `/v1/teams/${teamId}/name`, ownerCookie, {
      newName: "Renamed Team",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().team.name).toBe("Renamed Team");
    // restore
    await inject("PUT", `/v1/teams/${teamId}/name`, ownerCookie, { newName: "Fixture Team" });
  });

  it("non-admin is forbidden — 403", async () => {
    const res = await inject("PUT", `/v1/teams/${teamId}/name`, memberCookie, {
      newName: "Hacked",
    });
    expect(res.statusCode).toBe(403);
  });

  it("outsider gets 403 (not found + forbidden both map to 403)", async () => {
    const res = await inject("PUT", `/v1/teams/${teamId}/name`, outsiderCookie, {
      newName: "Hacked",
    });
    expect(res.statusCode).toBe(403);
  });
});

// ─── GET /v1/teams/:id/members ────────────────────────────────────────────────

describe("GET /v1/teams/:id/members", () => {
  it("returns members with name + email — 200", async () => {
    const res = await inject("GET", `/v1/teams/${teamId}/members`, ownerCookie);
    expect(res.statusCode).toBe(200);
    const { members } = res.json();
    expect(Array.isArray(members)).toBe(true);
    const ownerEntry = members.find((m: any) => m.id === ownerId);
    expect(ownerEntry).toBeDefined();
    expect(ownerEntry.name).toBe(OWNER.name);
    expect(ownerEntry.email).toBe(OWNER.email);
  });

  it("outsider gets 404", async () => {
    const res = await inject("GET", `/v1/teams/${teamId}/members`, outsiderCookie);
    expect(res.statusCode).toBe(404);
  });
});

// ─── POST /v1/teams/:id/invite ────────────────────────────────────────────────

describe("POST /v1/teams/:id/invite", () => {
  it("adds user to team by email — 200", async () => {
    const res = await inject("POST", `/v1/teams/${teamId}/invite`, ownerCookie, {
      email: OUTSIDER.email,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    // cleanup
    await client
      .db()
      .collection("teams")
      .updateOne({ _id: new ObjectId(teamId) }, { $pull: { members: outsiderId } } as any);
  });

  it("returns 404 for unknown email", async () => {
    const res = await inject("POST", `/v1/teams/${teamId}/invite`, ownerCookie, {
      email: "nobody@nowhere.test",
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 409 if already a member", async () => {
    const res = await inject("POST", `/v1/teams/${teamId}/invite`, ownerCookie, {
      email: MEMBER.email,
    });
    expect(res.statusCode).toBe(409);
  });
});

// ─── PUT /v1/teams/:id/members/:userId/role ───────────────────────────────────

describe("PUT /v1/teams/:id/members/:userId/role", () => {
  it("admin can promote member to admin — 200", async () => {
    const res = await inject("PUT", `/v1/teams/${teamId}/members/${memberId}/role`, ownerCookie, {
      role: "admin",
    });
    expect(res.statusCode).toBe(200);
    // verify
    const team = await client
      .db()
      .collection("teams")
      .findOne({ _id: new ObjectId(teamId) });
    expect(team?.admins).toContain(memberId);
    // demote back
    await inject("PUT", `/v1/teams/${teamId}/members/${memberId}/role`, ownerCookie, {
      role: "member",
    });
  });

  it("non-admin is forbidden — 403", async () => {
    const res = await inject("PUT", `/v1/teams/${teamId}/members/${ownerId}/role`, memberCookie, {
      role: "member",
    });
    expect(res.statusCode).toBe(403);
  });

  it("cannot demote last admin — 400", async () => {
    const res = await inject("PUT", `/v1/teams/${teamId}/members/${ownerId}/role`, ownerCookie, {
      role: "member",
    });
    expect(res.statusCode).toBe(400);
  });
});

// ─── DELETE /v1/teams/:id/members/:userId ─────────────────────────────────────

describe("DELETE /v1/teams/:id/members/:userId", () => {
  it("admin can remove a regular member — 200", async () => {
    // add outsider first
    await client
      .db()
      .collection("teams")
      .updateOne({ _id: new ObjectId(teamId) }, { $addToSet: { members: outsiderId } } as any);

    const res = await inject("DELETE", `/v1/teams/${teamId}/members/${outsiderId}`, ownerCookie);
    expect(res.statusCode).toBe(200);
    const team = await client
      .db()
      .collection("teams")
      .findOne({ _id: new ObjectId(teamId) });
    expect(team?.members).not.toContain(outsiderId);
  });

  it("non-admin is forbidden — 403", async () => {
    const res = await inject("DELETE", `/v1/teams/${teamId}/members/${ownerId}`, memberCookie);
    expect(res.statusCode).toBe(403);
  });

  it("cannot remove self — 400", async () => {
    const res = await inject("DELETE", `/v1/teams/${teamId}/members/${ownerId}`, ownerCookie);
    expect(res.statusCode).toBe(400);
  });
});

// ─── DELETE /v1/teams/:id ─────────────────────────────────────────────────────

describe("DELETE /v1/teams/:id", () => {
  it("admin can delete a team — 200", async () => {
    // create a temp team to delete
    const tmpTeam = {
      _id: new ObjectId(),
      name: "To Delete",
      members: [ownerId],
      admins: [ownerId],
      code: "DELETEME1",
      isPersonal: false,
      createdAt: new Date(),
    };
    await client.db().collection("teams").insertOne(tmpTeam);
    const tmpId = tmpTeam._id.toHexString();

    const res = await inject("DELETE", `/v1/teams/${tmpId}`, ownerCookie);
    expect(res.statusCode).toBe(200);
    const gone = await client.db().collection("teams").findOne({ _id: tmpTeam._id });
    expect(gone).toBeNull();
  });

  it("non-admin is forbidden — 403", async () => {
    const res = await inject("DELETE", `/v1/teams/${teamId}`, memberCookie);
    expect(res.statusCode).toBe(403);
  });
});
