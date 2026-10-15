/**
 * Unit tests for huddle-schedule-core (server/huddle-schedule-core.js), #596.
 */
import { describe, it, expect } from 'vitest';

import {
  MAX_SCHEDULE_AHEAD_MS,
  isAwaitingDelivery,
  isHiddenFrom,
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
