import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { ObjectId } from "mongodb";
import { buildApp } from "../src/server.js";
import { connectDB, client } from "../src/lib/db.js";
import { auth } from "../src/lib/auth.js";

const OWNER = { name: "Org Owner", email: "org-owner@test.dev", password: "Password1!" };
const MEMBER = { name: "Org Member", email: "org-member@test.dev", password: "Password1!" };
const ENTERPRISE_ADMIN = {
  name: "Enterprise Admin",
  email: "enterprise-admin@test.dev",
  password: "Password1!",
};
const ENTERPRISE_OWNER = {
  name: "Enterprise Owner",
  email: "enterprise-owner@test.dev",
  password: "Password1!",
};
const UNRELATED_ENTERPRISE_ADMIN = {
  name: "Unrelated Enterprise Admin",
  email: "unrelated-enterprise-admin@test.dev",
  password: "Password1!",
};

let app: FastifyInstance;
let ownerCookie: string;
let memberCookie: string;
let enterpriseAdminCookie: string;
let enterpriseOwnerCookie: string;
let unrelatedEnterpriseAdminCookie: string;
let ownerId: string;
let memberId: string;
let enterpriseAdminId: string;
let enterpriseOwnerId: string;
let unrelatedEnterpriseAdminId: string;
let enterpriseId: string;
let unrelatedEnterpriseId: string;
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
  await Promise.all([
    purgeUser(OWNER.email),
    purgeUser(MEMBER.email),
    purgeUser(ENTERPRISE_ADMIN.email),
    purgeUser(ENTERPRISE_OWNER.email),
    purgeUser(UNRELATED_ENTERPRISE_ADMIN.email),
  ]);
  await auth.api.signUpEmail({ body: OWNER });
  await auth.api.signUpEmail({ body: MEMBER });
  await auth.api.signUpEmail({ body: ENTERPRISE_ADMIN });
  await auth.api.signUpEmail({ body: ENTERPRISE_OWNER });
  await auth.api.signUpEmail({ body: UNRELATED_ENTERPRISE_ADMIN });

  ownerId = String((await db.collection("user").findOne({ email: OWNER.email }))!._id);
  memberId = String((await db.collection("user").findOne({ email: MEMBER.email }))!._id);
  enterpriseAdminId = String(
    (await db.collection("user").findOne({ email: ENTERPRISE_ADMIN.email }))!._id
  );
  enterpriseOwnerId = String(
    (await db.collection("user").findOne({ email: ENTERPRISE_OWNER.email }))!._id
  );
  unrelatedEnterpriseAdminId = String(
    (await db.collection("user").findOne({ email: UNRELATED_ENTERPRISE_ADMIN.email }))!._id
  );

  const enterpriseDoc = {
    _id: new ObjectId(),
    name: "Test Enterprise",
    slug: `test-enterprise-${Date.now()}`,
    owners: [ownerId, enterpriseOwnerId],
    admins: [enterpriseAdminId],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  await db.collection("enterprises").insertOne(enterpriseDoc);
  enterpriseId = enterpriseDoc._id.toHexString();

  const unrelatedEnterpriseDoc = {
    _id: new ObjectId(),
    name: "Unrelated Enterprise",
    slug: `unrelated-enterprise-${Date.now()}`,
    owners: [],
    admins: [unrelatedEnterpriseAdminId],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  await db.collection("enterprises").insertOne(unrelatedEnterpriseDoc);
  unrelatedEnterpriseId = unrelatedEnterpriseDoc._id.toHexString();

  ownerCookie = await getSessionCookie(OWNER.email, OWNER.password);
  memberCookie = await getSessionCookie(MEMBER.email, MEMBER.password);
  enterpriseAdminCookie = await getSessionCookie(ENTERPRISE_ADMIN.email, ENTERPRISE_ADMIN.password);
  enterpriseOwnerCookie = await getSessionCookie(ENTERPRISE_OWNER.email, ENTERPRISE_OWNER.password);
  unrelatedEnterpriseAdminCookie = await getSessionCookie(
    UNRELATED_ENTERPRISE_ADMIN.email,
    UNRELATED_ENTERPRISE_ADMIN.password
  );
}, 60000);

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
  if (unrelatedEnterpriseId) {
    await db.collection("enterprises").deleteOne({ _id: new ObjectId(unrelatedEnterpriseId) });
  }
  await Promise.all([
    purgeUser(OWNER.email),
    purgeUser(MEMBER.email),
    purgeUser(ENTERPRISE_ADMIN.email),
    purgeUser(ENTERPRISE_OWNER.email),
    purgeUser(UNRELATED_ENTERPRISE_ADMIN.email),
  ]);
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

  it("reports canManage for organization owner and allows member visibility", async () => {
    const orgRes = await app.inject({
      method: "GET",
      url: `/v1/organizations/${organizationId}`,
      headers: { cookie: ownerCookie },
    });
    expect(orgRes.statusCode).toBe(200);
    expect(orgRes.json().organization.canManage).toBe(true);

    const membersRes = await app.inject({
      method: "GET",
      url: `/v1/organizations/${organizationId}/members`,
      headers: { cookie: ownerCookie },
    });
    expect(membersRes.statusCode).toBe(200);
    const users = membersRes.json().users as Array<{ id: string }>;
    expect(users.some((user) => user.id === ownerId)).toBe(true);
  });

  it("keeps last elevated organization member protection outside CASL", async () => {
    const res = await app.inject({
      method: "PUT",
      url: `/v1/organizations/${organizationId}/members/${ownerId}/role`,
      headers: { cookie: ownerCookie },
      payload: { role: "member" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("At least one owner or admin is required");
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

  it("allows enterprise admin to see organizations without org membership", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/organizations",
      headers: { cookie: enterpriseAdminCookie },
    });

    expect(res.statusCode).toBe(200);
    const organizations = res.json().organizations as Array<{ id: string }>;
    expect(organizations.some((org) => org.id === organizationId)).toBe(true);
  });

  it("allows enterprise admin to view organization members", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/organizations/${organizationId}/members`,
      headers: { cookie: enterpriseAdminCookie },
    });

    expect(res.statusCode).toBe(200);
    const users = res.json().users as Array<{ id: string }>;
    expect(users.some((user) => user.id === ownerId)).toBe(true);
  });

  it("reports canManage for enterprise owner and admin without org membership", async () => {
    const ownerRes = await app.inject({
      method: "GET",
      url: `/v1/organizations/${organizationId}`,
      headers: { cookie: enterpriseOwnerCookie },
    });
    expect(ownerRes.statusCode).toBe(200);
    expect(ownerRes.json().organization.canManage).toBe(true);

    const adminRes = await app.inject({
      method: "GET",
      url: `/v1/organizations/${organizationId}`,
      headers: { cookie: enterpriseAdminCookie },
    });
    expect(adminRes.statusCode).toBe(200);
    expect(adminRes.json().organization.canManage).toBe(true);
  });

  it("allows enterprise owner without org membership to manage organization settings and roles", async () => {
    const settingsRes = await app.inject({
      method: "PUT",
      url: `/v1/organizations/${organizationId}/settings`,
      headers: { cookie: enterpriseOwnerCookie },
      payload: { allowAutoJoin: true },
    });
    expect(settingsRes.statusCode).toBe(200);
    expect(settingsRes.json().organization.allowAutoJoin).toBe(true);

    const roleRes = await app.inject({
      method: "PUT",
      url: `/v1/organizations/${organizationId}/members/${memberId}/role`,
      headers: { cookie: enterpriseOwnerCookie },
      payload: { role: "member" },
    });
    expect(roleRes.statusCode).toBe(200);
    expect(roleRes.json().user.role).toBe("member");
  });

  it("forbids unrelated enterprise admin from organization member visibility", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/organizations/${organizationId}/members`,
      headers: { cookie: unrelatedEnterpriseAdminCookie },
    });

    expect(res.statusCode).toBe(403);
  });

  it("allows enterprise admin to manually add a member to organization", async () => {
    const res = await app.inject({
      method: "PUT",
      url: `/v1/organizations/${organizationId}/members/${memberId}/role`,
      headers: { cookie: enterpriseAdminCookie },
      payload: { role: "member" },
    });

    expect(res.statusCode).toBe(200);
    const db = client.db();
    const orgMember = await db.collection("org_members").findOne({
      orgId: organizationId,
      userId: memberId,
    });
    expect(orgMember).not.toBeNull();
    expect(orgMember?.role).toBe("member");
  });

  it("allows organization members to view chart users", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/v1/organizations/${organizationId}/users`,
      headers: { cookie: memberCookie },
    });

    expect(res.statusCode).toBe(200);
    const users = res.json().users as Array<{ id: string }>;
    expect(users.some((user) => user.id === ownerId)).toBe(true);
  });

  it("forbids plain organization member from managing members", async () => {
    const orgRes = await app.inject({
      method: "GET",
      url: `/v1/organizations/${organizationId}`,
      headers: { cookie: memberCookie },
    });
    expect(orgRes.statusCode).toBe(200);
    expect(orgRes.json().organization.canManage).toBe(false);

    const membersRes = await app.inject({
      method: "GET",
      url: `/v1/organizations/${organizationId}/members`,
      headers: { cookie: memberCookie },
    });
    expect(membersRes.statusCode).toBe(403);
  });

  it("allows enterprise admin to remove a member from organization", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/organizations/${organizationId}/members/${memberId}`,
      headers: { cookie: enterpriseAdminCookie },
    });

    expect(res.statusCode).toBe(200);
    const db = client.db();
    const orgMember = await db.collection("org_members").findOne({
      orgId: organizationId,
      userId: memberId,
    });
    expect(orgMember).toBeNull();
  });

  it("allows organization owner to downgrade a member role", async () => {
    const db = client.db();

    const promoteRes = await app.inject({
      method: "PUT",
      url: `/v1/organizations/${organizationId}/members/${memberId}/role`,
      headers: { cookie: ownerCookie },
      payload: { role: "admin" },
    });
    expect(promoteRes.statusCode).toBe(200);

    const demoteRes = await app.inject({
      method: "PUT",
      url: `/v1/organizations/${organizationId}/members/${memberId}/role`,
      headers: { cookie: ownerCookie },
      payload: { role: "member" },
    });

    expect(demoteRes.statusCode).toBe(200);
    expect(demoteRes.json().user.role).toBe("member");
    const orgMember = await db.collection("org_members").findOne({
      orgId: organizationId,
      userId: memberId,
    });
    expect(orgMember?.role).toBe("member");
  });

  it("allows organization admin to update reports-to without enterprise admin access", async () => {
    const db = client.db();

    const addRes = await app.inject({
      method: "PUT",
      url: `/v1/organizations/${organizationId}/members/${memberId}/role`,
      headers: { cookie: ownerCookie },
      payload: { role: "admin" },
    });
    expect(addRes.statusCode).toBe(200);

    const res = await app.inject({
      method: "PUT",
      url: `/v1/organizations/${organizationId}/members/${memberId}/reports-to`,
      headers: { cookie: memberCookie },
      payload: { reportsToUserId: ownerId },
    });

    expect(res.statusCode).toBe(200);
    const updatedUser = await db.collection("user").findOne({ _id: new ObjectId(memberId) });
    expect(updatedUser?.reportsToUserId).toBe(ownerId);
  });

  it("allows organization admin to search users without enterprise admin access", async () => {
    const addRes = await app.inject({
      method: "PUT",
      url: `/v1/organizations/${organizationId}/members/${memberId}/role`,
      headers: { cookie: ownerCookie },
      payload: { role: "admin" },
    });
    expect(addRes.statusCode).toBe(200);

    const res = await app.inject({
      method: "GET",
      url: `/v1/organizations/${organizationId}/users/search?q=org`,
      headers: { cookie: memberCookie },
    });

    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().users)).toBe(true);
  });

  it("allows organization admin to remove members without enterprise admin access", async () => {
    const promoteAdminRes = await app.inject({
      method: "PUT",
      url: `/v1/organizations/${organizationId}/members/${memberId}/role`,
      headers: { cookie: ownerCookie },
      payload: { role: "admin" },
    });
    expect(promoteAdminRes.statusCode).toBe(200);

    const addTargetRes = await app.inject({
      method: "PUT",
      url: `/v1/organizations/${organizationId}/members/${enterpriseOwnerId}/role`,
      headers: { cookie: ownerCookie },
      payload: { role: "member" },
    });
    expect(addTargetRes.statusCode).toBe(200);

    const removeRes = await app.inject({
      method: "DELETE",
      url: `/v1/organizations/${organizationId}/members/${enterpriseOwnerId}`,
      headers: { cookie: memberCookie },
    });
    expect(removeRes.statusCode).toBe(200);

    const db = client.db();
    const orgMember = await db.collection("org_members").findOne({
      orgId: organizationId,
      userId: enterpriseOwnerId,
    });
    expect(orgMember).toBeNull();
  });

  it("allows enterprise admin to downgrade a member role", async () => {
    const db = client.db();

    const promoteRes = await app.inject({
      method: "PUT",
      url: `/v1/organizations/${organizationId}/members/${memberId}/role`,
      headers: { cookie: ownerCookie },
      payload: { role: "admin" },
    });
    expect(promoteRes.statusCode).toBe(200);

    const demoteRes = await app.inject({
      method: "PUT",
      url: `/v1/organizations/${organizationId}/members/${memberId}/role`,
      headers: { cookie: enterpriseAdminCookie },
      payload: { role: "member" },
    });

    expect(demoteRes.statusCode).toBe(200);
    expect(demoteRes.json().user.role).toBe("member");
    const orgMember = await db.collection("org_members").findOne({
      orgId: organizationId,
      userId: memberId,
    });
    expect(orgMember?.role).toBe("member");
  });
});
