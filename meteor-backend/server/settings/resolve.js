/**
 * Pure resolution of a team's effective settings from its inheritance chain.
 * No Meteor imports, so it is unit-testable (tests/settings-resolve.test.ts).
 *
 * `chain` is ordered nearest first: the team, its parent team(s), its org, its
 * enterprise. Each entry is `{ level, id, settings, settingsLocks }`, where
 * `level` is 'team' | 'org' | 'enterprise'.
 */
import { SETTINGS } from './registry';

/**
 * @typedef {Object} ResolvedSetting
 * @property {unknown} value
 * @property {string} source
 * @property {string} [sourceId]
 * @property {boolean} locked
 */

/**
 * @typedef {Object} ChainEntry
 * @property {'team'|'org'|'enterprise'} level
 * @property {string} id
 * @property {Record<string, unknown>} [settings]
 * @property {Record<string, boolean>} [settingsLocks]
 */

const LOCKING_LEVELS = ['enterprise', 'org'];

// The first team in the chain is the team itself; later ones are its parents.
function sourceOf(entry, index) {
  return entry.level === 'team' && index > 0 ? 'parentTeam' : entry.level;
}

function explicitValue(entry, key, def) {
  if (!def.levels.includes(entry.level)) return undefined;
  const value = entry.settings?.[key];
  return typeof value === def.type ? value : undefined;
}

// A lock only counts where its level holds a value for the key.
function highestLock(chain, key, def) {
  for (let i = chain.length - 1; i >= 0; i -= 1) {
    const entry = chain[i];
    if (!LOCKING_LEVELS.includes(entry.level)) continue;
    if (entry.settingsLocks?.[key] === true && explicitValue(entry, key, def) !== undefined) {
      return i;
    }
  }
  return -1;
}

function resolveKey(chain, key, def, isPersonal) {
  if (isPersonal && def.personalExempt) {
    return { value: def.exemptValue, source: 'personal', locked: true };
  }

  const lockedAt = highestLock(chain, key, def);
  if (lockedAt !== -1) {
    const entry = chain[lockedAt];
    return {
      value: explicitValue(entry, key, def),
      source: sourceOf(entry, lockedAt),
      sourceId: entry.id,
      locked: true,
    };
  }

  for (let i = 0; i < chain.length; i += 1) {
    const value = explicitValue(chain[i], key, def);
    if (value !== undefined) {
      return { value, source: sourceOf(chain[i], i), sourceId: chain[i].id, locked: false };
    }
  }
  return { value: def.default, source: 'system', locked: false };
}

/**
 * @param {ChainEntry[]} chain
 * @param {{ isPersonal?: boolean }} [options]
 * @returns {Record<keyof typeof SETTINGS, ResolvedSetting>}
 */
export function resolveFromChain(chain, { isPersonal = false } = {}) {
  const resolved = {};
  for (const [key, def] of Object.entries(SETTINGS)) {
    resolved[key] = resolveKey(chain, key, def, isPersonal);
  }
  return resolved;
}
