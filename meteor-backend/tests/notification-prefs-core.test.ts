/**
 * Unit tests for the notification delivery rules
 * (server/notification-prefs-core.js), #784.
 */
import { describe, it, expect } from 'vitest';

import {
  DELIVER_EVERYWHERE,
  DELIVER_NOWHERE,
  EVENTS,
  needsClockState,
  orgSettingForType,
  teamLevel,
  allEventSettings,
  prefKeyForType,
  prefsPatchToSet,
  resolveDelivery,
  unreadReminderDelayMs,
  wantsUnreadReminders,
} from '../server/notification-prefs-core';

const prefs = (events: Record<string, { desktop?: boolean; phone?: boolean }>) => ({ events });

describe('prefKeyForType', () => {
  it('maps every listed type to its event', () => {
    for (const [key, event] of Object.entries(EVENTS)) {
      for (const type of event.types) expect(prefKeyForType(type)).toBe(key);
    }
  });

  it('returns null for a type that is not configurable', () => {
    expect(prefKeyForType('test')).toBeNull();
    expect(prefKeyForType('team-invite')).toBeNull();
    expect(prefKeyForType(undefined)).toBeNull();
  });
});

describe('resolveDelivery', () => {
  it('delivers everywhere when the user has no preferences, for every event that existed before #784', () => {
    const existing = Object.values(EVENTS).filter((event) => event.desktop && event.phone);
    for (const event of existing) {
      for (const type of event.types) {
        expect(resolveDelivery(null, { type })).toEqual(DELIVER_EVERYWHERE);
      }
    }
  });

  it('ignores preferences for a type that is not configurable', () => {
    const p = prefs({ huddleMention: { desktop: false, phone: false } });
    expect(resolveDelivery(p, { type: 'test' })).toEqual(DELIVER_EVERYWHERE);
  });

  it('drops the inbox row and the push when both devices are off', () => {
    const p = prefs({ ticketLink: { desktop: false, phone: false } });
    expect(resolveDelivery(p, { type: 'ticket-link-changed' })).toEqual(DELIVER_NOWHERE);
  });

  it('logs and pushes to desktop only', () => {
    const p = prefs({ ticketLink: { phone: false } });
    expect(resolveDelivery(p, { type: 'ticket-link-changed' })).toEqual({
      inbox: true,
      desktop: true,
      phone: false,
    });
  });

  it('logs and pushes to phone only', () => {
    const p = prefs({ ticketLink: { desktop: false } });
    expect(resolveDelivery(p, { type: 'ticket-link-changed' })).toEqual({
      inbox: true,
      desktop: false,
      phone: true,
    });
  });

  it('applies one event setting to every type it covers', () => {
    const p = prefs({ huddleMention: { phone: false } });
    expect(resolveDelivery(p, { type: 'huddle-mention' }).phone).toBe(false);
    expect(resolveDelivery(p, { type: 'huddle-comment-mention' }).phone).toBe(false);
    expect(resolveDelivery(p, { type: 'huddle-comment' }).phone).toBe(true);
  });
});

describe('team levels', () => {
  const TEAM = 'aaaaaaaaaaaaaaaaaaaaaaaa';
  const OTHER = 'bbbbbbbbbbbbbbbbbbbbbbbb';
  const withLevel = (level: string) => ({ teams: { [TEAM]: level } });

  it('defaults to mentions', () => {
    expect(teamLevel(null, TEAM)).toBe('mentions');
    expect(resolveDelivery(null, { type: 'huddle-post', teamId: TEAM })).toEqual(DELIVER_NOWHERE);
    expect(resolveDelivery(null, { type: 'huddle-mention', teamId: TEAM }).inbox).toBe(true);
  });

  it('lets new posts through on all, desktop only by default', () => {
    expect(resolveDelivery(withLevel('all'), { type: 'huddle-post', teamId: TEAM })).toEqual({
      inbox: true,
      desktop: true,
      phone: false,
    });
  });

  it('drops every Huddle event on mute, mentions included', () => {
    for (const type of [
      'huddle-mention',
      'huddle-comment-mention',
      'huddle-comment',
      'huddle-post',
      'huddle-group-mention',
    ]) {
      expect(resolveDelivery(withLevel('mute'), { type, teamId: TEAM })).toEqual(DELIVER_NOWHERE);
    }
  });

  it('only applies to the team it is set on', () => {
    expect(
      resolveDelivery(withLevel('mute'), { type: 'huddle-mention', teamId: OTHER }).inbox,
    ).toBe(true);
  });

  it('never touches events outside Huddle', () => {
    expect(
      resolveDelivery(withLevel('mute'), { type: 'ticket-assigned', teamId: TEAM }).inbox,
    ).toBe(true);
  });
});

