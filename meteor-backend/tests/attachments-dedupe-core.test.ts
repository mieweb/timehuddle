/**
 * Unit tests for one video per target (huddle-server §12): the dedupe plan
 * (server/attachments-dedupe-core.js), createAttachment's duplicate-key
 * decision, the Pulse fields, and the startup migration
 * (server/migrations/pulse-attachments-dedupe.js) against an in-memory db.
 */
import { describe, it, expect } from 'vitest';

import {
  DUPLICATE_KEY_ERROR_CODE,
  VIDEO_TARGET_INDEX,
  dedupeCounts,
  existingOnDuplicate,
  planVideoDedupe,
  pulseFieldsOf,
  videoTargetFilter,
} from '../server/attachments-dedupe-core';
import { MARKER_ID, runPulseAttachmentsDedupe } from '../server/migrations/pulse-attachments-dedupe';

type Row = {
  _id: string;
  url?: string;
  type: string;
  attachedTo?: { kind: string; id: unknown };
  addedAt?: Date | string;
};

const URL_A = '/pulsevault/artifacts/0b7e7c1e-5a3f-4c1d-9e2a-6f1d2c3b4a59';
const URL_B = '/pulsevault/artifacts/1c8f8d2f-6b4a-4d2e-8f3b-7a2e3d4c5b6a';
const TICKET = { kind: 'ticket', id: 't1' };

const row = (_id: string, addedAt: string, over: Partial<Row> = {}): Row => ({
  _id,
  url: URL_A,
  type: 'video',
  attachedTo: TICKET,
  addedAt: new Date(addedAt),
  ...over,
});

describe('planVideoDedupe', () => {
  it('keeps the oldest video on a target and removes the rest', () => {
    const plan = planVideoDedupe([
      row('b', '2026-11-02T00:00:00Z'),
      row('a', '2026-11-01T00:00:00Z'),
      row('c', '2026-11-03T00:00:00Z'),
    ]);
    expect(plan.keep.map((r: Row) => r._id)).toEqual(['a']);
    expect([...plan.remove].sort()).toEqual(['b', 'c']);
    expect(plan.groups).toBe(1);
  });

  it('ignores links and images, which may repeat', () => {
    const plan = planVideoDedupe([
      row('l1', '2026-11-01T00:00:00Z', { type: 'link' }),
      row('l2', '2026-11-02T00:00:00Z', { type: 'link' }),
      row('i1', '2026-11-01T00:00:00Z', { type: 'image' }),
      row('i2', '2026-11-02T00:00:00Z', { type: 'image' }),
      row('v1', '2026-11-03T00:00:00Z'),
    ]);
    expect(plan).toEqual({ keep: [], remove: [], groups: 0 });
  });

  it('treats a video on another target or with another url as its own', () => {
    const plan = planVideoDedupe([
      row('a', '2026-11-01T00:00:00Z'),
      row('b', '2026-11-02T00:00:00Z', { url: URL_B }),
      row('c', '2026-11-03T00:00:00Z', { attachedTo: { kind: 'clock', id: 't1' } }),
      row('d', '2026-11-04T00:00:00Z', { attachedTo: { kind: 'ticket', id: 't2' } }),
      // A numeric id is another key in Mongo's index than its string.
      row('e', '2026-11-05T00:00:00Z', { attachedTo: { kind: 'ticket', id: 1 } }),
      row('f', '2026-11-06T00:00:00Z', { attachedTo: { kind: 'ticket', id: '1' } }),
    ]);
    expect(plan).toEqual({ keep: [], remove: [], groups: 0 });
  });

  it('reports the counts across several groups', () => {
    const plan = planVideoDedupe([
      row('a1', '2026-11-01T00:00:00Z'),
      row('a2', '2026-11-02T00:00:00Z'),
      row('a3', '2026-11-03T00:00:00Z'),
      row('b1', '2026-11-05T00:00:00Z', { url: URL_B }),
      row('b2', '2026-11-04T00:00:00Z', { url: URL_B }),
      row('solo', '2026-11-04T00:00:00Z', { attachedTo: { kind: 'clock', id: 's1' } }),
      row('link', '2026-11-04T00:00:00Z', { type: 'link' }),
    ]);
    expect(dedupeCounts(plan)).toEqual({ kept: 2, removed: 3, groups: 2 });
    expect(plan.keep.map((r: Row) => r._id).sort()).toEqual(['a1', 'b2']);
  });

  it('keeps a dated row over one with no date, and breaks a tie by id', () => {
    const undated = planVideoDedupe([row('a', 'not a date'), row('b', '2026-11-02T00:00:00Z')]);
    expect(undated.keep.map((r: Row) => r._id)).toEqual(['b']);
    const tie = planVideoDedupe([row('y', '2026-11-01T00:00:00Z'), row('x', '2026-11-01T00:00:00Z')]);
    expect(tie.keep.map((r: Row) => r._id)).toEqual(['x']);
    expect(tie.remove).toEqual(['y']);
  });

  it('reads an ISO string addedAt as a date', () => {
    const plan = planVideoDedupe([
      row('new', '2026-11-02T00:00:00Z', { addedAt: '2026-11-02T00:00:00.000Z' }),
      row('old', '2026-11-01T00:00:00Z', { addedAt: '2026-11-01T00:00:00.000Z' }),
    ]);
    expect(plan.keep.map((r: Row) => r._id)).toEqual(['old']);
  });
});

