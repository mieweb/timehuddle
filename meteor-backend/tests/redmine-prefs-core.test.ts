/**
 * Unit tests for the pin and dismissal rules (server/redmine-prefs-core.js).
 *
 * These are the six rules agreed for dismissals, one test each, plus the cap.
 * They are worth pinning because every one of them is a promise to the user about
 * something disappearing or coming back, and because the alternative — a Mongo
 * selector per rule — could only be checked by reading it.
 */
import { describe, it, expect } from 'vitest';

import {
  DISMISSAL_TTL_DAYS,
  MAX_DISMISSALS_PER_USER,
  MAX_PINS_PER_USER,
  partitionIssuePrefs,
  pinWouldExceedCap,
  surplusDismissalIds,
} from '../server/redmine-prefs-core';

const NOW = Date.parse('2026-09-25T12:00:00Z');
const daysAgo = (days: number) => new Date(NOW - days * 86_400_000);

const dismissal = (issueId: number, days: number, assignedToMeAtDismissal = true) => ({
  issueId,
  state: 'dismissed',
  updatedAt: daysAgo(days),
  assignedToMeAtDismissal,
});

const pin = (issueId: number, days = 0) => ({ issueId, state: 'pinned', updatedAt: daysAgo(days) });

const read = (rows: unknown[], assignedIssueIds: number[] = []) =>
  partitionIssuePrefs(rows as never, { assignedIssueIds, now: NOW });

describe('partitionIssuePrefs', () => {
  it('separates pins from dismissals', () => {
    const { pinnedIds, dismissedIds } = read([pin(1), dismissal(2, 1), pin(3)]);
    expect(pinnedIds).toEqual([1, 3]);
    expect(dismissedIds).toEqual([2]);
  });

  it(`keeps a dismissal until it is ${DISMISSAL_TTL_DAYS} days old, then drops it (rule 3)`, () => {
    expect(read([dismissal(1, DISMISSAL_TTL_DAYS - 1)]).dismissedIds).toEqual([1]);
    expect(read([dismissal(1, DISMISSAL_TTL_DAYS)]).dismissedIds).toEqual([]);
    expect(read([dismissal(1, DISMISSAL_TTL_DAYS + 30)]).dismissedIds).toEqual([]);
  });

  it('restarts the clock when the same issue is dismissed again (rule 4)', () => {
    // The store rewrites `updatedAt` on every set, so a re-dismissal is simply a
    // fresh row — and the freshly dated one counts where the stale one did not.
    expect(read([dismissal(1, DISMISSAL_TTL_DAYS + 5)]).dismissedIds).toEqual([]);
    expect(read([dismissal(1, 0)]).dismissedIds).toEqual([1]);
  });

  it('never expires a pin, however old (rule 3 is for dismissals only)', () => {
    expect(read([pin(1, 400)]).pinnedIds).toEqual([1]);
  });

  it('revives a dismissal once the issue is assigned to the user (rule 5)', () => {
    const { dismissedIds, reviveIds } = read([dismissal(7, 2, false)], [7]);
    expect(reviveIds).toEqual([7]);
    expect(dismissedIds).toEqual([]);
  });

  it('leaves a deliberate dismissal of the user\'s own issue alone (rules 1 and 5)', () => {
    const { dismissedIds, reviveIds } = read([dismissal(7, 2, true)], [7]);
    expect(reviveIds).toEqual([]);
    expect(dismissedIds).toEqual([7]);
  });

  it('does not revive a dismissal for an issue assigned to somebody else', () => {
    expect(read([dismissal(7, 2, false)], [8]).reviveIds).toEqual([]);
  });

  it('orders dismissals newest first, which is the Restore list order', () => {
    expect(read([dismissal(1, 9), dismissal(2, 1), dismissal(3, 5)]).dismissedIds).toEqual([2, 3, 1]);
  });

  it('shows the issue again when a dismissal cannot be dated', () => {
    expect(read([{ issueId: 1, state: 'dismissed', updatedAt: 'nonsense' }]).dismissedIds).toEqual([]);
  });

  it('ignores rows with an unusable id or an unknown state', () => {
    const { pinnedIds, dismissedIds } = read([
      { issueId: 0, state: 'pinned', updatedAt: daysAgo(0) },
      { issueId: -2, state: 'dismissed', updatedAt: daysAgo(0) },
      { issueId: 5, state: 'snoozed', updatedAt: daysAgo(0) },
    ]);
    expect(pinnedIds).toEqual([]);
    expect(dismissedIds).toEqual([]);
  });

  describe('a hidden pin (rule 7)', () => {
    const hiddenPin = (issueId: number, hiddenDaysAgo: number, assignedToMeAtDismissal = true) => ({
      ...pin(issueId, 30),
      dismissedAt: daysAgo(hiddenDaysAgo),
      assignedToMeAtDismissal,
    });

    it('stays pinned while it is hidden', () => {
      const { pinnedIds, dismissedIds } = read([hiddenPin(4, 1)]);
      expect(pinnedIds).toEqual([4]);
      expect(dismissedIds).toEqual([4]);
    });

    it('dates the hide from dismissedAt, not from the pin', () => {
      // The pin is 30 days old; the hide is 1 day old and must still count.
      expect(read([hiddenPin(4, 1)]).dismissedIds).toEqual([4]);
      expect(read([hiddenPin(4, DISMISSAL_TTL_DAYS)]).dismissedIds).toEqual([]);
    });

    it('keeps the pin when the hide expires', () => {
      expect(read([hiddenPin(4, DISMISSAL_TTL_DAYS + 5)]).pinnedIds).toEqual([4]);
    });

    it('revives on reassignment and keeps the pin (rule 5)', () => {
      const { pinnedIds, dismissedIds, reviveIds } = read([hiddenPin(4, 1, false)], [4]);
      expect(reviveIds).toEqual([4]);
      expect(dismissedIds).toEqual([]);
      expect(pinnedIds).toEqual([4]);
    });

    it('sorts among plain dismissals by when it was hidden', () => {
      expect(read([dismissal(1, 5), hiddenPin(2, 1), dismissal(3, 9)]).dismissedIds).toEqual([2, 1, 3]);
    });
  });

  describe('a removal from the Tickets table (rules 8–11)', () => {
    const removal = (issueId: number, over: Record<string, unknown> = {}) => ({
      issueId,
      state: 'removed',
      updatedAt: daysAgo(40),
      ...over,
    });
    /** A read after Redmine has said what is assigned to the user. */
    const readKnowing = (rows: unknown[], assignedIssueIds: number[]) =>
      partitionIssuePrefs(rows as never, { assignedIssueIds, assignedKnown: true, now: NOW });

    it('holds, however old, while the issue stays assigned (rule 8)', () => {
      const { removedIds, forgetRemovalIds, pinnedIds } = readKnowing([removal(6)], [6]);
      expect(removedIds).toEqual([6]);
      expect(forgetRemovalIds).toEqual([]);
      expect(pinnedIds).toEqual([]);
    });

    it('is forgotten once the issue is no longer assigned (rule 10)', () => {
      const { removedIds, forgetRemovalIds } = readKnowing([removal(6)], [7]);
      expect(removedIds).toEqual([]);
      expect(forgetRemovalIds).toEqual([6]);
    });

    it('is never forgotten when what is assigned is not known', () => {
      // The first read of a build, and any build whose "assigned" signal failed.
      const { removedIds, forgetRemovalIds } = read([removal(6)]);
      expect(removedIds).toEqual([6]);
      expect(forgetRemovalIds).toEqual([]);
    });

    it('keeps a hide it carries, dated from dismissedAt (rule 11)', () => {
      const hidden = removal(6, { dismissedAt: daysAgo(1), assignedToMeAtDismissal: true });
      expect(readKnowing([hidden], [6]).dismissedIds).toEqual([6]);
      const expired = removal(6, { dismissedAt: daysAgo(DISMISSAL_TTL_DAYS + 1) });
      expect(readKnowing([expired], [6]).dismissedIds).toEqual([]);
    });
  });

  it('copes with no rows at all', () => {
    const empty = { pinnedIds: [], dismissedIds: [], reviveIds: [], removedIds: [], forgetRemovalIds: [] };
    expect(read([])).toEqual(empty);
    expect(partitionIssuePrefs(null as never)).toEqual(empty);
  });
});

