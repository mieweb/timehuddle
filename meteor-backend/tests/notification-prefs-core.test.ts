/**
 * Unit tests for the notification delivery rules
 * (server/notification-prefs-core.js), #784.
 */
import { describe, it, expect } from 'vitest';

import {
  DELIVER_EVERYWHERE,
  DELIVER_NOWHERE,
  EVENTS,
  allEventSettings,
  prefKeyForType,
  prefsPatchToSet,
  resolveDelivery,
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
  it('delivers everywhere when the user has no preferences', () => {
    for (const event of Object.values(EVENTS)) {
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

  it.each([
    [{ events: { nope: { phone: true } } }, /Unknown event/],
    [{ events: { shiftEnd: { tablet: true } } }, /Unknown device/],
    [{ events: { shiftEnd: { phone: 'yes' } } }, /must be a boolean/],
    [{}, /Nothing to update/],
  ])('rejects %j', (patch, message) => {
    expect(() => prefsPatchToSet(patch)).toThrow(message);
  });
});