describe('existingOnDuplicate (createAttachment on a failed insert)', () => {
  const duplicate = Object.assign(new Error('E11000 duplicate key error'), { code: DUPLICATE_KEY_ERROR_CODE });

  it('returns the row already on the target for a duplicate key', async () => {
    const existing = { _id: 'first', url: URL_A };
    await expect(existingOnDuplicate(duplicate, async () => existing)).resolves.toBe(existing);
  });

  it('rethrows any other error without looking anything up', async () => {
    const other = Object.assign(new Error('network'), { code: 6 });
    let looked = false;
    const find = async () => {
      looked = true;
      return { _id: 'x' };
    };
    await expect(existingOnDuplicate(other, find)).rejects.toBe(other);
    await expect(existingOnDuplicate(new Error('no code'), find)).rejects.toThrow('no code');
    expect(looked).toBe(false);
  });

  it('rethrows a duplicate key with no row to return', async () => {
    await expect(existingOnDuplicate(duplicate, async () => null)).rejects.toBe(duplicate);
  });

  it('finds the existing row by the index fields, as a video', () => {
    expect(videoTargetFilter({ url: URL_A, attachedTo: TICKET })).toEqual({
      type: 'video',
      url: URL_A,
      'attachedTo.kind': 'ticket',
      'attachedTo.id': 't1',
    });
    expect(Object.keys(VIDEO_TARGET_INDEX.keys)).toEqual(['url', 'attachedTo.kind', 'attachedTo.id']);
    expect(VIDEO_TARGET_INDEX.partialFilterExpression).toEqual({ type: 'video' });
  });
});

describe('pulseFieldsOf', () => {
  it('stores nothing extra when none is given', () => {
    expect(pulseFieldsOf('video', {})).toEqual({ fields: {} });
    expect(pulseFieldsOf('link')).toEqual({ fields: {} });
  });

  it('stores the Pulse fields, with nulls for what a link-flow upload lacks', () => {
    expect(pulseFieldsOf('video', { source: 'pulse', videoid: 'v1' })).toEqual({
      fields: { source: 'pulse', videoid: 'v1', pulseUploadId: null, uploadType: null },
    });
    expect(
      pulseFieldsOf('video', { source: 'pulse', videoid: 'v1', pulseUploadId: 'u1', uploadType: 'ticket' }),
    ).toEqual({ fields: { source: 'pulse', videoid: 'v1', pulseUploadId: 'u1', uploadType: 'ticket' } });
  });

  it('refuses a bad source, a missing videoid, bad ids, or a non-video', () => {
    expect(pulseFieldsOf('video', { source: 'web', videoid: 'v1' }).error).toBeTruthy();
    expect(pulseFieldsOf('video', { videoid: 'v1' }).error).toBeTruthy();
    expect(pulseFieldsOf('video', { source: 'pulse' }).error).toBeTruthy();
    expect(pulseFieldsOf('video', { source: 'pulse', videoid: ' ' }).error).toBeTruthy();
    expect(pulseFieldsOf('video', { source: 'pulse', videoid: 'v1', pulseUploadId: 7 }).error).toBeTruthy();
    expect(pulseFieldsOf('video', { source: 'pulse', videoid: 'v1', uploadType: '' }).error).toBeTruthy();
    expect(pulseFieldsOf('link', { source: 'pulse', videoid: 'v1' }).error).toBeTruthy();
  });
});

