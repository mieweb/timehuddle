/**
 * Pure validation of a settings write and the Mongo update it becomes. No
 * Meteor imports, so it is unit-testable (tests/settings-write.test.ts).
 *
 * A patch maps a setting key to `true | false` to set it or `null` to reset it
 * to inherited. Lock patches use `true` to lock and `false | null` to unlock.
 */
import { SETTINGS } from './registry';

export class SettingsInputError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const LEVEL_LABELS = { org: 'the organization', enterprise: 'the enterprise' };

function definitionFor(key, level) {
  if (!Object.hasOwn(SETTINGS, key)) {
    throw new SettingsInputError('bad-request', `Unknown setting: ${key}`);
  }
  const def = SETTINGS[key];
  if (!def.levels.includes(level)) {
    throw new SettingsInputError('bad-request', `${key} cannot be set on a ${level}`);
  }
  return def;
}

function assertPatch(patch, name) {
  if (patch == null) return;
  if (typeof patch !== 'object' || Array.isArray(patch)) {
    throw new SettingsInputError('bad-request', `${name} must be an object`);
  }
}

// A team is blocked by any lock above it; an org only by its enterprise's.
function assertNotLockedAbove(key, level, resolved) {
  const effective = resolved?.[key];
  if (!effective?.locked) return;
  if (effective.source === 'personal') {
    throw new SettingsInputError('forbidden', `${key} does not apply to a Personal team`);
  }
  const lockedAbove = level === 'team' || (level === 'org' && effective.source === 'enterprise');
  if (lockedAbove) {
    const holder = LEVEL_LABELS[effective.source] ?? 'a higher level';
    throw new SettingsInputError('forbidden', `Setting ${key} is locked by ${holder}`);
  }
}

function applySettingsPatch(patch, level, resolved, next) {
  assertPatch(patch, 'settings');
  for (const [key, value] of Object.entries(patch ?? {})) {
    const def = definitionFor(key, level);
    assertNotLockedAbove(key, level, resolved);
    if (value === null) {
      next.unset[`settings.${key}`] = '';
      delete next.settings[key];
    } else if (typeof value === def.type) {
      next.set[`settings.${key}`] = value;
      next.settings[key] = value;
    } else {
      throw new SettingsInputError('bad-request', `${key} must be a ${def.type} or null`);
    }
  }
}

function applyLocksPatch(patch, level, resolved, next) {
  assertPatch(patch, 'locks');
  const entries = Object.entries(patch ?? {});
  if (entries.length > 0 && level === 'team') {
    throw new SettingsInputError('bad-request', 'A team cannot lock settings');
  }
  for (const [key, value] of entries) {
    definitionFor(key, level);
    assertNotLockedAbove(key, level, resolved);
    if (value === true) {
      next.set[`settingsLocks.${key}`] = true;
      next.locks[key] = true;
      // Written with the lock so a concurrent reset can't leave a lock without a value.
      if (next.settings[key] !== undefined) next.set[`settings.${key}`] = next.settings[key];
    } else if (value === false || value === null) {
      next.unset[`settingsLocks.${key}`] = '';
      delete next.locks[key];
    } else {
      throw new SettingsInputError('bad-request', `Lock for ${key} must be true, false or null`);
    }
  }
}

/**
 * `current` is the entity's stored `{ settings, settingsLocks }`; `resolved` is
 * its effective settings from the resolver, used to refuse locked keys.
 * `settings`/`locks` are left loosely typed (`unknown`) since this function's
 * job is to validate their shape and value types at runtime and throw
 * `SettingsInputError` for anything invalid.
 * Returns the Mongo `$set` / `$unset` maps (either may be empty).
 * @param {Object} params
 * @param {string} params.level
 * @param {{ settings?: Record<string, unknown>, settingsLocks?: Record<string, boolean> }} [params.current]
 * @param {Record<string, { value: unknown, source: string, sourceId?: string, locked: boolean }>} [params.resolved]
 * @param {unknown} [params.settings]
 * @param {unknown} [params.locks]
 */
export function buildSettingsUpdate({ level, current = {}, resolved, settings, locks }) {
  const next = {
    set: {},
    unset: {},
    settings: { ...current.settings },
    locks: { ...current.settingsLocks },
  };
  applySettingsPatch(settings, level, resolved, next);
  applyLocksPatch(locks, level, resolved, next);

  // The resolver ignores a lock on an unset value, so never store one.
  for (const key of Object.keys(next.locks)) {
    if (next.settings[key] === undefined) {
      throw new SettingsInputError('bad-request', `${key} needs a value while it is locked`);
    }
  }
  return { $set: next.set, $unset: next.unset };
}

// The Mongo update document for a built update, stamped with `updatedAt`.
export function toMongoUpdate({ $set, $unset }, updatedAt) {
  const update = { $set: { ...$set, updatedAt } };
  if (Object.keys($unset).length > 0) update.$unset = $unset;
  return update;
}
