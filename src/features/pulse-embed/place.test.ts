import { describe, expect, it } from 'vitest';

import type { PulseUploadTypeInfo } from '../../lib/api';
import { contextKey } from './client';
import {
  normalizeTarget,
  placeData,
  PULSE_UPLOAD_TYPE_IDS,
  pulsePlace,
  type PulsePlaceInput,
  targetKeyOf,
} from './place';

const TICKET = '64B1F0C2A9E8D7C6B5A49382';
const SESSION = '65AA00B1C2D3E4F5A6B7C8D9';
const TEAM = 'Tm7xKq2ZpR4sW9aBc'; // a Meteor id: its case matters to the database
const LEGACY_TEAM = '5F0A1B2C3D4E5F6A7B8C9D0E';
const CONVERSATION = 'Cv3nRt8YwQ2pL5kMz';
const USER = 'Us9dF2gH4jK6lZ8xC';

/**
 * The keys of every type, copied as they are from the server's table
 * (meteor-backend/tests/pulse-upload-types.test.ts KEY_VECTORS): a change
 * there is a change here.
 */
const KEY_VECTORS = [
  {
    type: 'ticket.video',
    target: { kind: 'ticket', id: TICKET },
    key: 'ticket:64b1f0c2a9e8d7c6b5a49382',
  },
  {
    type: 'clock.session',
    target: { kind: 'clock', id: SESSION },
    key: 'clock:65aa00b1c2d3e4f5a6b7c8d9',
  },
  {
    type: 'clock.wrapup',
    target: { kind: 'clock', id: SESSION },
    key: 'clock:65aa00b1c2d3e4f5a6b7c8d9',
  },
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
  {
    type: 'huddle.post',
    target: { kind: 'huddle', teamId: TEAM },
    key: 'huddle:tm7xkq2zpr4sw9abc',
  },
  {
    type: 'huddle.post',
    target: { kind: 'huddle', teamId: TEAM, conversationId: CONVERSATION },
    key: 'huddle:tm7xkq2zpr4sw9abc',
  },
  { type: 'library.video', target: { kind: 'library' }, key: 'library:us9df2gh4jk6lz8xc' },
] as const;

/** A place on screen for each vector, as a page would describe it. */
const PLACES: Array<{ input: PulsePlaceInput; key: string; id: string }> = [
  {
    input: { type: 'ticket.video', ticketId: TICKET, label: 'Fix login' },
    key: 'ticket:64b1f0c2a9e8d7c6b5a49382',
    id: TICKET,
  },
  {
    input: { type: 'clock.session', clockEventId: SESSION, label: 'Mon 9:02 session' },
    key: 'clock:65aa00b1c2d3e4f5a6b7c8d9',
    id: SESSION,
  },
  {
    input: {
      type: 'clock.wrapup',
      clockEventId: SESSION,
      teamId: TEAM,
      postDate: '2026-11-18',
      label: 'Platform',
    },
    key: 'clock:65aa00b1c2d3e4f5a6b7c8d9',
    id: SESSION,
  },
  {
    input: { type: 'clock.plan', teamId: TEAM, postDate: '2026-11-18', label: 'Platform' },
    key: 'clock-plan:tm7xkq2zpr4sw9abc:2026-11-18',
    id: `${TEAM}:2026-11-18`,
  },
  {
    input: { type: 'clock.plan', teamId: LEGACY_TEAM, postDate: '2026-11-19', label: 'Ops' },
    key: 'clock-plan:5f0a1b2c3d4e5f6a7b8c9d0e:2026-11-19',
    id: `${LEGACY_TEAM}:2026-11-19`,
  },
  {
    input: { type: 'huddle.post', teamId: TEAM, label: 'Platform' },
    key: 'huddle:tm7xkq2zpr4sw9abc',
    id: TEAM,
  },
  {
    input: { type: 'huddle.post', teamId: TEAM, conversationId: CONVERSATION, label: 'Platform' },
    key: 'huddle:tm7xkq2zpr4sw9abc',
    id: TEAM,
  },
  {
    input: { type: 'library.video', userId: USER, label: 'My library' },
    key: 'library:us9df2gh4jk6lz8xc',
    id: USER,
  },
];