describe('group mentions', () => {
  const TEAM = 'aaaaaaaaaaaaaaaaaaaaaaaa';

  it('reach a member on the default level, desktop only by default', () => {
    expect(resolveDelivery(null, { type: 'huddle-group-mention', teamId: TEAM })).toEqual({
      inbox: true,
      desktop: true,
      phone: false,
    });
  });

  it('are held while clocked out, unlike a direct mention', () => {
    const p = { quiet: { holdOffShift: true } };
    const ctx = { teamId: TEAM, clockedIn: false };
    expect(resolveDelivery(p, { type: 'huddle-group-mention', ...ctx }).desktop).toBe(false);
    expect(resolveDelivery(p, { type: 'huddle-mention', ...ctx }).desktop).toBe(true);
  });
});

describe('quiet time', () => {
  const NOW = new Date('2026-10-29T15:00:00Z');
  const quiet = (q: Record<string, unknown>) => ({ quiet: q });
  const HELD = { inbox: true, desktop: false, phone: false };

  it('holds every push during a snooze, but still logs', () => {
    const p = quiet({ snoozeUntil: new Date('2026-10-29T16:00:00Z') });
    expect(resolveDelivery(p, { type: 'ticket-assigned', now: NOW })).toEqual(HELD);
    expect(resolveDelivery(p, { type: 'huddle-mention', now: NOW })).toEqual(HELD);
  });

  it('lets pushes through once the snooze has ended', () => {
    const p = quiet({ snoozeUntil: new Date('2026-10-29T14:00:00Z') });
    expect(resolveDelivery(p, { type: 'ticket-assigned', now: NOW })).toEqual(DELIVER_EVERYWHERE);
  });

  it('holds every push until the next clock-in, even when picked mid-shift', () => {
    const p = quiet({ snoozeUntilClockIn: true });
    expect(resolveDelivery(p, { type: 'ticket-assigned', now: NOW, clockedIn: false })).toEqual(
      HELD,
    );
    expect(resolveDelivery(p, { type: 'ticket-assigned', now: NOW, clockedIn: true })).toEqual(
      HELD,
    );
  });

  it('holds Huddle pushes while clocked out, except mentions', () => {
    const p = { ...quiet({ holdOffShift: true }), teams: { t1aaaaaa: 'all' } };
    const off = { now: NOW, clockedIn: false, teamId: 't1aaaaaa' };
    expect(resolveDelivery(p, { type: 'huddle-post', ...off })).toEqual(HELD);
    expect(resolveDelivery(p, { type: 'huddle-comment', ...off })).toEqual(HELD);
    expect(resolveDelivery(p, { type: 'huddle-mention', ...off })).toEqual(DELIVER_EVERYWHERE);
    expect(resolveDelivery(p, { type: 'ticket-assigned', ...off })).toEqual(DELIVER_EVERYWHERE);
    expect(resolveDelivery(p, { type: 'huddle-comment', ...off, clockedIn: true })).toEqual(
      DELIVER_EVERYWHERE,
    );
  });

  it('is off until the person turns it on', () => {
    const viewing = { teamId: 't1aaaaaa', viewingTeam: true, now: NOW };
    expect(resolveDelivery(null, { type: 'huddle-mention', ...viewing })).toEqual(
      DELIVER_EVERYWHERE,
    );
  });

  it('skips Huddle pushes for a team whose Huddle is open, but still logs', () => {
    const p = quiet({ skipWhileViewing: true });
    const viewing = { teamId: 't1aaaaaa', viewingTeam: true, now: NOW };
    expect(resolveDelivery(p, { type: 'huddle-mention', ...viewing })).toEqual(HELD);
    expect(resolveDelivery(p, { type: 'ticket-assigned', ...viewing })).toEqual(
      DELIVER_EVERYWHERE,
    );
  });

  it('pushes while viewing when the user turned skipping off', () => {
    const p = quiet({ skipWhileViewing: false });
    const viewing = { teamId: 't1aaaaaa', viewingTeam: true, now: NOW };
    expect(resolveDelivery(p, { type: 'huddle-mention', ...viewing })).toEqual(DELIVER_EVERYWHERE);
  });

  it('only needs the clock when a clock-based setting is on', () => {
    expect(needsClockState(null)).toBe(false);
    expect(needsClockState(quiet({ snoozeUntil: NOW }))).toBe(false);
    expect(needsClockState(quiet({ holdOffShift: true }))).toBe(true);
    // Clocking in clears this flag itself, so delivery never needs the clock for it.
    expect(needsClockState(quiet({ snoozeUntilClockIn: true }))).toBe(false);
  });
});

describe('org settings', () => {
  const userOff = prefs({ teamClock: { desktop: false, phone: false } });

  it('maps the clock events to their team settings', () => {
    expect(orgSettingForType('clock-in')).toBe('notifyAdminsOnClock');
    expect(orgSettingForType('clock-session-changed')).toBe('notifyAdminsOnClock');
    expect(orgSettingForType('shift-end-reminder')).toBe('shiftEndReminders');
    expect(orgSettingForType('ticket-assigned')).toBeNull();
    expect(orgSettingForType('test')).toBeNull();
  });

  it('drops the event for everyone when the org turns it off', () => {
    const orgPolicy = { value: false, locked: false };
    expect(resolveDelivery(null, { type: 'clock-in', orgPolicy })).toEqual(DELIVER_NOWHERE);
  });

  it("follows the person's own choice when the org leaves it on and unlocked", () => {
    const orgPolicy = { value: true, locked: false };
    expect(resolveDelivery(userOff, { type: 'clock-in', orgPolicy })).toEqual(DELIVER_NOWHERE);
  });

  it("ignores the person's choice when the org locks it on", () => {
    const orgPolicy = { value: true, locked: true };
    expect(resolveDelivery(userOff, { type: 'clock-out', orgPolicy })).toEqual(DELIVER_EVERYWHERE);
  });
});

