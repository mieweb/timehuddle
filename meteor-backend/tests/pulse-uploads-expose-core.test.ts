/**
 * Unit tests for the pulseUploads method surface
 * (server/pulse-uploads-expose-core.js): every method is registered with
 * Wormhole with its schema and states its rate limit, the Meteor wrapper
 * signs each call in and enforces that limit per user, and the argument
 * checks, queries and row shapes the methods and publications use.
 */
import { describe, it, expect } from 'vitest';

import {
  adminScopeQuery,
  adminUpload,
  checkAdminListArgs,
  checkCancelArgs,
  checkListArgs,
  checkRetargetArgs,
  checkTokenArgs,
  exposePulseUploads,
  forTargetQuery,
  forTargetScope,
  mineQuery,
  OWN_UPLOAD_FIELDS,
  PUBLIC_UPLOAD_FIELDS,
  PULSE_UPLOAD_LIMITS,
  PULSE_UPLOAD_METHODS,
  publicUpload,
  pulseUploadMethods,
  RECENT_OUTCOME_MS,
  sessionAtSendQuery,
  TOO_MANY_PULSE_UPLOAD_CALLS,
} from '../server/pulse-uploads-expose-core';
import { isClockType, pulseUploadTypesFor } from '../server/pulse-upload-types';

const USER = 'Us9dF2gH4jK6lZ8xC';
const OTHER = 'Ot4hR7kL2mN9pQ3sV';
const TICKET = '64b1f0c2a9e8d7c6b5a49382';
const SESSION = '65aa00b1c2d3e4f5a6b7c8d9';
const TEAM = 'Tm7xKq2ZpR4sW9aBc';

/** The methods huddle-server §5 names, and nothing else. */
const METHOD_NAMES = [
  'pulseUploads.begin',
  'pulseUploads.token',
  'pulseUploads.cancel',
  'pulseUploads.list',
  'pulseUploads.retarget',
  'pulseUploads.adminList',
  'pulseUploadTypes.list',
];

type Schema = Record<string, unknown>;
type Exposed = { name: string; options: { description: string; inputSchema: Schema; outputSchema: Schema } };
type Checked = { error?: string; reason?: string; value?: unknown };

/** `map` without `name`. */
function without<T>(map: Record<string, T>, name: string) {
  const rest = { ...map };
  delete rest[name];
  return rest;
}

/** A Wormhole that records what is exposed through it. */
function mockWormhole() {
  const exposed: Exposed[] = [];
  return { exposed, expose: (name: string, options: Exposed['options']) => exposed.push({ name, options }) };
}

/** A handler per method that records the identity and arguments it ran with. */
function recordingHandlers() {
  const calls: Array<{ name: string; identity: { userId: string }; args: unknown; invocation: unknown }> = [];
  const handlers = Object.fromEntries(
    METHOD_NAMES.map((name) => [
      name,
      (identity: { userId: string }, args: unknown, invocation: unknown) => {
        calls.push({ name, identity, args, invocation });
        return { ran: name };
      },
    ]),
  );
  return { calls, handlers };
}

/** The Meteor methods over `handlers`, with a clock the test moves and the caller in `this.userId`. */
function methodsAt(handlers: Record<string, unknown>) {
  let clock = 1_000_000;
  const refusals: number[] = [];
  const methods = pulseUploadMethods(handlers, {
    requireIdentity: async (invocation: { userId?: string }) => {
      if (!invocation?.userId) throw new Error('not-authorized');
      return { userId: invocation.userId, name: 'Someone' };
    },
    tooManyRequests: (retryAfterMs: number) => {
      refusals.push(retryAfterMs);
      return Object.assign(new Error(TOO_MANY_PULSE_UPLOAD_CALLS.reason), { error: TOO_MANY_PULSE_UPLOAD_CALLS.error });
    },
    now: () => clock,
  });
  const call = (name: string, userId: string | null, args?: unknown) =>
    (methods[name] as (this: unknown, args?: unknown) => Promise<unknown>).call({ userId }, args);
  return { methods, call, refusals, advance: (ms: number) => (clock += ms) };
}