function typeInfo(id: PulseUploadTypeInfo['id'], over: Partial<PulseUploadTypeInfo> = {}) {
  const clock = id === 'clock.wrapup' ? 'stop' : id === 'clock.plan' ? 'start' : null;
  return {
    id,
    version: 1,
    targetKind: 'clock',
    title: 'Wrap-up',
    sendLabel: clock ? 'Clock out & send' : null,
    prompt: null,
    limits: null,
    requireName: false,
    clock,
    requireOnline: clock != null,
    confirmSend: clock != null,
    maxBytes: 524_288_000,
    ...over,
  } as PulseUploadTypeInfo;
}

describe('targetKeyOf', () => {
  it("builds the server's key for every vector", () => {
    for (const v of KEY_VECTORS) expect(targetKeyOf(v.type, v.target, USER), v.type).toBe(v.key);
  });

  it('has a vector for every type', () => {
    for (const id of PULSE_UPLOAD_TYPE_IDS) {
      expect(
        KEY_VECTORS.some((v) => v.type === id),
        id,
      ).toBe(true);
    }
  });

  it('scopes a plan by its day', () => {
    const plan = (postDate: string) =>
      targetKeyOf('clock.plan', { kind: 'clock-plan', teamId: TEAM, postDate }, USER);
    expect(plan('2026-11-18')).not.toBe(plan('2026-11-19'));
  });

  it('refuses a target of another kind, an id that could break a key, and a plan without its day', () => {
    expect(targetKeyOf('ticket.video', { kind: 'clock', id: SESSION }, USER)).toBeNull();
    expect(
      targetKeyOf('clock.wrapup', { kind: 'clock-plan', teamId: TEAM, postDate: '2026-11-18' }),
    ).toBeNull();
    expect(targetKeyOf('huddle.post', { kind: 'library' }, USER)).toBeNull();
    expect(targetKeyOf('nope', { kind: 'ticket', id: TICKET }, USER)).toBeNull();
    expect(targetKeyOf('ticket.video', { kind: 'ticket', id: 'a:b' }, USER)).toBeNull();
    expect(targetKeyOf('ticket.video', { kind: 'ticket', id: '' }, USER)).toBeNull();
    expect(targetKeyOf('ticket.video', { kind: 'ticket', id: 42 }, USER)).toBeNull();
    expect(targetKeyOf('ticket.video', { kind: 'ticket', id: 'x'.repeat(65) }, USER)).toBeNull();
    expect(targetKeyOf('clock.plan', { kind: 'clock-plan', teamId: TEAM }, USER)).toBeNull();
    expect(
      targetKeyOf('clock.plan', { kind: 'clock-plan', teamId: TEAM, postDate: '18/11/2026' }, USER),
    ).toBeNull();
    expect(
      targetKeyOf('huddle.post', { kind: 'huddle', teamId: TEAM, conversationId: 'a b' }, USER),
    ).toBeNull();
    expect(targetKeyOf('library.video', { kind: 'library' }, undefined)).toBeNull();
    expect(targetKeyOf('ticket.video', null, USER)).toBeNull();
  });
});

describe('normalizeTarget', () => {
  it('lowercases ObjectId hex and keeps a Meteor id as sent, with only its kind’s fields', () => {
    expect(normalizeTarget('ticket.video', { kind: 'ticket', id: TICKET })).toEqual({
      kind: 'ticket',
      id: TICKET.toLowerCase(),
    });
    expect(
      normalizeTarget('huddle.post', {
        kind: 'huddle',
        teamId: LEGACY_TEAM,
        conversationId: CONVERSATION,
      }),
    ).toEqual({ kind: 'huddle', teamId: LEGACY_TEAM.toLowerCase(), conversationId: CONVERSATION });
    expect(normalizeTarget('library.video', { kind: 'library', userId: 'someone-else' })).toEqual({
      kind: 'library',
    });
    expect(
      normalizeTarget('huddle.post', { kind: 'huddle', teamId: TEAM, conversationId: null, x: 1 }),
    ).toEqual({ kind: 'huddle', teamId: TEAM });
  });
});

