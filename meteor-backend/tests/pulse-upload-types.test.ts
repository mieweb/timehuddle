/**
 * Unit tests for pulse-upload-types (server/pulse-upload-types.js): the kinds
 * of video Pulse in the app sends, their flags, and the keys they group by.
 */
import { describe, it, expect } from 'vitest';

import {
  destinationRequestOf,
  isClockType,
  isTargetKey,
  normalizeTarget,
  PULSE_MAX_UPLOAD_BYTES,
  PULSE_UPLOAD_TYPE_IDS,
  PULSE_UPLOAD_TYPES,
  pulseUploadType,
  pulseUploadTypeInfo,
  targetKeyOf,
} from '../server/pulse-upload-types';

const TICKET = '64B1F0C2A9E8D7C6B5A49382';
const SESSION = '65AA00B1C2D3E4F5A6B7C8D9';
const TEAM = 'Tm7xKq2ZpR4sW9aBc'; // a Meteor id: its case matters to the database
const LEGACY_TEAM = '5F0A1B2C3D4E5F6A7B8C9D0E';
const CONVERSATION = 'Cv3nRt8YwQ2pL5kMz';
const USER = 'Us9dF2gH4jK6lZ8xC';

/**
 * The keys of every type: the one table Huddle's place module builds too.
 * PR3-W2 copies these literal rows into src/features/pulse-embed/place.test.ts;
 * a change here is a change there.
 */
const KEY_VECTORS = [
  { type: 'ticket.video', target: { kind: 'ticket', id: TICKET }, key: 'ticket:64b1f0c2a9e8d7c6b5a49382' },
  { type: 'clock.session', target: { kind: 'clock', id: SESSION }, key: 'clock:65aa00b1c2d3e4f5a6b7c8d9' },
  { type: 'clock.wrapup', target: { kind: 'clock', id: SESSION }, key: 'clock:65aa00b1c2d3e4f5a6b7c8d9' },
  {
    type: 'clock.plan',
    target: { kind: 'clock-plan', teamId: TEAM, postDate: '2026-11-18' },
    key: 'clock-plan:tm7xkq2zpr4sw9abc:2026-11-18',
  },
  {
    type: 'clock.plan',
    target: { kind: 'clock-plan', teamId: LEGACY_TEAM, postDate: '2026-11-19' },
    key: 'clock-plan:5f0a1b2c3d4e5f6a7b8c9d0e:2026-11-19',
  },
  { type: 'huddle.post', target: { kind: 'huddle', teamId: TEAM }, key: 'huddle:tm7xkq2zpr4sw9abc' },
  {
    type: 'huddle.post',
    target: { kind: 'huddle', teamId: TEAM, conversationId: CONVERSATION },
    key: 'huddle:tm7xkq2zpr4sw9abc',
  },
  { type: 'library.video', target: { kind: 'library' }, key: 'library:us9df2gh4jk6lz8xc' },
] as const;

