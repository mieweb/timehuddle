import { ObjectId } from "mongodb";
import YAML from "yaml";
import {
  enterprisesCollection,
  organizationsCollection,
  teamsCollection,
  ticketsCollection,
  usersCollection,
} from "../models/index.js";

type SeedUser = {
  id?: string;
  email: string;
  name?: string;
  username?: string | null;
  reportsTo?: string | null;
  role?: "owner" | "admin" | "member";
};

type SeedTicket = {
  title: string;
  status?: "open" | "in-progress" | "blocked" | "reviewed" | "closed";
  priority?: "low" | "medium" | "high" | "critical";
  description?: string;
  createdBy?: string;
  assignedTo?: string[];
};

type SeedTeam = {
  id?: string;
  name: string;
  description?: string;
  code?: string;
  members?: string[];
  admins?: string[];
  tickets?: SeedTicket[];
};

type SeedOrganization = {
  id?: string;
  name: string;
  slug?: string;
  allowAutoJoin?: boolean;
  owners?: string[];
  admins?: string[];
  teams?: SeedTeam[];
};

type SeedEnterprise = {
  id?: string;
  name: string;
  slug?: string;
  owners?: string[];
  admins?: string[];
  organizations?: SeedOrganization[];
};

export type SeedImportDocument = {
  enterprise?: SeedEnterprise;
  organizations?: SeedOrganization[];
  teams?: SeedTeam[];
  users?: SeedUser[];
};

export type SeedImportResult = {
  created: {
    enterprises: number;
    organizations: number;
    teams: number;
    users: number;
    tickets: number;
  };
  updated: {
    enterprises: number;
    organizations: number;
    teams: number;
    users: number;
  };
};

export type SeedImportError =
  | { type: "parse-error"; message: string }
  | { type: "validation-error"; message: string };

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(value.map((item) => asString(item)).filter((item): item is string => Boolean(item)))
  );
}

function assertValidId(value: string, field: string) {
  if (!/^[0-9a-f]{24}$/i.test(value)) {
    throw new Error(`${field} must be a 24-character hex ObjectId string`);
  }
}

