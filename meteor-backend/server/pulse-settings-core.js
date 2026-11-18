/**
 * The Pulse settings each team resolves to, with no Meteor or database:
 * `pulseInApp`, `pulseClockInOut` and `pulseSharedDevice` (settings/registry.js).
 * The caller loads the team, org and enterprise documents; this builds each
 * team's inheritance chain the way settings/index.js does and resolves it with
 * the same pure resolver. A team's answer here equals its `resolvedSettings`
 * only when every team above it is passed too, in `teams` or `ancestorTeams`:
 * settings/index.js loads parent teams from the database, while this stops at
 * the first parent it was not given and goes on to the org. So a caller that
 * answers for a user's teams (pulseUploadTypes.list) also loads the
 * parentTeamId chain of each into `ancestorTeams`, which counts for
 * inheritance but gets no answer of its own. pulseUploadTypes.list hands the
 * result to the app once at start, so the session payload stays as it is.
 */
import { resolveFromChain } from './settings/resolve.js';

export const PULSE_SETTING_KEYS = ['pulseInApp', 'pulseClockInOut', 'pulseSharedDevice'];

/**
 * @typedef {'pulseInApp' | 'pulseClockInOut' | 'pulseSharedDevice'} PulseSettingKey
 * @typedef {Record<PulseSettingKey, boolean>} PulseSettings
 * @typedef {string | { toHexString(): string }} DocId
 * @typedef {{ _id?: DocId, id?: string, orgId?: string, parentTeamId?: string, isPersonal?: boolean,
 *   settings?: Record<string, unknown> }} TeamDoc
 * @typedef {{ _id?: DocId, id?: string, enterpriseId?: string, settings?: Record<string, unknown>,
 *   settingsLocks?: Record<string, boolean> }} OrgDoc
 * @typedef {{ _id?: DocId, id?: string, settings?: Record<string, unknown>,
 *   settingsLocks?: Record<string, boolean> }} EnterpriseDoc
 */

// Documents carry `_id` as a string or an ObjectId; plain objects may carry `id`.
/** @param {{ _id?: DocId, id?: string }} doc */
function idOf(doc) {
  const id = doc._id ?? doc.id;
  if (id == null) return undefined;
  return typeof id === 'string' ? id : id.toHexString();
}

/**
 * The Pulse values, as plain booleans, out of one resolveFromChain() result.
 * @param {Record<string, { value: unknown }>} resolved
 * @returns {PulseSettings}
 */
export function pulseSettingsOf(resolved) {
  return /** @type {PulseSettings} */ (
    Object.fromEntries(PULSE_SETTING_KEYS.map((key) => [key, resolved[key].value === true]))
  );
}

/**
 * The Pulse entries of one resolveFromChain() result as a team's
 * `resolvedSettings` carries them to the client, each `{ value, source, locked,
 * sourceId? }`. publicTeamSettings (settings/index.js) spreads this in, which is
 * what gives Settings → Team its Pulse rows.
 * @template T
 * @param {Record<string, T>} resolved
 * @returns {Record<PulseSettingKey, T>}
 */
export function publicPulseSettings(resolved) {
  return /** @type {Record<PulseSettingKey, T>} */ (
    Object.fromEntries(PULSE_SETTING_KEYS.map((key) => [key, resolved[key]]))
  );
}

/**
 * `{ [teamId]: { pulseInApp, pulseClockInOut, pulseSharedDevice } }` for every
 * team in `levels.teams`.
 *
 * - `teams`: `{ _id, orgId?, parentTeamId?, isPersonal?, settings? }`, the
 *   teams to answer for.
 * - `ancestorTeams`: parent teams (same shape) that are not answered for but
 *   count when a team in `teams` inherits from them. A parent team counts only
 *   when it is in `teams` or here; past a missing one the chain goes on to
 *   the org.
 * - `orgs`: `{ _id, enterpriseId?, settings?, settingsLocks? }`.
 * - `enterprises`: `{ _id, settings?, settingsLocks? }`.
 *
 * A team's own value wins over its parent team's, then its org's, then its
 * enterprise's, and a lock at the org or enterprise wins over everything below
 * it. With nothing set, every value is off. A team without an org (or whose
 * org isn't passed) resolves from its own value and its parents'.
 *
 * @param {{ teams?: TeamDoc[], ancestorTeams?: TeamDoc[], orgs?: OrgDoc[],
 *   enterprises?: EnterpriseDoc[] }} [levels]
 * @returns {Record<string, PulseSettings>}
 */
export function pulseSettingsForTeams({ teams = [], ancestorTeams = [], orgs = [], enterprises = [] } = {}) {
  const teamsById = new Map(teams.map((team) => [idOf(team), team]));
  // Every team a chain may walk through: the answered teams win over an ancestor copy.
  const chainTeamsById = new Map([...ancestorTeams.map((team) => [idOf(team), team]), ...teamsById]);
  const orgsById = new Map(orgs.map((org) => [idOf(org), org]));
  const enterprisesById = new Map(enterprises.map((enterprise) => [idOf(enterprise), enterprise]));

  const chainOf = (team) => {
    const teamId = idOf(team);
    const chain = [{ level: 'team', id: teamId, settings: team.settings }];
    const seen = new Set([teamId]);
    let parentId = team.parentTeamId;
    while (parentId && !seen.has(parentId) && chainTeamsById.has(parentId)) {
      seen.add(parentId);
      const parent = chainTeamsById.get(parentId);
      chain.push({ level: 'team', id: parentId, settings: parent.settings });
      parentId = parent.parentTeamId;
    }
    const org = team.orgId ? orgsById.get(team.orgId) : undefined;
    if (org) {
      chain.push({ level: 'org', id: team.orgId, settings: org.settings, settingsLocks: org.settingsLocks });
      const enterprise = org.enterpriseId ? enterprisesById.get(org.enterpriseId) : undefined;
      if (enterprise) {
        chain.push({
          level: 'enterprise',
          id: org.enterpriseId,
          settings: enterprise.settings,
          settingsLocks: enterprise.settingsLocks,
        });
      }
    }
    return chain;
  };

  /** @type {Record<string, PulseSettings>} */
  const result = {};
  for (const [teamId, team] of teamsById) {
    if (!teamId) continue;
    const resolved = resolveFromChain(chainOf(team), { isPersonal: team.isPersonal === true });
    result[teamId] = pulseSettingsOf(resolved);
  }
  return result;
}