describe('exposePulseUploads (mock Wormhole)', () => {
  it('names every method of huddle-server §5 and nothing else', () => {
    expect(Object.keys(PULSE_UPLOAD_METHODS).sort()).toEqual([...METHOD_NAMES].sort());
  });

  it('exposes every method with its schemas, and a description that states its rate limit', () => {
    const { methods } = methodsAt(recordingHandlers().handlers);
    const wormhole = mockWormhole();
    const names = exposePulseUploads(wormhole, methods);

    expect(names.sort()).toEqual([...METHOD_NAMES].sort());
    expect(wormhole.exposed.map((e) => e.name).sort()).toEqual([...METHOD_NAMES].sort());
    for (const { name, options } of wormhole.exposed) {
      const { rateLimit } = PULSE_UPLOAD_METHODS[name as keyof typeof PULSE_UPLOAD_METHODS];
      // Wormhole passes the body as the one argument only with an inputSchema.
      expect(options.inputSchema, name).toMatchObject({ type: 'object' });
      expect(options.outputSchema, name).toMatchObject({ type: 'object' });
      expect(options.description, name).toContain(`Limited to ${rateLimit.limit} calls per 60 s per user.`);
    }
  });

  it('requires the fields begin, token and retarget cannot run without', () => {
    expect(PULSE_UPLOAD_METHODS['pulseUploads.begin'].inputSchema.required).toEqual([
      'clientKey',
      'draftKey',
      'type',
      'target',
      'sentAt',
    ]);
    expect(PULSE_UPLOAD_METHODS['pulseUploads.token'].inputSchema.required).toEqual(['uploadId']);
    expect(PULSE_UPLOAD_METHODS['pulseUploads.retarget'].inputSchema.required).toEqual(['uploadId', 'type', 'target']);
  });

  it('refuses a method map missing a method, or with one that has no schema', () => {
    const { methods } = methodsAt(recordingHandlers().handlers);
    expect(() => exposePulseUploads(mockWormhole(), without(methods, 'pulseUploads.cancel'))).toThrow(/pulseUploads.cancel is missing/);
    expect(() => exposePulseUploads(mockWormhole(), { ...methods, 'pulseUploads.extra': async () => null })).toThrow(
      /pulseUploads.extra has no schema or rate limit/,
    );
  });

  it('gives each method its own limit: begin 120, token 240 a minute', () => {
    expect(PULSE_UPLOAD_METHODS['pulseUploads.begin'].rateLimit).toEqual({ limit: 120, windowMs: 60_000 });
    expect(PULSE_UPLOAD_METHODS['pulseUploads.token'].rateLimit).toEqual({ limit: 240, windowMs: 60_000 });
    for (const name of METHOD_NAMES) {
      const { rateLimit } = PULSE_UPLOAD_METHODS[name as keyof typeof PULSE_UPLOAD_METHODS];
      expect(Object.values(PULSE_UPLOAD_LIMITS), name).toContain(rateLimit);
    }
  });
});

describe('pulseUploadMethods (the Meteor wrapper)', () => {
  it('signs the call in and passes the identity, the arguments ({} for none) and the invocation', async () => {
    const { calls, handlers } = recordingHandlers();
    const { call } = methodsAt(handlers);
    await expect(call('pulseUploads.list', USER, { limit: 5 })).resolves.toEqual({ ran: 'pulseUploads.list' });
    await call('pulseUploadTypes.list', USER);
    expect(calls[0]).toMatchObject({ identity: { userId: USER }, args: { limit: 5 }, invocation: { userId: USER } });
    expect(calls[1].args).toEqual({});
  });

  it('refuses a call that is not signed in, and runs nothing', async () => {
    const { calls, handlers } = recordingHandlers();
    const { call } = methodsAt(handlers);
    await expect(call('pulseUploads.begin', null, {})).rejects.toThrow('not-authorized');
    expect(calls).toHaveLength(0);
  });

  it("enforces every method's limit per user, and lets the next window through", async () => {
    for (const name of METHOD_NAMES) {
      const { calls, handlers } = recordingHandlers();
      const { call, refusals, advance } = methodsAt(handlers);
      const { limit, windowMs } = PULSE_UPLOAD_METHODS[name as keyof typeof PULSE_UPLOAD_METHODS].rateLimit;
      for (let i = 0; i < limit; i += 1) await call(name, USER, {});
      await expect(call(name, USER, {}), name).rejects.toMatchObject({ error: 'too-many-requests' });
      expect(calls, name).toHaveLength(limit);
      expect(refusals, name).toEqual([windowMs]);
      // Someone else, and another method, have their own counts.
      await expect(call(name, OTHER, {}), name).resolves.toEqual({ ran: name });
      advance(windowMs);
      await expect(call(name, USER, {}), name).resolves.toEqual({ ran: name });
    }
  });

  it('counts each method on its own', async () => {
    const { handlers } = recordingHandlers();
    const { call } = methodsAt(handlers);
    for (let i = 0; i < PULSE_UPLOAD_LIMITS.retarget.limit; i += 1) await call('pulseUploads.retarget', USER, {});
    await expect(call('pulseUploads.retarget', USER, {})).rejects.toMatchObject({ error: 'too-many-requests' });
    await expect(call('pulseUploads.token', USER, {})).resolves.toEqual({ ran: 'pulseUploads.token' });
  });

  it('refuses handlers that do not match the methods', () => {
    const { handlers } = recordingHandlers();
    expect(() => methodsAt(without(handlers, 'pulseUploads.begin'))).toThrow(/A handler for pulseUploads.begin is missing/);
  });
});