function slugifyLocal(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function toObjectId(id?: string): ObjectId {
  return id && /^[0-9a-f]{24}$/i.test(id) ? new ObjectId(id) : new ObjectId();
}

function parseSeedImport(input: string): SeedImportDocument {
  const parsed = YAML.parse(input);
  if (!isObject(parsed)) throw new Error("YAML root must be a mapping/object");
  return parsed as SeedImportDocument;
}

function normalizeSeedDocument(doc: SeedImportDocument): SeedImportDocument {
  const enterprise = doc.enterprise && isObject(doc.enterprise) ? doc.enterprise : undefined;
  const organizations = Array.isArray(doc.organizations) ? doc.organizations.filter(isObject) : [];
  const teams = Array.isArray(doc.teams) ? doc.teams.filter(isObject) : [];
  const users = Array.isArray(doc.users) ? doc.users.filter(isObject) : [];
  return {
    enterprise: enterprise as SeedEnterprise | undefined,
    organizations: organizations as SeedOrganization[],
    teams: teams as SeedTeam[],
    users: users as SeedUser[],
  };
}

async function upsertUsers(users: SeedUser[]) {
  const now = new Date();
  const byEmail = new Map<string, string>();
  let created = 0;
  let updated = 0;

  for (const user of users) {
    const email = asString(user.email);
    if (!email) throw new Error("Each user requires a valid email");
    const name = asString(user.name) ?? email.split("@")[0];
    const existing = await usersCollection().findOne({ email });
    const reportsToUserId = asString(user.reportsTo);
    if (reportsToUserId) assertValidId(reportsToUserId, "users.reportsTo");

    if (!existing) {
      await usersCollection().insertOne({
        _id: toObjectId(user.id),
        name,
        email,
        emailVerified: true,
        image: null,
        username: user.username ?? null,
        reportsToUserId: reportsToUserId ?? null,
        createdAt: now,
        updatedAt: now,
      } as any);
      created += 1;
    } else {
      await usersCollection().updateOne(
        { _id: existing._id },
        {
          $set: {
            name,
            username: user.username ?? existing.username ?? null,
            reportsToUserId: reportsToUserId ?? null,
            updatedAt: now,
          },
        }
      );
      updated += 1;
    }

    const saved = await usersCollection().findOne({ email });
    if (!saved) throw new Error(`Failed to load user after upsert: ${email}`);
    byEmail.set(email, saved._id.toHexString());
  }

  return { byEmail, created, updated };
}

function resolveUserId(ref: string, userIdsByEmail: Map<string, string>): string {
  const maybeEmail = asString(ref);
  if (!maybeEmail) throw new Error("Invalid user reference");
  if (/^[0-9a-f]{24}$/i.test(maybeEmail)) return maybeEmail;
  const resolved = userIdsByEmail.get(maybeEmail);
  if (resolved) return resolved;
  throw new Error(`Unknown user reference: ${ref}`);
}

async function upsertEnterprise(
  enterprise: SeedEnterprise,
  userIdsByEmail: Map<string, string>
): Promise<{ enterpriseId: string; created: boolean }> {
  const name = asString(enterprise.name);
  if (!name) throw new Error("enterprise.name is required");
  const slug = asString(enterprise.slug) ?? slugifyLocal(name);
  const now = new Date();
  const existing = await enterprisesCollection().findOne({ slug });
  const owners = normalizeList(enterprise.owners).map((ref) => resolveUserId(ref, userIdsByEmail));
  const admins = normalizeList(enterprise.admins).map((ref) => resolveUserId(ref, userIdsByEmail));

  if (!existing) {
    const _id = toObjectId(enterprise.id);
    await enterprisesCollection().insertOne({
      _id,
      name,
      slug,
      owners,
      admins,
      createdAt: now,
      updatedAt: now,
    });
    return { enterpriseId: _id.toHexString(), created: true };
  }

  await enterprisesCollection().updateOne(
    { _id: existing._id },
    {
      $set: {
        name,
        owners,
        admins,
        updatedAt: now,
      },
    }
  );
  return { enterpriseId: existing._id.toHexString(), created: false };
}

async function upsertOrganization(
  organization: SeedOrganization,
  enterpriseId: string | null,
  userIdsByEmail: Map<string, string>
): Promise<{ organizationId: string; created: boolean }> {
  const name = asString(organization.name);
  if (!name) throw new Error("organization.name is required");
  const slug = asString(organization.slug) ?? slugifyLocal(name);
  const now = new Date();
  const existing = await organizationsCollection().findOne({ slug });
  const owners = normalizeList(organization.owners).map((ref) =>
    resolveUserId(ref, userIdsByEmail)
  );
  const admins = normalizeList(organization.admins).map((ref) =>
    resolveUserId(ref, userIdsByEmail)
  );

  if (!existing) {
    const _id = toObjectId(organization.id);
    await organizationsCollection().insertOne({
      _id,
      enterpriseId: enterpriseId ?? undefined,
      name,
      slug,
      owners,
      admins,
      allowAutoJoin: organization.allowAutoJoin ?? true,
      createdAt: now,
      updatedAt: now,
    } as any);
    return { organizationId: _id.toHexString(), created: true };
  }

  await organizationsCollection().updateOne(
    { _id: existing._id },
    {
      $set: {
        enterpriseId: enterpriseId ?? existing.enterpriseId,
        name,
        owners,
        admins,
        allowAutoJoin: organization.allowAutoJoin ?? existing.allowAutoJoin ?? true,
        updatedAt: now,
      },
    }
  );
  return { organizationId: existing._id.toHexString(), created: false };
}

async function upsertTeams(
  teams: SeedTeam[],
  orgId: string,
  userIdsByEmail: Map<string, string>,
  ticketSeed: { teamId: string; ticket: SeedTicket }[]
) {
  let created = 0;
  let updated = 0;
  for (const team of teams) {
    const name = asString(team.name);
    if (!name) throw new Error("team.name is required");
    const code =
      asString(team.code) ??
      name
        .slice(0, 8)
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "X");
    const now = new Date();
    const members = normalizeList(team.members).map((ref) => resolveUserId(ref, userIdsByEmail));
    const admins = normalizeList(team.admins)
      .map((ref) => resolveUserId(ref, userIdsByEmail))
      .filter((id) => members.includes(id));
    const existing = await teamsCollection().findOne({ orgId, name });

    if (!existing) {
      const _id = toObjectId(team.id);
      await teamsCollection().insertOne({
        _id,
        orgId,
        name,
        description: team.description,
        members,
        admins,
        code,
        isPersonal: false,
        createdAt: now,
        updatedAt: now,
      } as any);
      created += 1;
      ticketSeed.push(
        ...(team.tickets ?? []).map((ticket) => ({ teamId: _id.toHexString(), ticket }))
      );
      continue;
    }

    await teamsCollection().updateOne(
      { _id: existing._id },
      {
        $set: {
          description: team.description,
          members,
          admins,
          code,
          updatedAt: now,
        },
      }
    );
    updated += 1;
    ticketSeed.push(
      ...(team.tickets ?? []).map((ticket) => ({ teamId: existing._id.toHexString(), ticket }))
    );
  }
  return { created, updated };
}

