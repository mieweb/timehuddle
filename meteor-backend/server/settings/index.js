/**
 * Loads a team's inheritance chain (parent teams, org, enterprise) and
 * resolves it with the pure resolver. Every server read of a hierarchical
 * setting goes through here, never through the raw `settings` field.
 */
import { MongoInternals } from 'meteor/mongo';
import { rawDb, isValidId } from '../collections';
import { addOrgMember } from '../org-helpers';
import { resolveFromChain } from './resolve';

const { ObjectId } = MongoInternals.NpmModules.mongodb.module;

const PROJECTION = { settings: 1, settingsLocks: 1, parentTeamId: 1, enterpriseId: 1 };

function idOf(id) {
  return typeof id === 'string' ? id : id.toHexString();
}

// Legacy teams and orgs can carry non-ObjectId string ids.
function toDocId(id) {
  return /^[0-9a-f]{24}$/i.test(id) ? new ObjectId(id) : id;
}

// One loader per call, so a list of teams reads each org/enterprise once.
function createLoader() {
  const cache = new Map();
  const load = (collection, id) => {
    if (!isValidId(id)) return Promise.resolve(null);
    const key = `${collection}:${id}`;
    if (!cache.has(key)) {
      cache.set(
        key,
        rawDb().collection(collection).findOne({ _id: toDocId(id) }, { projection: PROJECTION }),
      );
    }
    return cache.get(key);
  };
  return {
    team: (id) => load('teams', id),
    org: (id) => load('organizations', id),
    enterprise: (id) => load('enterprises', id),
  };
}

async function loadOrgAndEnterprise(orgId, loader) {
  const chain = [];
  const org = await loader.org(orgId);
  if (!org) return chain;
  chain.push({ level: 'org', id: orgId, settings: org.settings, settingsLocks: org.settingsLocks });
  const enterprise = await loader.enterprise(org.enterpriseId);
  if (enterprise) {
    chain.push({
      level: 'enterprise',
      id: org.enterpriseId,
      settings: enterprise.settings,
      settingsLocks: enterprise.settingsLocks,
    });
  }
  return chain;
}

async function resolveTeam(team, loader) {
  const teamId = idOf(team._id);
  const chain = [{ level: 'team', id: teamId, settings: team.settings }];
  const seen = new Set([teamId]);
  let parentId = team.parentTeamId;
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    const parent = await loader.team(parentId);
    if (!parent) break;
    chain.push({ level: 'team', id: parentId, settings: parent.settings });
    parentId = parent.parentTeamId;
  }
  chain.push(...(await loadOrgAndEnterprise(team.orgId, loader)));
  return resolveFromChain(chain, { isPersonal: team.isPersonal === true });
}

export function resolveSettings(team) {
  return resolveTeam(team, createLoader());
}

export function resolveSettingsForTeams(teams) {
  const loader = createLoader();
  return Promise.all(teams.map((team) => resolveTeam(team, loader)));
}

// An org's effective settings: its own value, then its enterprise's, then the default.
export async function resolveOrgSettings(org) {
  const chain = await loadOrgAndEnterprise(idOf(org._id), createLoader());
  return resolveFromChain(chain);
}

// The one place the org auto-join rule is applied when someone joins a team.
export async function addMemberToTeamOrgIfAllowed(team, userId) {
  if (!isValidId(team.orgId)) return;
  const resolved = await resolveSettings(team);
  if (resolved.allowAutoJoin.value) await addOrgMember(team.orgId, userId, 'member', true);
}