describe('surplusDismissalIds', () => {
  it('reports nothing while the user is within the cap', () => {
    const rows = Array.from({ length: MAX_DISMISSALS_PER_USER }, (_, i) => dismissal(i + 1, i));
    expect(surplusDismissalIds(rows)).toEqual([]);
  });

  it('drops the oldest dismissals once the cap is passed', () => {
    const rows = Array.from({ length: MAX_DISMISSALS_PER_USER + 3 }, (_, i) => dismissal(i + 1, i));
    // Newest first, so the three oldest are the three highest days-ago values.
    expect(surplusDismissalIds(rows)).toEqual([
      MAX_DISMISSALS_PER_USER + 1,
      MAX_DISMISSALS_PER_USER + 2,
      MAX_DISMISSALS_PER_USER + 3,
    ]);
  });

  it('never counts a pin towards the dismissal cap', () => {
    const rows = [
      ...Array.from({ length: MAX_DISMISSALS_PER_USER }, (_, i) => dismissal(i + 1, i)),
      pin(9001),
    ];
    expect(surplusDismissalIds(rows)).toEqual([]);
  });
});

describe('pinWouldExceedCap', () => {
  const pins = (count: number) => Array.from({ length: count }, (_, i) => pin(i + 1, i));

  it('allows a new pin while the user is under the cap', () => {
    expect(pinWouldExceedCap(pins(MAX_PINS_PER_USER - 1), 9001)).toBe(false);
  });

  it('refuses a new pin at the cap, rather than evicting the oldest', () => {
    // The asymmetry with dismissals is the point: a pin keeps an issue in the
    // Tickets table, so dropping one silently would take a row away.
    expect(pinWouldExceedCap(pins(MAX_PINS_PER_USER), 9001)).toBe(true);
  });

  it('still allows re-pinning something already pinned at the cap', () => {
    // Starting a timer pins, so a user at their limit must still be able to
    // time the issues they have already pinned.
    expect(pinWouldExceedCap(pins(MAX_PINS_PER_USER), 1)).toBe(false);
  });

  it('counts a pin row whatever else is on it', () => {
    // Guards the cap against a pin that also carries other fields, so it keeps
    // counting correctly as the row shape grows.
    const rows = [
      ...pins(MAX_PINS_PER_USER - 1),
      { ...pin(9999, 0), dismissedAt: daysAgo(1), assignedToMeAtDismissal: true },
    ];
    expect(pinWouldExceedCap(rows, 9001)).toBe(true);
  });

  it('does not count dismissals towards the pin cap', () => {
    const rows = [...pins(2), ...Array.from({ length: 600 }, (_, i) => dismissal(i + 1000, i))];
    expect(pinWouldExceedCap(rows, 9001)).toBe(false);
  });

  it('copes with no rows at all', () => {
    expect(pinWouldExceedCap([], 1)).toBe(false);
    expect(pinWouldExceedCap(null as never, 1)).toBe(false);
  });
});