async function upsertTickets(
  entries: { teamId: string; ticket: SeedTicket }[],
  userIdsByEmail: Map<string, string>
) {
  let created = 0;
  for (const entry of entries) {
    const title = asString(entry.ticket.title);
    if (!title) throw new Error("ticket.title is required");
    const createdBy = resolveUserId(
      entry.ticket.createdBy ?? Array.from(userIdsByEmail.keys())[0] ?? "",
      userIdsByEmail
    );
    const assignedTo = normalizeList(entry.ticket.assignedTo).map((ref) =>
      resolveUserId(ref, userIdsByEmail)
    );
    const exists = await ticketsCollection().findOne({ teamId: entry.teamId, title });
    if (exists) continue;
    await ticketsCollection().insertOne({
      teamId: entry.teamId,
      title,
      description: entry.ticket.description,
      github: "",
      status: entry.ticket.status ?? "open",
      priority: entry.ticket.priority ?? "medium",
      createdBy,
      assignedTo,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);
    created += 1;
  }
  return { created };
}

export async function importSeedYaml(
  input: string,
  options?: { defaultEnterpriseId?: string; orgId?: string }
): Promise<SeedImportResult> {
  const parsed = normalizeSeedDocument(parseSeedImport(input));
  const users = parsed.users ?? [];

  const userResult = await upsertUsers(users);
  const userIdsByEmail = userResult.byEmail;

  const defaultEnterpriseId = options?.defaultEnterpriseId;
  let enterpriseResult = { enterpriseId: defaultEnterpriseId ?? null, created: false };
  if (parsed.enterprise) {
    enterpriseResult = await upsertEnterprise(parsed.enterprise, userIdsByEmail);
  }

  const organizations = [
    ...(parsed.enterprise?.organizations ?? []),
    ...(parsed.organizations ?? []),
  ];
  let orgCreated = 0;
  let orgUpdated = 0;
  const teamsResultTickets: { teamId: string; ticket: SeedTicket }[] = [];
  for (const organization of organizations) {
    const result = await upsertOrganization(
      organization,
      enterpriseResult.enterpriseId,
      userIdsByEmail
    );
    if (result.created) orgCreated += 1;
    else orgUpdated += 1;
  }

  let teamCreated = 0;
  let teamUpdated = 0;
  for (const organization of organizations) {
    const org = await organizationsCollection().findOne({
      slug: asString(organization.slug) ?? slugifyLocal(organization.name),
    });
    if (!org) continue;
    const result = await upsertTeams(
      organization.teams ?? [],
      org._id.toHexString(),
      userIdsByEmail,
      teamsResultTickets
    );
    teamCreated += result.created;
    teamUpdated += result.updated;
  }

  // If orgId is provided and there are top-level teams, add them to that org
  if (options?.orgId && parsed.teams && parsed.teams.length > 0) {
    const result = await upsertTeams(
      parsed.teams,
      options.orgId,
      userIdsByEmail,
      teamsResultTickets
    );
    teamCreated += result.created;
    teamUpdated += result.updated;
  }

  const ticketResult = await upsertTickets(teamsResultTickets, userIdsByEmail);

  return {
    created: {
      enterprises: enterpriseResult.created ? 1 : 0,
      organizations: orgCreated,
      teams: teamCreated,
      users: userResult.created,
      tickets: ticketResult.created,
    },
    updated: {
      enterprises: enterpriseResult.created ? 0 : 1,
      organizations: orgUpdated,
      teams: teamUpdated,
      users: userResult.updated,
    },
  };
}

export function tryParseSeedYaml(
  input: string
): { ok: true; value: SeedImportDocument } | { ok: false; error: SeedImportError } {
  try {
    return { ok: true, value: normalizeSeedDocument(parseSeedImport(input)) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown YAML error";
    return { ok: false, error: { type: "parse-error", message } };
  }
}
