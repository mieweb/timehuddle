/**
 * Unit tests for pulse-settings-core (server/pulse-settings-core.js): the Pulse
 * settings each team resolves to, and the registry entries behind them
 * (server/settings/registry.js), following tests/settings-resolve.test.ts and
 * tests/settings-write.test.ts.
 */
import { describe, it, expect } from 'vitest';

import { PULSE_SETTING_KEYS, pulseSettingsForTeams } from '../server/pulse-settings-core';
import { SETTINGS } from '../server/settings/registry';
import { resolveFromChain } from '../server/settings/resolve';
import { buildSettingsUpdate } from '../server/settings/write';

type Settings = Record<string, unknown>;
type Locks = Record<string, true>;

const OFF = { pulseInApp: false, pulseClockInOut: false, pulseSharedDevice: false };

const team = (id: string, extra: { orgId?: string; parentTeamId?: string; isPersonal?: boolean; settings?: Settings } = {}) => ({
  _id: id,
  ...extra,
});
const org = (id: string, extra: { enterpriseId?: string; settings?: Settings; settingsLocks?: Locks } = {}) => ({
  _id: id,
  ...extra,
});
const enterprise = (id: string, extra: { settings?: Settings; settingsLocks?: Locks } = {}) => ({
  _id: id,
  ...extra,
});

describe('registry', () => {
  it.each(PULSE_SETTING_KEYS)('declares %s off by default at every level, like requirePlanForClock', (key) => {
    expect(SETTINGS[key as keyof typeof SETTINGS]).toEqual({
      type: 'boolean',
      default: false,
      levels: ['enterprise', 'org', 'team'],
      personalExempt: false,
    });
  });

  it.each(PULSE_SETTING_KEYS)('resolves %s to the off default when nothing is set', (key) => {
    const resolved = resolveFromChain([{ level: 'team', id: 'team1' }]) as Record<string, unknown>;
    expect(resolved[key]).toEqual({ value: false, source: 'system', locked: false });
  });

  it.each(['team', 'org', 'enterprise'])('accepts each Pulse setting and its lock on a %s', (level) => {
    const settings = { pulseInApp: true, pulseClockInOut: false, pulseSharedDevice: null };
    const update = buildSettingsUpdate({
      level,
      settings,
      ...(level === 'team' ? {} : { locks: { pulseInApp: true } }),
    });
    expect(update.$set).toMatchObject({ 'settings.pulseInApp': true, 'settings.pulseClockInOut': false });
    expect(update.$unset).toEqual({ 'settings.pulseSharedDevice': '' });
    if (level !== 'team') expect(update.$set).toMatchObject({ 'settingsLocks.pulseInApp': true });
  });
});

