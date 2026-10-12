/**
 * Unit tests for the settings write rules (server/settings/write.js), #607.
 *
 * `null` resets a setting to inherited, a lock above blocks the write, and a
 * lock only exists on a level that holds a value for it.
 */
import { describe, it, expect } from 'vitest';

import { buildSettingsUpdate, toMongoUpdate } from '../server/settings/write';

const resolvedLockedBy = (source: string, key = 'autoAcceptJoins') => ({
  [key]: { value: false, source, locked: true },
});

describe('buildSettingsUpdate', () => {
  it('sets booleans and unsets nulls', () => {
    const update = buildSettingsUpdate({
      level: 'team',
      settings: { requirePlanForClock: false, autoAcceptJoins: null },
    });
    expect(update.$set).toEqual({ 'settings.requirePlanForClock': false });
    expect(update.$unset).toEqual({ 'settings.autoAcceptJoins': '' });
  });

  it('rejects an unknown key', () => {
    expect(() => buildSettingsUpdate({ level: 'team', settings: { nope: true } })).toThrow(
      /Unknown setting/,
    );
  });

  it('rejects a key the registry does not allow at the level', () => {
    expect(() =>
      buildSettingsUpdate({ level: 'team', settings: { allowAutoJoin: true } }),
    ).toThrow(/cannot be set on a team/);
  });

  it('rejects a value of the wrong type', () => {
    expect(() =>
      buildSettingsUpdate({ level: 'team', settings: { requirePlanForClock: 'yes' } }),
    ).toThrow(/must be a boolean or null/);
  });

  it('rejects a patch that is not an object', () => {
    expect(() => buildSettingsUpdate({ level: 'org', settings: 'on' })).toThrow(/must be an object/);
  });

  it('blocks a team from a key an org locked, including a reset', () => {
    const resolved = resolvedLockedBy('org');
    expect(() =>
      buildSettingsUpdate({ level: 'team', resolved, settings: { autoAcceptJoins: true } }),
    ).toThrow(/locked by the organization/);
    expect(() =>
      buildSettingsUpdate({ level: 'team', resolved, settings: { autoAcceptJoins: null } }),
    ).toThrow(/locked by the organization/);
  });

  it('blocks a Personal team from the plan setting', () => {
    expect(() =>
      buildSettingsUpdate({
        level: 'team',
        resolved: resolvedLockedBy('personal', 'requirePlanForClock'),
        settings: { requirePlanForClock: true },
      }),
    ).toThrow(/Personal team/);
  });

  it('blocks an org from a key its enterprise locked but not from its own lock', () => {
    expect(() =>
      buildSettingsUpdate({
        level: 'org',
        resolved: resolvedLockedBy('enterprise'),
        settings: { autoAcceptJoins: true },
      }),
    ).toThrow(/locked by the enterprise/);

    const update = buildSettingsUpdate({
      level: 'org',
      current: { settings: { autoAcceptJoins: false }, settingsLocks: { autoAcceptJoins: true } },
      resolved: resolvedLockedBy('org'),
      settings: { autoAcceptJoins: true },
    });
    expect(update.$set).toEqual({ 'settings.autoAcceptJoins': true });
  });

  it('never blocks an enterprise', () => {
    const update = buildSettingsUpdate({
      level: 'enterprise',
      resolved: resolvedLockedBy('enterprise'),
      settings: { autoAcceptJoins: true },
    });
    expect(update.$set).toEqual({ 'settings.autoAcceptJoins': true });
  });

  it('does not let a team lock anything', () => {
    expect(() =>
      buildSettingsUpdate({ level: 'team', locks: { autoAcceptJoins: true } }),
    ).toThrow(/cannot lock/);
  });

  it('locks a value set in the same write and unlocks with false or null', () => {
    const lock = buildSettingsUpdate({
      level: 'org',
      settings: { autoAcceptJoins: false },
      locks: { autoAcceptJoins: true },
    });
    expect(lock.$set).toEqual({
      'settings.autoAcceptJoins': false,
      'settingsLocks.autoAcceptJoins': true,
    });

    const unlock = buildSettingsUpdate({
      level: 'org',
      current: { settings: { autoAcceptJoins: false }, settingsLocks: { autoAcceptJoins: true } },
      locks: { autoAcceptJoins: null },
    });
    expect(unlock.$unset).toEqual({ 'settingsLocks.autoAcceptJoins': '' });
  });

  it('refuses a lock on a value that is not set', () => {
    expect(() =>
      buildSettingsUpdate({ level: 'org', locks: { requirePlanForClock: true } }),
    ).toThrow(/needs a value while it is locked/);
  });

  it('refuses to reset a value that is still locked', () => {
    expect(() =>
      buildSettingsUpdate({
        level: 'org',
        current: { settings: { autoAcceptJoins: false }, settingsLocks: { autoAcceptJoins: true } },
        settings: { autoAcceptJoins: null },
      }),
    ).toThrow(/needs a value while it is locked/);
  });
});

describe('toMongoUpdate', () => {
  const at = new Date('2026-01-01T00:00:00Z');

  it('stamps updatedAt and omits an empty $unset', () => {
    expect(toMongoUpdate({ $set: { 'settings.a': true }, $unset: {} }, at)).toEqual({
      $set: { 'settings.a': true, updatedAt: at },
    });
  });

  it('keeps $unset when there is something to unset', () => {
    expect(toMongoUpdate({ $set: {}, $unset: { 'settings.a': '' } }, at)).toEqual({
      $set: { updatedAt: at },
      $unset: { 'settings.a': '' },
    });
  });
});