/** Just enough of a Mongo db for the migration and migration-claim.js. */
function fakeDb(attachments: Row[], { indexFailures = 0 } = {}) {
  const markers = new Map<string, Record<string, unknown>>();
  const indexes: { keys: unknown; options: Record<string, unknown> }[] = [];
  let failuresLeft = indexFailures;
  const state = { attachments, markers, indexes };
  const collections: Record<string, unknown> = {
    attachments: {
      find(filter: { type: string }) {
        return { toArray: async () => state.attachments.filter((a) => a.type === filter.type) };
      },
      async deleteMany(filter: { _id: { $in: string[] }; type: string }) {
        const before = state.attachments.length;
        state.attachments = state.attachments.filter(
          (a) => !(filter._id.$in.includes(a._id) && a.type === filter.type),
        );
        return { deletedCount: before - state.attachments.length };
      },
      async createIndex(keys: unknown, options: Record<string, unknown>) {
        if (failuresLeft > 0) {
          failuresLeft -= 1;
          throw Object.assign(new Error('E11000 duplicate key error'), { code: DUPLICATE_KEY_ERROR_CODE });
        }
        indexes.push({ keys, options });
        return options.name;
      },
    },
    migrations: {
      async insertOne(doc: { _id: string }) {
        if (markers.has(doc._id)) {
          throw Object.assign(new Error('E11000'), { code: DUPLICATE_KEY_ERROR_CODE });
        }
        markers.set(doc._id, { ...doc });
      },
      async findOne({ _id }: { _id: string }) {
        return markers.get(_id) ?? null;
      },
      async findOneAndUpdate() {
        return null;
      },
      async updateOne({ _id }: { _id: string }, { $set }: { $set: Record<string, unknown> }) {
        const marker = markers.get(_id);
        if (marker) Object.assign(marker, $set);
      },
    },
  };
  return { db: { collection: (name: string) => collections[name] }, state };
}

const quiet = () => {};

describe('runPulseAttachmentsDedupe (startup migration)', () => {
  const duplicates = () => [
    row('a', '2026-11-01T00:00:00Z'),
    row('b', '2026-11-02T00:00:00Z'),
    row('l1', '2026-11-01T00:00:00Z', { type: 'link' }),
    row('l2', '2026-11-02T00:00:00Z', { type: 'link' }),
  ];

  it('DRY_RUN logs the counts and changes nothing: no deletes, marker or index', async () => {
    const { db, state } = fakeDb(duplicates());
    const logged: unknown[][] = [];
    const result = await runPulseAttachmentsDedupe(db, { dryRun: true, log: (...a: unknown[]) => logged.push(a) });
    expect(result).toEqual({ dryRun: true, kept: 1, removed: 1, groups: 1 });
    expect(logged).toHaveLength(1);
    expect(logged[0][1]).toEqual({ kept: 1, removed: 1, groups: 1 });
    expect(state.attachments.map((a) => a._id)).toEqual(['a', 'b', 'l1', 'l2']);
    expect(state.markers.size).toBe(0);
    expect(state.indexes).toEqual([]);
  });

  it('removes the newer duplicate video, marks it done, then creates the unique index', async () => {
    const { db, state } = fakeDb(duplicates());
    const logged: unknown[][] = [];
    await runPulseAttachmentsDedupe(db, { log: (...a: unknown[]) => logged.push(a) });
    expect(state.attachments.map((a) => a._id)).toEqual(['a', 'l1', 'l2']);
    expect(logged.map((a) => a[1])).toEqual([{ kept: 1, removed: 1, groups: 1 }]);
    expect(state.markers.get(MARKER_ID)).toMatchObject({ status: 'done' });
    expect(state.indexes).toEqual([
      {
        keys: { url: 1, 'attachedTo.kind': 1, 'attachedTo.id': 1 },
        options: {
          name: 'attachments_video_target_unique',
          unique: true,
          partialFilterExpression: { type: 'video' },
        },
      },
    ]);
  });

  it('dedupes once: a later start only (re)creates the index', async () => {
    const { db, state } = fakeDb(duplicates());
    await runPulseAttachmentsDedupe(db, { log: quiet });
    state.attachments.push(row('late', '2026-11-09T00:00:00Z'));
    await runPulseAttachmentsDedupe(db, { log: quiet });
    expect(state.attachments.map((a) => a._id)).toContain('late');
    expect(state.indexes).toHaveLength(2);
  });

  it('removes duplicates the index trips on, then creates it', async () => {
    const { db, state } = fakeDb([row('a', '2026-11-01T00:00:00Z')], { indexFailures: 1 });
    state.markers.set(MARKER_ID, { _id: MARKER_ID, status: 'done' });
    state.attachments.push(row('b', '2026-11-02T00:00:00Z'));
    await runPulseAttachmentsDedupe(db, { log: quiet });
    expect(state.attachments.map((a) => a._id)).toEqual(['a']);
    expect(state.indexes).toHaveLength(1);
  });
});