describe('arguments', () => {
  it('token: an uploadId, and a clientKey when sent', () => {
    expect(checkTokenArgs({ uploadId: 'u1' })).toEqual({ value: { uploadId: 'u1', clientKey: null } });
    expect(checkTokenArgs({ uploadId: 'u1', clientKey: 'i:d:0123456789abcdef' })).toEqual({
      value: { uploadId: 'u1', clientKey: 'i:d:0123456789abcdef' },
    });
    expect((checkTokenArgs({}) as Checked).error).toBe('bad-request');
    expect((checkTokenArgs({ uploadId: 7 }) as Checked).error).toBe('bad-request');
  });

  it('cancel: by uploadId or clientKey, and why (cancelled by default)', () => {
    expect(checkCancelArgs({ uploadId: 'u1' })).toEqual({ value: { uploadId: 'u1', clientKey: null, reason: 'canceled' } });
    expect(checkCancelArgs({ clientKey: 'k', reason: 'deleted' })).toEqual({
      value: { uploadId: null, clientKey: 'k', reason: 'deleted' },
    });
    expect((checkCancelArgs({}) as Checked).error).toBe('bad-request');
    expect((checkCancelArgs({ uploadId: 'u1', reason: 'bored' }) as Checked).error).toBe('bad-request');
  });

  it("list: the caller's rows, filtered, at most 100", () => {
    const { value } = checkListArgs(USER, {
      states: ['reserved', 'uploading', 'reserved'],
      targetKey: `ticket:${TICKET}`,
      since: 1_700_000_000_000,
      limit: 10,
    }) as Checked;
    expect(value).toEqual({
      query: {
        userId: USER,
        state: { $in: ['reserved', 'uploading'] },
        targetKey: `ticket:${TICKET}`,
        updatedAt: { $gte: new Date(1_700_000_000_000) },
      },
      limit: 10,
    });
    expect((checkListArgs(USER, {}) as Checked).value).toEqual({ query: { userId: USER }, limit: 50 });
    expect((checkListArgs(USER, { states: ['lost'] }) as Checked).error).toBe('bad-request');
    expect((checkListArgs(USER, { targetKey: 'Ticket:X Y' }) as Checked).error).toBe('bad-request');
    expect((checkListArgs(USER, { limit: 101 }) as Checked).error).toBe('bad-request');
    expect((checkListArgs(USER, { since: 'yesterday' }) as Checked).error).toBe('bad-request');
  });

  it('retarget: a ticket, a session, a post or the library, never a clock type', () => {
    expect((checkRetargetArgs(USER, { uploadId: 'u1', type: 'ticket.video', target: { kind: 'ticket', id: TICKET.toUpperCase() } }) as Checked).value).toEqual({
      uploadId: 'u1',
      type: 'ticket.video',
      target: { kind: 'ticket', id: TICKET },
      targetKey: `ticket:${TICKET}`,
    });
    expect((checkRetargetArgs(USER, { uploadId: 'u1', type: 'library.video', target: { kind: 'library' } }) as Checked).value).toMatchObject({
      targetKey: `library:${USER.toLowerCase()}`,
    });
    expect((checkRetargetArgs(USER, { uploadId: 'u1', type: 'clock.wrapup', target: { kind: 'clock', id: SESSION } }) as Checked).error).toBe('bad-request');
    expect((checkRetargetArgs(USER, { uploadId: 'u1', type: 'ticket.video', target: { kind: 'clock', id: SESSION } }) as Checked).error).toBe('bad-request');
  });

  it('adminList: filters by person, place or session, and sees own rows plus administered teams', () => {
    expect((checkAdminListArgs({ userId: OTHER, clockEventId: SESSION.toUpperCase() }) as Checked).value).toEqual({
      query: { userId: OTHER, clockEventId: SESSION },
      limit: 50,
    });
    expect((checkAdminListArgs({ targetKey: 'nope' }) as Checked).error).toBe('bad-request');
    expect(adminScopeQuery(USER, [])).toEqual({ $or: [{ userId: USER }] });
    expect(adminScopeQuery(USER, ['t1', 't2'])).toEqual({ $or: [{ userId: USER }, { teamId: { $in: ['t1', 't2'] } }] });
  });
});

