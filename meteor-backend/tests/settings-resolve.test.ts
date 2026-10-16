/**
 * Unit tests for the settings resolver (server/settings/resolve.js), #607.
 *
 * An absent key means "inherit"; a lock at a higher level wins over every
 * explicit value below it.
 */
import { describe, it, expect } from 'vitest';

import { resolveFromChain } from '../server/settings/resolve';

type Entry = {
  level: 'team' | 'org' | 'enterprise';
  id: string;
  settings?: Record<string, unknown>;
  settingsLocks?: Record<string, true>;
};

const team = (settings?: Entry['settings']): Entry => ({ level: 'team', id: 'team1', settings });
const parentTeam = (settings?: Entry['settings']): Entry => ({
  level: 'team',
  id: 'parent1',
  settings,
});
const org = (settings?: Entry['settings'], settingsLocks?: Entry['settingsLocks']): Entry => ({
  level: 'org',
  id: 'org1',
  settings,
  settingsLocks,
});
const enterprise = (
  settings?: Entry['settings'],
  settingsLocks?: Entry['settingsLocks'],
): Entry => ({ level: 'enterprise', id: 'ent1', settings, settingsLocks });

describe('resolveFromChain', () => {
  it('falls back to the registry default when nothing is set', () => {
    const resolved = resolveFromChain([team(), org(), enterprise()]);
    expect(resolved.requirePlanForClock).toEqual({
      value: true,
      source: 'system',
      locked: false,
    });
    expect(resolved.autoAcceptJoins.value).toBe(false);
    expect(resolved.allowAutoJoin.value).toBe(true);
  });

  it('prefers the team value over org and enterprise values', () => {
    const resolved = resolveFromChain([
      team({ requirePlanForClock: false }),
      org({ requirePlanForClock: true }),
      enterprise({ requirePlanForClock: true }),
    ]);
    expect(resolved.requirePlanForClock).toEqual({
      value: false,
      source: 'team',
      sourceId: 'team1',
      locked: false,
    });
  });

  it('lets a sub-team inherit from its parent team before the org', () => {
    const resolved = resolveFromChain([
      team(),
      parentTeam({ autoAcceptJoins: true }),
      org({ autoAcceptJoins: false }),
    ]);
    expect(resolved.autoAcceptJoins).toEqual({
      value: true,
      source: 'parentTeam',
      sourceId: 'parent1',
      locked: false,
    });
  });

  it('prefers the org value over the enterprise value', () => {
    const resolved = resolveFromChain([
      team(),
      org({ requirePlanForClock: false }),
      enterprise({ requirePlanForClock: true }),
    ]);
    expect(resolved.requirePlanForClock).toMatchObject({ value: false, source: 'org' });
  });

  it('uses the enterprise value when the team and org are unset', () => {
    const resolved = resolveFromChain([
      team(),
      org(),
      enterprise({ requirePlanForClock: false }),
    ]);
    expect(resolved.requirePlanForClock).toEqual({
      value: false,
      source: 'enterprise',
      sourceId: 'ent1',
      locked: false,
    });
  });

  it("overrides a team's explicit value with an org lock", () => {
    const resolved = resolveFromChain([
      team({ autoAcceptJoins: true }),
      org({ autoAcceptJoins: false }, { autoAcceptJoins: true }),
    ]);
    expect(resolved.autoAcceptJoins).toEqual({
      value: false,
      source: 'org',
      sourceId: 'org1',
      locked: true,
    });
  });

  it('lets an enterprise lock override an org lock', () => {
    const resolved = resolveFromChain([
      team(),
      org({ requirePlanForClock: false }, { requirePlanForClock: true }),
      enterprise({ requirePlanForClock: true }, { requirePlanForClock: true }),
    ]);
    expect(resolved.requirePlanForClock).toMatchObject({
      value: true,
      source: 'enterprise',
      locked: true,
    });
  });

  it('ignores a lock on a key the level does not hold a value for', () => {
    const resolved = resolveFromChain([
      team({ autoAcceptJoins: true }),
      org(undefined, { autoAcceptJoins: true }),
    ]);
    expect(resolved.autoAcceptJoins).toMatchObject({ value: true, source: 'team', locked: false });
  });

  it('never gates a Personal team, even when higher levels set or lock the plan', () => {
    const resolved = resolveFromChain(
      [
        team(),
        org({ requirePlanForClock: true }, { requirePlanForClock: true }),
        enterprise({ requirePlanForClock: true }, { requirePlanForClock: true }),
      ],
      { isPersonal: true },
    );
    expect(resolved.requirePlanForClock).toEqual({
      value: false,
      source: 'personal',
      locked: true,
    });
    expect(resolved.autoAcceptJoins.source).toBe('system');
  });

  it('ignores a key set at a level the registry does not allow', () => {
    const resolved = resolveFromChain([
      team({ allowAutoJoin: false }),
      org(),
      enterprise({ allowAutoJoin: false }),
    ]);
    expect(resolved.allowAutoJoin).toMatchObject({ value: false, source: 'enterprise' });

    const teamOnly = resolveFromChain([team({ allowAutoJoin: false }), org()]);
    expect(teamOnly.allowAutoJoin).toMatchObject({ value: true, source: 'system' });
  });

  it('ignores stored values that are not booleans', () => {
    const resolved = resolveFromChain([team({ requirePlanForClock: 'yes' }), org()]);
    expect(resolved.requirePlanForClock.source).toBe('system');
  });
});