describe('pulseSettingsForTeams', () => {
  it('turns everything off when no level sets anything', () => {
    expect(
      pulseSettingsForTeams({
        teams: [team('t1', { orgId: 'o1' })],
        orgs: [org('o1', { enterpriseId: 'e1' })],
        enterprises: [enterprise('e1')],
      }),
    ).toEqual({ t1: OFF });
  });

  it('answers for every team passed, and nothing for no teams', () => {
    expect(pulseSettingsForTeams({ teams: [team('t1'), team('t2')] })).toEqual({ t1: OFF, t2: OFF });
    expect(pulseSettingsForTeams({})).toEqual({});
    expect(pulseSettingsForTeams()).toEqual({});
  });

  it('takes the enterprise value when the org and team set nothing', () => {
    const result = pulseSettingsForTeams({
      teams: [team('t1', { orgId: 'o1' })],
      orgs: [org('o1', { enterpriseId: 'e1' })],
      enterprises: [enterprise('e1', { settings: { pulseInApp: true, pulseSharedDevice: true } })],
    });
    expect(result.t1).toEqual({ pulseInApp: true, pulseClockInOut: false, pulseSharedDevice: true });
  });

  it('prefers the org over the enterprise, and the team over both', () => {
    const levels = {
      orgs: [org('o1', { enterpriseId: 'e1', settings: { pulseInApp: false, pulseClockInOut: true } })],
      enterprises: [enterprise('e1', { settings: { pulseInApp: true, pulseClockInOut: false, pulseSharedDevice: true } })],
    };
    const result = pulseSettingsForTeams({
      ...levels,
      teams: [team('inherits', { orgId: 'o1' }), team('own', { orgId: 'o1', settings: { pulseInApp: true, pulseClockInOut: false, pulseSharedDevice: false } })],
    });
    expect(result.inherits).toEqual({ pulseInApp: false, pulseClockInOut: true, pulseSharedDevice: true });
    expect(result.own).toEqual({ pulseInApp: true, pulseClockInOut: false, pulseSharedDevice: false });
  });

  it('lets a lock above win over the team value', () => {
    const result = pulseSettingsForTeams({
      teams: [team('t1', { orgId: 'o1', settings: { pulseInApp: true } })],
      orgs: [org('o1', { enterpriseId: 'e1', settings: { pulseInApp: true } })],
      enterprises: [enterprise('e1', { settings: { pulseInApp: false }, settingsLocks: { pulseInApp: true } })],
    });
    expect(result.t1.pulseInApp).toBe(false);
  });

  it('inherits from a parent team passed alongside', () => {
    const result = pulseSettingsForTeams({
      teams: [
        team('child', { orgId: 'o1', parentTeamId: 'parent' }),
        team('parent', { orgId: 'o1', settings: { pulseClockInOut: true } }),
      ],
      orgs: [org('o1', { settings: { pulseClockInOut: false, pulseInApp: true } })],
    });
    expect(result.child).toEqual({ pulseInApp: true, pulseClockInOut: true, pulseSharedDevice: false });
  });

  it('inherits from an ancestor team it does not answer for', () => {
    const orgs = [org('o1', { settings: { pulseSharedDevice: false } })];
    const child = team('child', { orgId: 'o1', parentTeamId: 'parent' });
    const parent = team('parent', { orgId: 'o1', parentTeamId: 'grand' });
    const grand = team('grand', { orgId: 'o1', settings: { pulseSharedDevice: true } });

    // A member of the sub-team only: without its parents, the chain skips to the org.
    expect(pulseSettingsForTeams({ teams: [child], orgs }).child.pulseSharedDevice).toBe(false);

    const result = pulseSettingsForTeams({ teams: [child], ancestorTeams: [parent, grand], orgs });
    expect(result.child.pulseSharedDevice).toBe(true);
    expect(Object.keys(result)).toEqual(['child']);
  });

  it('resolves a team without an org from its own values alone', () => {
    const result = pulseSettingsForTeams({
      teams: [team('solo', { settings: { pulseSharedDevice: true } }), team('missing-org', { orgId: 'gone' })],
      orgs: [org('other', { settings: { pulseInApp: true } })],
    });
    expect(result.solo).toEqual({ pulseInApp: false, pulseClockInOut: false, pulseSharedDevice: true });
    expect(result['missing-org']).toEqual(OFF);
  });

  it('applies the settings to a personal team too', () => {
    const result = pulseSettingsForTeams({
      teams: [team('mine', { isPersonal: true, settings: { pulseInApp: true } })],
    });
    expect(result.mine.pulseInApp).toBe(true);
  });

  it('ignores a value that is not a boolean', () => {
    const result = pulseSettingsForTeams({
      teams: [team('t1', { orgId: 'o1', settings: { pulseInApp: 'yes' } })],
      orgs: [org('o1', { settings: { pulseInApp: true } })],
    });
    expect(result.t1.pulseInApp).toBe(true);
  });

  it('keys teams by an ObjectId-like id as hex', () => {
    const objectId = { toHexString: () => 'a'.repeat(24) };
    const result = pulseSettingsForTeams({ teams: [{ _id: objectId, settings: { pulseInApp: true } }] });
    expect(Object.keys(result)).toEqual(['a'.repeat(24)]);
    expect(result['a'.repeat(24)].pulseInApp).toBe(true);
  });
});