describe('PULSE_UPLOAD_TYPES', () => {
  it('has the six embed types and no link-flow kinds', () => {
    expect([...PULSE_UPLOAD_TYPE_IDS].sort()).toEqual(
      ['clock.plan', 'clock.session', 'clock.wrapup', 'huddle.post', 'library.video', 'ticket.video'].sort(),
    );
    for (const kind of ['post', 'walkthrough', 'timesheet-request', 'clock-wrapup', 'clock-plan']) {
      expect(pulseUploadType(kind)).toBeNull();
    }
  });

  it('gives every type a key builder: a key for each of its vectors', () => {
    for (const id of PULSE_UPLOAD_TYPE_IDS) {
      const vectors = KEY_VECTORS.filter((v) => v.type === id);
      expect(vectors.length, id).toBeGreaterThan(0);
      for (const v of vectors) expect(targetKeyOf(id, v.target, USER), id).toBe(v.key);
    }
  });

  it('has the expected flags', () => {
    const flags = Object.fromEntries(
      PULSE_UPLOAD_TYPE_IDS.map((id) => {
        const t = PULSE_UPLOAD_TYPES[id as keyof typeof PULSE_UPLOAD_TYPES];
        return [
          id,
          [t.targetKind, t.destinationKind, t.title, t.sendLabel, t.clock, t.requireOnline, t.confirmSend, t.fallbackType],
        ];
      }),
    );
    expect(flags).toEqual({
      'ticket.video': ['ticket', 'ticket', 'Ticket', null, null, false, false, null],
      'clock.session': ['clock', 'clock', 'Clock session', null, null, false, false, null],
      'clock.wrapup': ['clock', 'session-post', 'Wrap-up', 'Clock out & send', 'stop', true, true, 'clock.session'],
      'clock.plan': ['clock-plan', 'session-post', 'Plan', 'Clock in & send', 'start', true, true, 'library.video'],
      'huddle.post': ['huddle', 'huddle', 'Post', null, null, false, false, null],
      'library.video': ['library', 'library', 'Library', null, null, false, false, null],
    });
  });

  it("caps every type at PulseVault's 500 MB, with no length limit or required name", () => {
    expect(PULSE_MAX_UPLOAD_BYTES).toBe(524_288_000);
    for (const id of PULSE_UPLOAD_TYPE_IDS) {
      const t = PULSE_UPLOAD_TYPES[id as keyof typeof PULSE_UPLOAD_TYPES];
      expect([t.maxBytes, t.limits, t.requireName, t.version], id).toEqual([PULSE_MAX_UPLOAD_BYTES, null, false, 1]);
    }
  });

  it('is frozen', () => {
    expect(Object.isFrozen(PULSE_UPLOAD_TYPES)).toBe(true);
    expect(Object.isFrozen(PULSE_UPLOAD_TYPES['clock.plan'])).toBe(true);
  });

  it('finds types by own key only', () => {
    expect(pulseUploadType('constructor')).toBeNull();
    expect(pulseUploadType(undefined)).toBeNull();
    expect(isClockType('clock.wrapup')).toBe(true);
    expect(isClockType('clock.plan')).toBe(true);
    expect(isClockType('clock.session')).toBe(false);
    expect(isClockType('nope')).toBe(false);
  });
});

describe('pulseUploadTypeInfo', () => {
  it("gives the client a type's spec without how it is delivered", () => {
    expect(pulseUploadTypeInfo('clock.wrapup')).toEqual({
      id: 'clock.wrapup',
      version: 1,
      targetKind: 'clock',
      title: 'Wrap-up',
      sendLabel: 'Clock out & send',
      prompt: null,
      limits: null,
      requireName: false,
      clock: 'stop',
      requireOnline: true,
      confirmSend: true,
      maxBytes: PULSE_MAX_UPLOAD_BYTES,
    });
    expect(pulseUploadTypeInfo('nope')).toBeNull();
  });
});

describe('targetKeyOf', () => {
  it('lowercases every id in the key, and the clock-plan key carries its day', () => {
    for (const v of KEY_VECTORS) {
      expect(v.key).toBe(v.key.toLowerCase());
      expect(isTargetKey(v.key), v.key).toBe(true);
    }
    expect(targetKeyOf('clock.plan', { kind: 'clock-plan', teamId: TEAM, postDate: '2026-11-19' }, USER)).not.toBe(
      targetKeyOf('clock.plan', { kind: 'clock-plan', teamId: TEAM, postDate: '2026-11-18' }, USER),
    );
  });

  it('refuses a target of another kind than the type takes', () => {
    expect(targetKeyOf('ticket.video', { kind: 'clock', id: SESSION }, USER)).toBeNull();
    expect(targetKeyOf('clock.wrapup', { kind: 'clock-plan', teamId: TEAM, postDate: '2026-11-18' }, USER)).toBeNull();
    expect(targetKeyOf('huddle.post', { kind: 'library' }, USER)).toBeNull();
    expect(targetKeyOf('nope', { kind: 'ticket', id: TICKET }, USER)).toBeNull();
  });

  it('refuses ids that could break a key, and a plan without its day', () => {
    expect(targetKeyOf('ticket.video', { kind: 'ticket', id: 'a:b' }, USER)).toBeNull();
    expect(targetKeyOf('ticket.video', { kind: 'ticket', id: '' }, USER)).toBeNull();
    expect(targetKeyOf('ticket.video', { kind: 'ticket', id: 42 }, USER)).toBeNull();
    expect(targetKeyOf('ticket.video', { kind: 'ticket', id: 'x'.repeat(65) }, USER)).toBeNull();
    expect(targetKeyOf('clock.plan', { kind: 'clock-plan', teamId: TEAM }, USER)).toBeNull();
    expect(targetKeyOf('clock.plan', { kind: 'clock-plan', teamId: TEAM, postDate: '18/11/2026' }, USER)).toBeNull();
    expect(targetKeyOf('huddle.post', { kind: 'huddle', teamId: TEAM, conversationId: 'a b' }, USER)).toBeNull();
    expect(targetKeyOf('library.video', { kind: 'library' }, undefined)).toBeNull();
    expect(targetKeyOf('ticket.video', null, USER)).toBeNull();
  });
});

