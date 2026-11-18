/**
 * The Pulse settings each team resolves to, with no Meteor or database:
 * `pulseInApp`, `pulseClockInOut` and `pulseSharedDevice` (settings/registry.js).
 * The caller loads the team, org and enterprise documents; this builds each
 * team's inheritance chain the way settings/index.js does and resolves it with
 * the same pure resolver, so a team's answer here equals its
 * `resolvedSettings`. pulseUploadTypes.list hands the result to the app once
 * at start, so the session payload stays as it is.
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
 * `{ [teamId]: { pulseInApp, pulseClockInOut, pulseSharedDevice } }` for every
 * team in `levels.teams`.
 *
 * - `teams`: `{ _id, orgId?, parentTeamId?, isPersonal?, settings? }`. A
 *   parent team counts only when it is in this list too.
 * - `orgs`: `{ _id, enterpriseId?, settings?, settingsLocks? }`.
 * - `enterprises`: `{ _id, settings?, settingsLocks? }`.
 *
 * A team's own value wins over its parent team's, then its org's, then its
 * enterprise's, and a lock at the org or enterprise wins over everything below
 * it. With nothing set, every value is off. A team without an org (or whose
 * org isn't passed) resolves from its own value and its parents'.
 *
 * @param {{ teams?: TeamDoc[], orgs?: OrgDoc[], enterprises?: EnterpriseDoc[] }} [levels]
 * @returns {Record<string, PulseSettings>}
 */
export function pulseSettingsForTeams({ teams = [], orgs = [], enterprises = [] } = {}) {
  const teamsById = new Map(teams.map((team) => [idOf(team), team]));
  const orgsById = new Map(orgs.map((org) => [idOf(org), org]));
  const enterprisesById = new Map(enterprises.map((enterprise) => [idOf(enterprise), enterprise]));

  const chainOf = (team) => {
    const teamId = idOf(team);
    const chain = [{ level: 'team', id: teamId, settings: team.settings }];
    const seen = new Set([teamId]);
    let parentId = team.parentTeamId;
    while (parentId && !seen.has(parentId) && teamsById.has(parentId)) {
      seen.add(parentId);
      const parent = teamsById.get(parentId);
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
