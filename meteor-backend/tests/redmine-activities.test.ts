/**
 * Unit tests for redmine-activities (server/redmine-activities.js).
 *
 * Redmine rejects a time entry with no activity and the target instance has no
 * `is_default` one, so the fallback chain is what makes a write possible at all.
 * `reason` is asserted alongside the choice because the UI uses it to tell the
 * user which rule fired rather than picking silently on their behalf.
 */
import { describe, it, expect } from 'vitest';

import {
  activityForTracker,
  pickDefaultActivity,
  toActivityList,
  toProjectActivities,
} from '../server/redmine-activities';

const DESIGN = { id: 8, name: 'Design', isDefault: false };
const DEVELOPMENT = { id: 9, name: 'Development', isDefault: false };
const QA = { id: 10, name: 'QA', isDefault: false };

describe('toActivityList', () => {
  it('shapes the raw enumeration and preserves is_default', () => {
    expect(
      toActivityList([
        { id: 8, name: 'Design' },
        { id: 9, name: 'Development', is_default: true },
      ]),
    ).toEqual([
      { id: 8, name: 'Design', isDefault: false },
      { id: 9, name: 'Development', isDefault: true },
    ]);
  });

  it('leaves out an inactive activity, which Redmine would refuse', () => {
    expect(
      toActivityList([
        { id: 8, name: 'Design', active: false },
        { id: 9, name: 'Development', active: true },
        // A project's list and older Redmine versions carry no flag.
        { id: 10, name: 'QA' },
      ]).map((a) => a.name),
    ).toEqual(['Development', 'QA']);
  });

  it('drops entries with no id and tolerates a non-array', () => {
    expect(toActivityList([{ name: 'Nameless' }, null])).toEqual([]);
    expect(toActivityList(undefined as never)).toEqual([]);
  });
});

describe('pickDefaultActivity', () => {
  it('derives from the tracker first (D4)', () => {
    expect(pickDefaultActivity([DESIGN, DEVELOPMENT], 'Bug')).toEqual({
      activity: DEVELOPMENT,
      reason: 'tracker',
    });
  });

  it('ignores an unknown tracker and carries on down the chain', () => {
    expect(pickDefaultActivity([DESIGN, DEVELOPMENT], 'Epic').reason).toBe('named');
  });

  it("prefers the instance's own default over the Development convention", () => {
    const flagged = { id: 8, name: 'Design', isDefault: true };

    expect(pickDefaultActivity([flagged, DEVELOPMENT], null)).toEqual({
      activity: flagged,
      reason: 'is_default',
    });
  });

  it('falls back to one named Development, case-insensitively', () => {
    const lower = { id: 9, name: 'development', isDefault: false };

    expect(pickDefaultActivity([DESIGN, lower], null)).toEqual({ activity: lower, reason: 'named' });
  });

  it('falls back to the first activity when nothing else matches', () => {
    expect(pickDefaultActivity([DESIGN, QA], null)).toEqual({ activity: DESIGN, reason: 'first' });
  });

  it('chooses from a project’s reduced list, not the instance’s', () => {
    // The project has Development switched off, so the tracker rule finds nothing.
    expect(pickDefaultActivity([DESIGN, QA], 'Bug')).toEqual({ activity: DESIGN, reason: 'first' });
  });

  it('reports none for a project with no usable activity', () => {
    expect(pickDefaultActivity([], 'Bug')).toEqual({ activity: null, reason: 'none' });
  });
});

describe('toProjectActivities', () => {
  it('shapes a project’s reduced list and carries is_default from the enumeration', () => {
    const enumeration = [DESIGN, { ...DEVELOPMENT, isDefault: true }, QA];

    expect(toProjectActivities([{ id: 9, name: 'Development' }], enumeration)).toEqual([
      { id: 9, name: 'Development', isDefault: true },
    ]);
  });

  it('carries is_default to a project’s own copy of an activity, matched by name', () => {
    const enumeration = [{ ...DEVELOPMENT, isDefault: true }];

    expect(toProjectActivities([{ id: 57, name: 'Development' }], enumeration)).toEqual([
      { id: 57, name: 'Development', isDefault: true },
    ]);
  });

  it('tells a project that did not say apart from one that allows none', () => {
    expect(toProjectActivities(undefined as never, [DESIGN])).toBeNull();
    expect(toProjectActivities([], [DESIGN])).toEqual([]);
  });
});

describe('activityForTracker', () => {
  it('maps the instance trackers case-insensitively', () => {
    for (const tracker of ['Bug', 'feature', 'SUPPORT']) {
      expect(activityForTracker([DESIGN, DEVELOPMENT], tracker)).toEqual(DEVELOPMENT);
    }
  });

  it('returns null for a tracker with no mapping', () => {
    expect(activityForTracker([DESIGN, DEVELOPMENT], 'Epic')).toBeNull();
  });

  it('returns null when the mapped activity is absent from this instance', () => {
    // An admin renamed or removed Development; the map must not invent one.
    expect(activityForTracker([DESIGN], 'Bug')).toBeNull();
  });

  it('tolerates a missing tracker and an empty enumeration', () => {
    expect(activityForTracker([DESIGN, DEVELOPMENT], null as never)).toBeNull();
    expect(activityForTracker([DESIGN, DEVELOPMENT], '')).toBeNull();
    expect(activityForTracker([], 'Bug')).toBeNull();
  });
});
