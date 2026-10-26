/**
 * Unit tests for huddle-schedule-core (server/huddle-schedule-core.js), #596.
 */
import { describe, it, expect } from 'vitest';

import {
  MAX_SCHEDULE_AHEAD_MS,
  isAwaitingDelivery,
  isHiddenFrom,
  isOutsideWindow,
  inWindowOrPending,
  parseSchedule,
  visibleTo,
} from '../server/huddle-schedule-core';

const NOW = Date.parse('2026-10-15T12:00:00.000Z');
const IN_AN_HOUR = '2026-10-15T13:00:00.000Z';

describe('parseSchedule', () => {
  it('is no schedule when nothing is given', () => {
    expect(parseSchedule({}, NOW)).toEqual({ schedule: null });
    expect(parseSchedule(undefined, NOW)).toEqual({ schedule: null });
    expect(parseSchedule({ deliverAt: null }, NOW)).toEqual({ schedule: null });
  });

  it('reads an ISO time', () => {
    expect(parseSchedule({ deliverAt: IN_AN_HOUR }, NOW)).toEqual({
      schedule: { deliverAt: new Date(IN_AN_HOUR) },
    });
  });

  it('rejects anything that is not a date string', () => {
    expect(parseSchedule({ deliverAt: 'tomorrow' }, NOW).error).toBeTruthy();
    expect(parseSchedule({ deliverAt: 12345 as unknown as string }, NOW).error).toBeTruthy();
  });

  it('rejects now and the past', () => {
    expect(parseSchedule({ deliverAt: new Date(NOW).toISOString() }, NOW).error).toBeTruthy();
    expect(parseSchedule({ deliverAt: '2026-10-14T12:00:00.000Z' }, NOW).error).toBeTruthy();
  });

  it('rejects more than a year ahead', () => {
    const tooFar = new Date(NOW + MAX_SCHEDULE_AHEAD_MS + 1).toISOString();
    expect(parseSchedule({ deliverAt: tooFar }, NOW).error).toBeTruthy();
    const atLimit = new Date(NOW + MAX_SCHEDULE_AHEAD_MS).toISOString();
    expect(parseSchedule({ deliverAt: atLimit }, NOW).schedule).toBeTruthy();
  });
});

describe('isAwaitingDelivery', () => {
  it('is true only for a scheduled, undelivered post', () => {
    expect(isAwaitingDelivery({})).toBe(false);
    expect(isAwaitingDelivery({ deliverAt: new Date() })).toBe(true);
    expect(isAwaitingDelivery({ deliverAt: new Date(), deliveredAt: new Date() })).toBe(false);
  });
});

describe('isHiddenFrom', () => {
  const scheduled = { userId: 'author', deliverAt: new Date() };

  it('hides an undelivered post from everyone but its author', () => {
    expect(isHiddenFrom(scheduled, 'other')).toBe(true);
    expect(isHiddenFrom(scheduled, 'author')).toBe(false);
  });

  it('shows it once delivered', () => {
    expect(isHiddenFrom({ ...scheduled, deliveredAt: new Date() }, 'other')).toBe(false);
  });

  it('never hides unscheduled posts', () => {
    expect(isHiddenFrom({ userId: 'author' }, 'other')).toBe(false);
  });
});

describe('visibleTo', () => {
  it('lets through unscheduled, delivered, and own posts', () => {
    expect(visibleTo('me')).toEqual({
      $or: [{ deliverAt: null }, { deliveredAt: { $ne: null } }, { userId: 'me' }],
    });
  });
});

describe('inWindowOrPending', () => {
  it('builds the three-way $or', () => {
    const sinceDate = new Date(NOW);
    expect(inWindowOrPending('me', sinceDate)).toEqual({
      $or: [
        { createdAt: { $gte: sinceDate } },
        { deliveredAt: { $gte: sinceDate } },
        { userId: 'me', deliverAt: { $ne: null }, deliveredAt: null },
      ],
    });
  });
});

describe('isOutsideWindow', () => {
  const sinceDate = new Date(NOW);
  const dayMs = 24 * 60 * 60 * 1000;

  it('is false for a post created within the window', () => {
    expect(isOutsideWindow({ createdAt: new Date(NOW), userId: 'other' }, sinceDate, 'me')).toBe(
      false,
    );
  });

  it('is true for a post created before the window, with no schedule', () => {
    const old = { createdAt: new Date(NOW - dayMs), userId: 'other' };
    expect(isOutsideWindow(old, sinceDate, 'me')).toBe(true);
  });

  it('is false for a scheduled post delivered within the window, even if written long before it', () => {
    const post = {
      createdAt: new Date(NOW - 60 * dayMs),
      deliverAt: new Date(NOW - dayMs),
      deliveredAt: new Date(NOW),
      userId: 'other',
    };
    expect(isOutsideWindow(post, sinceDate, 'me')).toBe(false);
  });

  it('is false for the viewer\'s own still-waiting post, however old', () => {
    const post = { createdAt: new Date(NOW - 60 * dayMs), deliverAt: new Date(NOW + dayMs), userId: 'me' };
    expect(isOutsideWindow(post, sinceDate, 'me')).toBe(false);
  });

  it('is true for someone else\'s still-waiting post written long ago', () => {
    const post = {
      createdAt: new Date(NOW - 60 * dayMs),
      deliverAt: new Date(NOW + dayMs),
      userId: 'other',
    };
    expect(isOutsideWindow(post, sinceDate, 'me')).toBe(true);
  });
});