describe('normalizeTarget', () => {
  it('lowercases ObjectId hex as the database writes it, and keeps a Meteor id as sent', () => {
    expect(normalizeTarget('ticket.video', { kind: 'ticket', id: TICKET })).toEqual({
      kind: 'ticket',
      id: TICKET.toLowerCase(),
    });
    expect(normalizeTarget('clock.plan', { kind: 'clock-plan', teamId: TEAM, postDate: '2026-11-18' })).toEqual({
      kind: 'clock-plan',
      teamId: TEAM,
      postDate: '2026-11-18',
    });
    expect(normalizeTarget('huddle.post', { kind: 'huddle', teamId: LEGACY_TEAM, conversationId: CONVERSATION })).toEqual({
      kind: 'huddle',
      teamId: LEGACY_TEAM.toLowerCase(),
      conversationId: CONVERSATION,
    });
  });

  it('keeps only the fields of its kind', () => {
    expect(normalizeTarget('library.video', { kind: 'library', userId: 'someone-else' })).toEqual({ kind: 'library' });
    expect(normalizeTarget('huddle.post', { kind: 'huddle', teamId: TEAM, conversationId: null, extra: 1 })).toEqual({
      kind: 'huddle',
      teamId: TEAM,
    });
  });
});

describe('isTargetKey', () => {
  it('takes only keys targetKeyOf builds', () => {
    for (const bad of [
      'TICKET:abc',
      'ticket:',
      'ticket:a:b',
      'post:abc',
      'clock-plan:team',
      'clock-plan:team:tomorrow',
      'library',
      `ticket:${'a'.repeat(125)}`,
      42,
      null,
    ]) {
      expect(isTargetKey(bad), String(bad)).toBe(false);
    }
  });
});

describe('destinationRequestOf', () => {
  it('names the pulse-destinations.js check a begin runs', () => {
    expect(destinationRequestOf('ticket.video', { kind: 'ticket', id: 'a'.repeat(24) })).toEqual({
      kind: 'ticket',
      id: 'a'.repeat(24),
    });
    expect(destinationRequestOf('clock.session', { kind: 'clock', id: 'b'.repeat(24) })).toEqual({
      kind: 'clock',
      id: 'b'.repeat(24),
    });
    expect(destinationRequestOf('huddle.post', { kind: 'huddle', teamId: TEAM, conversationId: CONVERSATION })).toEqual({
      kind: 'huddle',
      teamId: TEAM,
    });
    expect(destinationRequestOf('library.video', { kind: 'clock-plan', teamId: TEAM, postDate: '2026-11-18' })).toEqual({
      kind: 'library',
    });
  });

  it('has none for a clock type, whose post was made at Send', () => {
    expect(destinationRequestOf('clock.wrapup', { kind: 'clock', id: SESSION })).toBeNull();
    expect(destinationRequestOf('clock.plan', { kind: 'clock-plan', teamId: TEAM, postDate: '2026-11-18' })).toBeNull();
  });
});
