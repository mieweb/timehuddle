import { ObjectId } from "mongodb";
import YAML from "yaml";
import { auth } from "../lib/auth.js";
import {
  enterprisesCollection,
  orgMembersCollection,
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

/** Default password for seeded login accounts (same as the canonical seed script). */
const DEFAULT_SEED_PASSWORD = "Password1!";

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isObjectId(value: string): boolean {
  return /^[0-9a-f]{24}$/i.test(value);
}

function normalizeList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(value.map((item) => asString(item)).filter((item): item is string => Boolean(item)))
  );
}

function assertValidId(value: string, field: string) {
  if (!isObjectId(value)) {
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
  return id && isObjectId(id) ? new ObjectId(id) : new ObjectId();
}

/** Build a human name from an email local-part: "sarah-team-lead" -> "Sarah Team Lead". */
function emailToName(email: string): string {
  const local = email.split("@")[0];
  const name = local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
  return name || local;
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

// ── Phase 1: plan — collect every user reference anywhere in the document ──

/**
 * Walk the whole document and gather every user reference (by email). References can
 * appear in the `users:` list, org/enterprise owners & admins, team members & admins,
 * and ticket createdBy / assignedTo. ObjectId references are ignored here (they point
 * at users that already exist). Explicit `users:` entries carry name/username overrides.
 */
function collectUserEmails(doc: SeedImportDocument): {
  emails: Set<string>;
  explicit: Map<string, SeedUser>;
} {
  const emails = new Set<string>();
  const explicit = new Map<string, SeedUser>();

  const add = (ref: unknown) => {
    const value = asString(ref);
    if (value && !isObjectId(value)) emails.add(value);
  };

  const eachTicket = (ticket: SeedTicket) => {
    add(ticket.createdBy);
    normalizeList(ticket.assignedTo).forEach(add);
  };

  const eachTeam = (team: SeedTeam) => {
    normalizeList(team.members).forEach(add);
    normalizeList(team.admins).forEach(add);
    (team.tickets ?? []).forEach(eachTicket);
  };

  const eachOrg = (org: SeedOrganization) => {
    normalizeList(org.owners).forEach(add);
    normalizeList(org.admins).forEach(add);
    (org.teams ?? []).forEach(eachTeam);
  };

  for (const user of doc.users ?? []) {
    const email = asString(user.email);
    if (email) {
      emails.add(email);
      explicit.set(email, user);
    }
  }
  if (doc.enterprise) {
    normalizeList(doc.enterprise.owners).forEach(add);
    normalizeList(doc.enterprise.admins).forEach(add);
    (doc.enterprise.organizations ?? []).forEach(eachOrg);
  }
  (doc.organizations ?? []).forEach(eachOrg);
  (doc.teams ?? []).forEach(eachTeam);

  return { emails, explicit };
}

// ── Phase 2: build — create all users as real, loginable accounts ──

/**
 * Ensure every referenced email has a loginable account (created via better-auth so a
 * credential password exists), then apply explicit name/username/reportsTo overrides.
 * Returns an email -> userId map used to resolve all later references.
 */
async function ensureUsers(
  emails: Set<string>,
  explicit: Map<string, SeedUser>
): Promise<{ byEmail: Map<string, string>; created: number; updated: number }> {
  const now = new Date();
  let created = 0;

  for (const email of emails) {
    const existing = await usersCollection().findOne({ email });
    if (existing) continue;
    const data = explicit.get(email);
    const name = asString(data?.name) ?? emailToName(email);
    try {
      await auth.api.signUpEmail({ body: { name, email, password: DEFAULT_SEED_PASSWORD } });
      created += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Tolerate a race where the account already exists; rethrow anything else.
      if (!/already|exist/i.test(message)) throw err;
    }
  }

  const saved = await usersCollection()
    .find({ email: { $in: Array.from(emails) } })
    .toArray();

  // First pass: build email → id map so reportsTo can resolve peer emails.
  const byEmail = new Map<string, string>();
  for (const user of saved) {
    byEmail.set(user.email, user._id.toHexString());
  }

  for (const user of saved) {
    const data = explicit.get(user.email);
    const reportsToRaw = asString(data?.reportsTo);
    let reportsToUserId: string | undefined;
    if (reportsToRaw) {
      // Accept either an email reference (resolved via byEmail) or a raw ObjectId.
      reportsToUserId = byEmail.get(reportsToRaw) ?? reportsToRaw;
      assertValidId(reportsToUserId, "users.reportsTo");
    }

    const set: Record<string, unknown> = { emailVerified: true, updatedAt: now };
    if (asString(data?.name)) set.name = asString(data?.name);
    if (reportsToUserId) set.reportsToUserId = reportsToUserId;
    // Claim a username only when one is explicitly given; otherwise keep any
    // handle already claimed, defaulting to null (unclaimed) for new users.
    set.username = asString(data?.username) ?? user.username ?? null;

    await usersCollection().updateOne({ _id: user._id }, { $set: set });
  }

  return { byEmail, created, updated: saved.length - created };
}

/** All users are pre-created in phase 2, so this is a pure lookup. */
function resolveUserId(ref: string, byEmail: Map<string, string>): string {
  const value = asString(ref);
  if (!value) throw new Error("Invalid user reference");
  if (isObjectId(value)) return value;
  const id = byEmail.get(value);
  if (!id) throw new Error(`Unknown user reference: ${value}`);
  return id;
}

function resolveUserIds(refs: unknown, byEmail: Map<string, string>): string[] {
  return normalizeList(refs).map((ref) => resolveUserId(ref, byEmail));
}

/** Ensure each user is a member of the org (idempotent). */
async function upsertOrgMembers(
  userIds: string[],
  orgId: string,
  role: "owner" | "admin" | "member" = "member"
) {
  const now = new Date();
  for (const userId of userIds) {
    const exists = await orgMembersCollection().findOne({ orgId, userId });
    if (!exists) {
      await orgMembersCollection().insertOne({
        _id: new ObjectId(),
        orgId,
        userId,
        role,
        auto: false,
        createdAt: now,
      });
    }
  }
}

async function upsertEnterprise(
  enterprise: SeedEnterprise,
  byEmail: Map<string, string>
): Promise<{ enterpriseId: string; created: boolean }> {
  const name = asString(enterprise.name);
  if (!name) throw new Error("enterprise.name is required");
  const slug = asString(enterprise.slug) ?? slugifyLocal(name);
  const now = new Date();
  const existing = await enterprisesCollection().findOne({ slug });
  const owners = resolveUserIds(enterprise.owners, byEmail);
  const admins = resolveUserIds(enterprise.admins, byEmail);

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
    { $set: { name, owners, admins, updatedAt: now } }
  );
  return { enterpriseId: existing._id.toHexString(), created: false };
}

async function upsertOrganization(
  organization: SeedOrganization,
  enterpriseId: string | null,
  byEmail: Map<string, string>
): Promise<{ organizationId: string; created: boolean }> {
  const name = asString(organization.name);
  if (!name) throw new Error("organization.name is required");
  const slug = asString(organization.slug) ?? slugifyLocal(name);
  const now = new Date();
  const existing = await organizationsCollection().findOne({ slug });
  const owners = resolveUserIds(organization.owners, byEmail);
  const admins = resolveUserIds(organization.admins, byEmail);

  let organizationId: string;
  let created: boolean;
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
    organizationId = _id.toHexString();
    created = true;
  } else {
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
    organizationId = existing._id.toHexString();
    created = false;
  }

  await upsertOrgMembers(owners, organizationId, "owner");
  await upsertOrgMembers(admins, organizationId, "admin");
  return { organizationId, created };
}