describe('actionable events', () => {
  it('keeps the shift-end reminder in the inbox with both pop-ups off', () => {
    const p = prefs({ shiftEnd: { desktop: false, phone: false } });
    expect(resolveDelivery(p, { type: 'shift-end-reminder' })).toEqual({
      inbox: true,
      desktop: false,
      phone: false,
    });
  });

  it('still drops it when the organization turns reminders off', () => {
    expect(
      resolveDelivery(null, {
        type: 'shift-end-reminder',
        orgPolicy: { value: false, locked: false },
      }),
    ).toEqual(DELIVER_NOWHERE);
  });
});

describe('unread reminders', () => {
  const HOUR = 3_600_000;
  const on = prefs({ unreadReminder: { desktop: true, phone: false } });

  it('are off until the person turns them on', () => {
    expect(wantsUnreadReminders(null)).toBe(false);
    expect(resolveDelivery(null, { type: 'unread-reminder' })).toEqual(DELIVER_NOWHERE);
    expect(wantsUnreadReminders(on)).toBe(true);
  });

  it('pop up but are never logged under the bell', () => {
    expect(resolveDelivery(on, { type: 'unread-reminder' })).toEqual({
      inbox: false,
      desktop: true,
      phone: false,
    });
  });

  it('are held, and not logged, during a snooze', () => {
    const snoozed = { ...on, quiet: { snoozeUntil: new Date('2026-10-29T16:00:00Z') } };
    expect(
      resolveDelivery(snoozed, { type: 'unread-reminder', now: new Date('2026-10-29T15:00:00Z') }),
    ).toEqual(DELIVER_NOWHERE);
  });

  it('wait 2, 4, 8, 16 and 32 hours, then stop', () => {
    expect([0, 1, 2, 3, 4].map(unreadReminderDelayMs)).toEqual(
      [2, 4, 8, 16, 32].map((h) => h * HOUR),
    );
    expect(unreadReminderDelayMs(5)).toBeNull();
  });
});

describe('allEventSettings', () => {
  it('fills every event the user has not saved with its default', () => {
    const all = allEventSettings(prefs({ shiftEnd: { phone: false } }));
    expect(Object.keys(all)).toEqual(Object.keys(EVENTS));
    expect(all.shiftEnd).toEqual({ desktop: true, phone: false });
    expect(all.huddleMention).toEqual({ desktop: true, phone: true });
  });
});

describe('prefsPatchToSet', () => {
  it('flattens a valid patch into dotted paths', () => {
    expect(prefsPatchToSet({ events: { shiftEnd: { phone: false, desktop: true } } })).toEqual({
      'events.shiftEnd.phone': false,
      'events.shiftEnd.desktop': true,
    });
  });

  it('flattens team levels', () => {
    expect(prefsPatchToSet({ teams: { aaaaaaaaaaaaaaaaaaaaaaaa: 'all' } })).toEqual({
      'teams.aaaaaaaaaaaaaaaaaaaaaaaa': 'all',
    });
  });

  it('stores quiet time, with the snooze end as a Date', () => {
    expect(
      prefsPatchToSet({ quiet: { holdOffShift: true, snoozeUntil: '2026-10-29T16:00:00.000Z' } }),
    ).toEqual({
      'quiet.holdOffShift': true,
      'quiet.snoozeUntil': new Date('2026-10-29T16:00:00.000Z'),
    });
    expect(prefsPatchToSet({ quiet: { snoozeUntil: null } })).toEqual({
      'quiet.snoozeUntil': null,
    });
  });

  it.each([
    [{ quiet: { holdOffShift: 'yes' } }, /must be a boolean/],
    [{ quiet: { snoozeUntil: 'soon' } }, /must be a date/],
    [{ quiet: { loud: true } }, /Unknown quiet setting/],
    [{ teams: { 'a.b': 'all' } }, /Invalid team/],
    [{ teams: { aaaaaaaaaaaaaaaaaaaaaaaa: 'loud' } }, /Unknown team level/],
    [{ events: { nope: { phone: true } } }, /Unknown event/],
    [{ events: { shiftEnd: { tablet: true } } }, /Unknown device/],
    [{ events: { shiftEnd: { phone: 'yes' } } }, /must be a boolean/],
    [{}, /Nothing to update/],
  ])('rejects %j', (patch, message) => {
    expect(() => prefsPatchToSet(patch)).toThrow(message);
  });
});
