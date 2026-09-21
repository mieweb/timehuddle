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
  toActivityList,
  pickDefaultActivity,
  activityForTracker,
} from '../server/redmine-activities';

const DESIGN = { id: 8, name: 'Design', isDefault: false };
const DEVELOPMENT = { id: 9, name: 'Development', isDefault: false };

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

  it('drops entries with no id and tolerates a non-array', () => {
    expect(toActivityList([{ name: 'Nameless' }, null])).toEqual([]);
    expect(toActivityList(undefined as never)).toEqual([]);
  });
});

describe('pickDefaultActivity', () => {
  it('honours the user’s explicit choice', () => {
    expect(pickDefaultActivity([DESIGN, DEVELOPMENT], 8)).toEqual({
      activity: DESIGN,
      reason: 'chosen',
    });
  });

  it('falls back when the chosen activity no longer exists on the instance', () => {
    // An admin removed id 99 since the user picked it.
    expect(pickDefaultActivity([DESIGN, DEVELOPMENT], 99).reason).toBe('named');
  });

  it("prefers the instance's own default over the Development convention", () => {
    const flagged = { id: 8, name: 'Design', isDefault: true };

    expect(pickDefaultActivity([flagged, DEVELOPMENT], null)).toEqual({
      activity: flagged,
      reason: 'is_default',
    });
  });

  it('falls back to one named Development, case-insensitively', () => {
    expect(pickDefaultActivity([DESIGN, { ...DEVELOPMENT, name: 'development' }], null).reason).toBe(
      'named',
    );
  });

  it('falls back to the first activity when nothing else matches', () => {
    expect(pickDefaultActivity([DESIGN, { id: 10, name: 'Support', isDefault: false }], null)).toEqual(
      { activity: DESIGN, reason: 'first' },
    );
  });

  it('reports none for an instance with no activities configured', () => {
    expect(pickDefaultActivity([], null)).toEqual({ activity: null, reason: 'none' });
    expect(pickDefaultActivity(undefined as never, 9)).toEqual({ activity: null, reason: 'none' });
  });

  it('derives from the tracker when the user has chosen nothing (D4)', () => {
    expect(pickDefaultActivity([DESIGN, DEVELOPMENT], null, 'Bug')).toEqual({
      activity: DEVELOPMENT,
      reason: 'tracker',
    });
  });

  it("lets an explicit choice outrank the tracker's inference", () => {
    // A designer who picked Design keeps it even on a Bug, which the degenerate
    // tracker map would otherwise force to Development on every issue.
    expect(pickDefaultActivity([DESIGN, DEVELOPMENT], 8, 'Bug')).toEqual({
      activity: DESIGN,
      reason: 'chosen',
    });
  });

  it('ignores an unknown tracker and carries on down the chain', () => {
    expect(pickDefaultActivity([DESIGN, DEVELOPMENT], null, 'Epic').reason).toBe('named');
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