async function upsertTeams(
  teams: SeedTeam[],
  orgId: string,
  byEmail: Map<string, string>,
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
    const admins = resolveUserIds(team.admins, byEmail);
    // Admins are implicitly members — union them in so an admin is always
    // visible on the team (visibility is keyed on membership).
    const members = Array.from(new Set([...resolveUserIds(team.members, byEmail), ...admins]));
    if (members.length === 0) throw new Error(`${name}: team needs at least one member or admin`);
    const existing = await teamsCollection().findOne({ orgId, name });

    const teamId = existing ? existing._id : toObjectId(team.id);
    if (!existing) {
      await teamsCollection().insertOne({
        _id: teamId,
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
    } else {
      await teamsCollection().updateOne(
        { _id: teamId },
        {
          $set: { description: team.description, code, updatedAt: now },
          $addToSet: { members: { $each: members }, admins: { $each: admins } },
        }
      );
      updated += 1;
    }

    await upsertOrgMembers(members, orgId);
    ticketSeed.push(
      ...(team.tickets ?? []).map((ticket) => ({ teamId: teamId.toHexString(), ticket }))
    );
  }
  return { created, updated };
}

async function upsertTickets(
  entries: { teamId: string; ticket: SeedTicket }[],
  byEmail: Map<string, string>
) {
  let created = 0;
  for (const entry of entries) {
    const title = asString(entry.ticket.title);
    if (!title) throw new Error("ticket.title is required");
    const createdBy = resolveUserId(
      entry.ticket.createdBy ?? Array.from(byEmail.values())[0] ?? "",
      byEmail
    );
    const assignedTo = resolveUserIds(entry.ticket.assignedTo, byEmail);
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

  // Phase 1: plan. Phase 2: create every referenced user up front so all later
  // references resolve against a complete email -> userId map.
  const { emails, explicit } = collectUserEmails(parsed);
  const userResult = await ensureUsers(emails, explicit);
  const byEmail = userResult.byEmail;

  // Phase 3: build the hierarchy, wiring references from the map.
  let enterpriseResult = { enterpriseId: options?.defaultEnterpriseId ?? null, created: false };
  if (parsed.enterprise) {
    enterpriseResult = await upsertEnterprise(parsed.enterprise, byEmail);
  }

  const organizations = [
    ...(parsed.enterprise?.organizations ?? []),
    ...(parsed.organizations ?? []),
  ];
  let orgCreated = 0;
  let orgUpdated = 0;
  const ticketSeed: { teamId: string; ticket: SeedTicket }[] = [];
  for (const organization of organizations) {
    const result = await upsertOrganization(organization, enterpriseResult.enterpriseId, byEmail);
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
      byEmail,
      ticketSeed
    );
    teamCreated += result.created;
    teamUpdated += result.updated;
  }

  // Top-level teams attach to the currently selected org passed from the UI.
  if (options?.orgId && parsed.teams && parsed.teams.length > 0) {
    const result = await upsertTeams(parsed.teams, options.orgId, byEmail, ticketSeed);
    teamCreated += result.created;
    teamUpdated += result.updated;
  }

  const ticketResult = await upsertTickets(ticketSeed, byEmail);

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