describe('publications', () => {
  it("mine: the caller's rows on their way, and outcomes of the last 7 days", () => {
    const now = 1_800_000_000_000;
    expect(mineQuery(USER, now)).toEqual({
      userId: USER,
      $or: [
        { state: { $in: ['intent', 'reserved', 'uploading', 'processing'] } },
        { state: { $in: ['delivered', 'kept'] }, updatedAt: { $gte: new Date(now - RECENT_OUTCOME_MS) } },
      ],
    });
  });

  it("forTarget: a Huddle team's key shows only the caller's own rows (#871 R21)", () => {
    expect(forTargetScope(`huddle:${TEAM.toLowerCase()}`)).toEqual({ check: 'own' });
    expect(forTargetScope(`clock-plan:${TEAM.toLowerCase()}:2026-11-18`)).toEqual({ check: 'own' });
    expect(forTargetScope(`library:${USER.toLowerCase()}`)).toEqual({ check: 'own' });
    expect(forTargetScope(`ticket:${TICKET}`)).toEqual({ check: 'ticket', id: TICKET });
    expect(forTargetScope(`clock:${SESSION}`)).toEqual({ check: 'clock', id: SESSION });
    expect(forTargetScope('ticket:')).toBeNull();
    expect(forTargetScope(42)).toBeNull();
  });

  it('forTarget: rows with an artifact under way, the owner only when asked', () => {
    expect(forTargetQuery(`ticket:${TICKET}`)).toEqual({
      targetKey: `ticket:${TICKET}`,
      state: { $in: ['reserved', 'uploading', 'processing'] },
    });
    expect(forTargetQuery(`huddle:${TEAM.toLowerCase()}`, USER)).toMatchObject({ userId: USER });
  });

  it('sends no clientKey or draftKey of anyone else', () => {
    expect(PUBLIC_UPLOAD_FIELDS).not.toHaveProperty('clientKey');
    expect(PUBLIC_UPLOAD_FIELDS).not.toHaveProperty('draftKey');
    expect(OWN_UPLOAD_FIELDS).toMatchObject({ clientKey: 1, draftKey: 1 });
  });
});

describe('the session at Send (H4)', () => {
  it('is the open one at begin, and the one open at sentAt later', () => {
    expect(sessionAtSendQuery(USER, TEAM, 5000, 'at-begin')).toEqual({ userId: USER, teamId: TEAM, endTime: null });
    expect(sessionAtSendQuery(USER, TEAM, 5000, 'as-of-sent')).toEqual({
      userId: USER,
      teamId: TEAM,
      startTime: { $lte: 5000 },
      $or: [{ endTime: null }, { endTime: { $gt: 5000 } }],
    });
  });
});

describe('row shapes', () => {
  const row = {
    _id: 'u1',
    userId: USER,
    clientKey: 'i:d:0123456789abcdef',
    draftKey: 'i:d',
    type: 'ticket.video',
    targetKey: `ticket:${TICKET}`,
    state: 'delivered',
    name: 'Fix login',
    durationMs: 1200,
    sentAt: new Date('2026-11-18T10:00:00Z'),
    updatedAt: new Date('2026-11-18T10:05:00Z'),
    reason: null,
    note: 'Attached to ticket',
    attachmentId: null,
    mediaId: 'm1',
    artifactId: 'a1',
  };

  it('public: id for _id, ISO dates, keys only on own rows', () => {
    const shown = publicUpload(row);
    expect(shown).toEqual({
      id: 'u1',
      userId: USER,
      type: 'ticket.video',
      targetKey: `ticket:${TICKET}`,
      state: 'delivered',
      name: 'Fix login',
      durationMs: 1200,
      sentAt: '2026-11-18T10:00:00.000Z',
      updatedAt: '2026-11-18T10:05:00.000Z',
      reason: null,
      note: 'Attached to ticket',
      attachmentId: null,
      mediaId: 'm1',
    });
    expect(publicUpload(row, { own: true })).toMatchObject({ clientKey: row.clientKey, draftKey: 'i:d' });
  });

  it('admin: every field with who sent it', () => {
    expect(adminUpload(row, 'Pat')).toMatchObject({ id: 'u1', artifactId: 'a1', sentAt: '2026-11-18T10:00:00.000Z', userName: 'Pat' });
  });
});

describe('pulseUploadTypesFor', () => {
  it('offers the clock types only to someone who may clock', () => {
    const all = pulseUploadTypesFor({ mayClock: true }).map((type) => type?.id);
    const noClock = pulseUploadTypesFor({ mayClock: false }).map((type) => type?.id);
    expect(all).toEqual(['ticket.video', 'clock.session', 'clock.wrapup', 'clock.plan', 'huddle.post', 'library.video']);
    expect(noClock).toEqual(all.filter((id) => !isClockType(id)));
    expect(noClock).toContain('clock.session');
  });
});
