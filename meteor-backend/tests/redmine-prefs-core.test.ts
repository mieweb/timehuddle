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
  partitionIssuePrefs,
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

  it('copes with no rows at all', () => {
    expect(read([])).toEqual({ pinnedIds: [], dismissedIds: [], reviveIds: [] });
    expect(partitionIssuePrefs(null as never)).toEqual({ pinnedIds: [], dismissedIds: [], reviveIds: [] });
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
