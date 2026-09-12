/**
 * Dev-only one-click sign-in.
 *
 * Registers a `devQuickLogin` login handler that provisions (or reuses) one
 * fixed account per role and logs straight into it, so local development never
 * needs a seeded database to exercise role-gated UI.
 *
 * The handler refuses to run unless the server is in development mode, and
 * main.js only imports this module under the same condition — production
 * builds have no code path to it at all.
 */
import { Meteor } from 'meteor/meteor';
import { Accounts } from 'meteor/accounts-base';
import { MongoInternals } from 'meteor/mongo';

import { Teams, rawDb } from './collections';
import { ensureDefaultOrganization, addOrgMember } from './org-helpers';
import { ensurePersonalTeam } from './teams';

const { ObjectId } = MongoInternals.NpmModules.mongodb.module;

/** Also settable as a normal email/password login, for flows a button can't reach. */
const DEV_PASSWORD = 'DevPass1!';

/** Shared non-personal team so admin/owner screens have members to act on. */
const DEV_TEAM_NAME = 'Dev Team';
const DEV_TEAM_CODE = 'DEVTEAM1';

const DEV_ROLES = {
  member: {
    email: 'dev-member@test.local',
    username: 'dev_member',
    name: 'Dev Member',
    orgRole: 'member',
    teamAdmin: false,
    enterpriseRole: null,
  },
  'org-admin': {
    email: 'dev-admin@test.local',
    username: 'dev_admin',
    name: 'Dev Org Admin',
    orgRole: 'admin',
    teamAdmin: true,
    enterpriseRole: null,
  },
  'org-owner': {
    email: 'dev-owner@test.local',
    username: 'dev_owner',
    name: 'Dev Org Owner',
    orgRole: 'owner',
    teamAdmin: true,
    enterpriseRole: null,
  },
  'enterprise-admin': {
    email: 'dev-enterprise-admin@test.local',
    username: 'dev_ent_admin',
    name: 'Dev Enterprise Admin',
    orgRole: 'admin',
    teamAdmin: true,
    enterpriseRole: 'admin',
  },
  'enterprise-owner': {
    email: 'dev-enterprise-owner@test.local',
    username: 'dev_ent_owner',
    name: 'Dev Enterprise Owner',
    orgRole: 'owner',
    teamAdmin: true,
    enterpriseRole: 'owner',
  },
};

async function ensureDevAccount(spec) {
  const existing = await Meteor.users.findOneAsync({ 'emails.address': spec.email });
  if (existing) return existing._id;

  const userId = await Accounts.createUserAsync({
    email: spec.email,
    password: DEV_PASSWORD,
    username: spec.username,
    profile: { name: spec.name },
  });
  await Meteor.users.updateAsync(userId, { $set: { 'emails.0.verified': true } });
  return userId;
}

async function ensureEnterpriseRole(enterpriseId, userId, role) {
  const [add, remove] = role === 'owner' ? ['owners', 'admins'] : ['admins', 'owners'];
  await rawDb()
    .collection('enterprises')
    .updateOne(
      { _id: new ObjectId(enterpriseId) },
      {
        $addToSet: { [add]: userId },
        $pull: { [remove]: userId },
        $set: { updatedAt: new Date() },
      },
    );
}

async function ensureDevTeam(orgId, userId, teamAdmin) {
  const teams = Teams.rawCollection();
  const now = new Date();

  await teams.updateOne(
    { orgId, name: DEV_TEAM_NAME },
    {
      $setOnInsert: {
        _id: new ObjectId(),
        orgId,
        parentTeamId: null,
        name: DEV_TEAM_NAME,
        members: [],
        admins: [],
        code: DEV_TEAM_CODE,
        isPersonal: false,
        createdAt: now,
      },
    },
    { upsert: true },
  );

  const team = await teams.findOne({ orgId, name: DEV_TEAM_NAME });
  await teams.updateOne(
    { _id: team._id },
    teamAdmin
      ? { $addToSet: { members: userId, admins: userId }, $set: { updatedAt: now } }
      : { $addToSet: { members: userId }, $pull: { admins: userId }, $set: { updatedAt: now } },
  );
}

/** Create the account if needed and grant every permission the role implies. */
async function provisionDevUser(spec) {
  const userId = await ensureDevAccount(spec);
  const org = await ensureDefaultOrganization();
  const orgId = org._id.toHexString();

  await addOrgMember(orgId, userId, spec.orgRole, false);
  if (spec.enterpriseRole && org.enterpriseId) {
    await ensureEnterpriseRole(org.enterpriseId, userId, spec.enterpriseRole);
  }
  await ensurePersonalTeam(userId);
  await ensureDevTeam(orgId, userId, spec.teamAdmin);

  return userId;
}

Accounts.registerLoginHandler('devQuickLogin', async (options) => {
  if (!options.devQuickLogin) return undefined;
  if (!Meteor.isDevelopment) {
    throw new Meteor.Error('forbidden', 'Dev quick login is disabled outside development');
  }

  const spec = DEV_ROLES[options.devQuickLogin.role];
  if (!spec) throw new Meteor.Error('bad-request', 'Unknown dev role');

  const userId = await provisionDevUser(spec);
  console.log(`[dev-quick-login] signed in as ${spec.email} (${options.devQuickLogin.role})`);
  return { userId };
});
