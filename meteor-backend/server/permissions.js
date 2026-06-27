/**
 * Authorization — port of backend/src/lib/permissions.ts (CASL ability builder)
 * plus the team/ticket guards that previously lived (duplicated) inside
 * tickets.js and clock.js.
 *
 * This brings the Meteor methods to authorization parity with the Fastify
 * backend: org owners/admins and enterprise-elevated users manage their teams'
 * tickets, regular members read/create/update/assign, and only a ticket's
 * creator (or an elevated user) may delete it.
 *
 * Org/enterprise lookups use the native driver (read-only, ad hoc) — no need for
 * reactive Meteor collections here.
 */
import { Meteor } from 'meteor/meteor';
import { Mongo } from 'meteor/mongo';
import { MongoInternals } from 'meteor/mongo';
import { AbilityBuilder, createMongoAbility, subject } from '@casl/ability';
import { Tickets, Teams, rawDb, isValidId } from './collections';

const { ObjectId } = MongoInternals.NpmModules.mongodb.module;

/**
 * Build a CASL ability from a resolved permission context.
 * Faithful port of `buildAbilityFor` in backend/src/lib/permissions.ts.
 */
export function buildAbilityFor(context) {
  const { can, build } = new AbilityBuilder(createMongoAbility);

  if (context.teamIds.length > 0) {
    const teamScope = { teamId: { $in: context.teamIds } };
    if (context.role === 'owner' || context.role === 'admin' || context.isEnterpriseElevated) {
      can('manage', 'Ticket', teamScope);
      can('manage', 'Team', { id: { $in: context.teamIds } });
    } else {
      can('read', 'Ticket', teamScope);
      can('create', 'Ticket', teamScope);
      can(['update', 'assign', 'review', 'comment', 'batchStatus'], 'Ticket', teamScope);
      can('delete', 'Ticket', { ...teamScope, createdBy: context.userId });
    }
  }

  const orgIds = context.orgIds ?? [];
  const managedOrgIds =
    context.managedOrgIds ?? (context.role === 'owner' || context.role === 'admin' ? orgIds : []);

  if (orgIds.length > 0) {
    can('read', 'Organization', { id: { $in: orgIds } });
  }

  if (managedOrgIds.length > 0) {
    can('manage', 'Organization', { id: { $in: managedOrgIds } });
    can('manage', 'OrganizationMembership', { orgId: { $in: managedOrgIds } });
  }

  if ((context.enterpriseIds ?? []).length > 0 || context.isEnterpriseElevated) {
    can('read', 'Enterprise');
    if (context.isEnterpriseElevated && (context.enterpriseIds ?? []).length > 0) {
      can('manage', 'Enterprise', { id: { $in: context.enterpriseIds } });
    }
  }

  return build();
}

/** Resolve the caller's org role for a team's parent org. */
async function resolveOrgRoleForTeam(userId, team) {
  if (!team.orgId || !isValidId(team.orgId)) return 'member';
  const membership = await rawDb().collection('org_members').findOne({ orgId: team.orgId, userId });
  if (membership?.role === 'owner') return 'owner';
  if (membership?.role === 'admin') return 'admin';
  return 'member';
}

/** Determine whether the caller is an enterprise owner/admin above the team's org. */
async function isEnterpriseElevatedForTeamOrg(userId, team) {
  if (!team.orgId || !isValidId(team.orgId)) {
    return { elevated: false, enterpriseId: null };
  }
  const org = await rawDb().collection('organizations').findOne({ _id: new ObjectId(team.orgId) });
  const enterpriseId = org?.enterpriseId ?? null;
  if (!enterpriseId || !isValidId(enterpriseId)) {
    return { elevated: false, enterpriseId: null };
  }
  const enterprise = await rawDb()
    .collection('enterprises')
    .findOne({ _id: new ObjectId(enterpriseId) });
  if (!enterprise) {
    return { elevated: false, enterpriseId };
  }
  const elevated =
    (enterprise.owners ?? []).includes(userId) || (enterprise.admins ?? []).includes(userId);
  return { elevated, enterpriseId };
}

/**
 * Load a team and build the caller's ability scoped to it.
 * Mirrors TicketService.buildTeamAbility. Returns null for an invalid id or a
 * missing team; otherwise `{ team, scoped, ability }` where `scoped` is true
 * when the caller has any access (member, org owner/admin, or enterprise).
 */
export async function buildTeamAbility(userId, teamId) {
  if (!isValidId(teamId)) return null;
  const team = await Teams.findOneAsync(new Mongo.ObjectID(teamId));
  if (!team) return null;

  const role = await resolveOrgRoleForTeam(userId, team);
  const enterpriseScope = await isEnterpriseElevatedForTeamOrg(userId, team);
  const isTeamMember =
    (team.members ?? []).includes(userId) || (team.admins ?? []).includes(userId);
  const isOrgElevated = role === 'owner' || role === 'admin';
  const scoped = isTeamMember || isOrgElevated || enterpriseScope.elevated;
  const scopedTeamIds = scoped ? [teamId] : [];

  const ability = buildAbilityFor({
    userId,
    role,
    teamIds: scopedTeamIds,
    orgIds: team.orgId ? [team.orgId] : [],
    enterpriseIds: enterpriseScope.enterpriseId ? [enterpriseScope.enterpriseId] : [],
    isEnterpriseElevated: enterpriseScope.elevated,
    teamAdminIds: (team.admins ?? []).includes(userId) ? [teamId] : [],
  });

  return { team, scoped, ability };
}

/** Throw unless the caller has access to the team. Returns the team. */
export async function requireTeamMembership(userId, teamId) {
  if (!isValidId(teamId)) throw new Meteor.Error('forbidden', 'Invalid team id');
  const ctx = await buildTeamAbility(userId, teamId);
  if (!ctx || !ctx.scoped) throw new Meteor.Error('forbidden', 'Not a member of this team');
  return ctx.team;
}

/**
 * Load a ticket and verify the caller may perform `action` on it (CASL).
 * Returns the ticket, or throws 'not-found' / 'forbidden'.
 */
export async function requireTicketPermission(userId, ticketId, action) {
  if (!isValidId(ticketId)) throw new Meteor.Error('not-found', 'Invalid ticket id');
  const ticket = await Tickets.findOneAsync(new Mongo.ObjectID(ticketId));
  if (!ticket) throw new Meteor.Error('not-found', 'Ticket not found');
  const ctx = await buildTeamAbility(userId, ticket.teamId);
  if (!ctx || !ctx.ability.can(action, subject('Ticket', ticket))) {
    throw new Meteor.Error('forbidden', 'Not allowed to perform this action on the ticket');
  }
  return ticket;
}
