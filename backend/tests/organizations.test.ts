import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { ObjectId } from "mongodb";
import { buildApp } from "../src/server.js";
import { connectDB, client } from "../src/lib/db.js";
import { auth } from "../src/lib/auth.js";

const OWNER = { name: "Org Owner", email: "org-owner@test.dev", password: "Password1!" };
const MEMBER = { name: "Org Member", email: "org-member@test.dev", password: "Password1!" };

let app: FastifyInstance;
let ownerCookie: string;
let memberCookie: string;
let ownerId: string;
let memberId: string;
let enterpriseId: string;
let organizationId: string;
let teamCode: string;

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

beforeAll(async () => {
  await connectDB();
  app = await buildApp({ logger: false });
  await app.ready();

  const db = client.db();
  await Promise.all([purgeUser(OWNER.email), purgeUser(MEMBER.email)]);
  await auth.api.signUpEmail({ body: OWNER });
  await auth.api.signUpEmail({ body: MEMBER });

  ownerId = String((await db.collection("user").findOne({ email: OWNER.email }))!._id);
  memberId = String((await db.collection("user").findOne({ email: MEMBER.email }))!._id);

  const enterpriseDoc = {
    _id: new ObjectId(),
    name: "Test Enterprise",
    slug: `test-enterprise-${Date.now()}`,
    owners: [ownerId],
    admins: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  await db.collection("enterprises").insertOne(enterpriseDoc);
  enterpriseId = enterpriseDoc._id.toHexString();

  ownerCookie = await getSessionCookie(OWNER.email, OWNER.password);
  memberCookie = await getSessionCookie(MEMBER.email, MEMBER.password);
}, 20000);

afterAll(async () => {
  const db = client.db();
  if (organizationId) {
    await db.collection("teams" as any).deleteMany({ orgId: organizationId });
    await db.collection("org_members").deleteMany({ orgId: organizationId });
    await db.collection("organizations").deleteOne({ _id: new ObjectId(organizationId) });
  }
  if (enterpriseId) {
    await db.collection("enterprises").deleteOne({ _id: new ObjectId(enterpriseId) });
  }
  await Promise.all([purgeUser(OWNER.email), purgeUser(MEMBER.email)]);
  await app.close();
});

describe("organizations routes", () => {
  it("creates an organization under an enterprise", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v1/organizations",
      headers: { cookie: ownerCookie },
      payload: {
        enterpriseId,
        name: "Product Engineering",
        allowAutoJoin: true,
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    organizationId = body.organization.id;
    expect(body.organization.name).toBe("Product Engineering");
  });

  it("allows owner to disable allowAutoJoin", async () => {
    const res = await app.inject({
      method: "PUT",
      url: `/v1/organizations/${organizationId}/settings`,
      headers: { cookie: ownerCookie },
      payload: { allowAutoJoin: false },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().organization.allowAutoJoin).toBe(false);
  });

  it("team join does not auto-create org membership when allowAutoJoin=false", async () => {
    const db = client.db();
    teamCode = `ORGJOIN${Date.now().toString().slice(-4)}`;
    await db.collection("teams").insertOne({
      _id: new ObjectId(),
      orgId: organizationId,
      parentTeamId: null,
      name: "Org Join Team",
      members: [ownerId],
      admins: [ownerId],
      code: teamCode,
      isPersonal: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const joinRes = await app.inject({
      method: "POST",
      url: "/v1/teams/join",
      headers: { cookie: memberCookie },
      payload: { teamCode },
    });

    expect(joinRes.statusCode).toBe(200);
    const orgMember = await db.collection("org_members").findOne({
      orgId: organizationId,
      userId: memberId,
    });
    expect(orgMember).toBeNull();
  });
});