describe('pulsePlace', () => {
  it('round-trips every kind: the key, what Pulse keys it by, and the target read back at Send', () => {
    for (const { input, key, id } of PLACES) {
      const place = pulsePlace(input);
      expect(place, input.type).not.toBeNull();
      const { context, type, target } = place!;
      expect(context.key, input.type).toBe(key);
      expect(context.kind, input.type).toBe(key.slice(0, key.indexOf(':')));
      expect(context.id, input.type).toBe(id);
      expect(contextKey(context.kind, context.id), input.type).toBe(key);
      expect(type).toBe(input.type);
      expect(targetKeyOf(type, target, USER), input.type).toBe(key);
      // What a Pulse draft hands back is JSON: data survives it unchanged.
      const stored = JSON.parse(JSON.stringify(context));
      expect(stored).toEqual(context);
      const data = placeData(stored);
      expect(data?.type, input.type).toBe(type);
      expect(data?.target, input.type).toEqual(target);
    }
  });

  it('sends a post to the conversation the composer was in, and none when it has none', () => {
    const inConversation = pulsePlace({
      type: 'huddle.post',
      teamId: TEAM,
      conversationId: CONVERSATION,
      label: 'Platform',
    });
    expect(inConversation?.target).toEqual({
      kind: 'huddle',
      teamId: TEAM,
      conversationId: CONVERSATION,
    });
    const teamOnly = pulsePlace({
      type: 'huddle.post',
      teamId: TEAM,
      conversationId: undefined,
      label: 'Platform',
    });
    expect(teamOnly?.target).toEqual({ kind: 'huddle', teamId: TEAM });
    expect(JSON.stringify(teamOnly?.context.data)).not.toContain('conversationId');
  });

  it("keeps a wrap-up's team and day for the clock-out call, and needs them", () => {
    const wrapUp = pulsePlace({
      type: 'clock.wrapup',
      clockEventId: SESSION,
      teamId: TEAM,
      postDate: '2026-11-18',
      label: 'Platform',
    });
    expect(placeData(wrapUp?.context)).toEqual({
      type: 'clock.wrapup',
      target: { kind: 'clock', id: SESSION.toLowerCase() },
      clock: { teamId: TEAM, postDate: '2026-11-18' },
    });
    expect(
      pulsePlace({
        type: 'clock.wrapup',
        clockEventId: SESSION,
        teamId: TEAM,
        postDate: 'today',
        label: 'Platform',
      }),
    ).toBeNull();
  });

  it('refuses a place that would make a bad key', () => {
    expect(pulsePlace({ type: 'ticket.video', ticketId: 'a:b', label: 'x' })).toBeNull();
    expect(
      pulsePlace({ type: 'clock.plan', teamId: TEAM, postDate: '2026-1-1', label: 'x' }),
    ).toBeNull();
    expect(pulsePlace({ type: 'library.video', userId: '', label: 'x' })).toBeNull();
  });

  it("carries the server's type spec as Pulse reads it, leaving nulls out", () => {
    const place = pulsePlace({
      type: 'clock.wrapup',
      clockEventId: SESSION,
      teamId: TEAM,
      postDate: '2026-11-18',
      label: 'Platform',
      uploadType: typeInfo('clock.wrapup'),
    });
    expect(place?.context.uploadType).toEqual({
      id: 'clock.wrapup',
      version: 1,
      title: 'Wrap-up',
      sendLabel: 'Clock out & send',
      requireName: false,
      requireOnline: true,
      confirmSend: true,
      maxBytes: 524_288_000,
    });
    // A spec for another type is never attached: Pulse matches drafts by key and type.
    const mismatched = pulsePlace({
      type: 'clock.session',
      clockEventId: SESSION,
      label: 'Mon 9:02 session',
      uploadType: typeInfo('clock.wrapup'),
    });
    expect(mismatched?.context.uploadType).toBeUndefined();
  });

  it('trims the label to what Pulse shows, and never leaves it empty', () => {
    const long = pulsePlace({
      type: 'ticket.video',
      ticketId: TICKET,
      label: ` ${'x'.repeat(200)} `,
    });
    expect(long?.context.label).toBe('x'.repeat(120));
    const blank = pulsePlace({
      type: 'ticket.video',
      ticketId: TICKET,
      label: '  ',
      uploadType: typeInfo('ticket.video', { title: 'Ticket' }),
    });
    expect(blank?.context.label).toBe('Ticket');
  });
});

describe('placeData', () => {
  it('reads nothing from a context Huddle did not make', () => {
    const base = { key: 'ticket:1', kind: 'ticket', id: '1', label: 'x' };
    expect(placeData(null)).toBeNull();
    expect(placeData(base)).toBeNull();
    expect(placeData({ ...base, data: { type: 'post', target: { kind: 'post' } } })).toBeNull();
    expect(
      placeData({
        ...base,
        data: { type: 'ticket.video', target: { kind: 'clock', id: SESSION } },
      }),
    ).toBeNull();
    expect(placeData({ ...base, data: ['ticket.video'] })).toBeNull();
  });
});
