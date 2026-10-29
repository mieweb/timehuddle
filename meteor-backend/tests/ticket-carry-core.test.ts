/**
 * Carrying a Redmine issue on a ticket (#736): the find-or-create order, the
 * new ticket's title, and the lock that keeps one ticket per issue per team.
 */
import { describe, it, expect, vi } from 'vitest';

import {
  CARRY_LOCK_STALE_MS,
  CARRY_WAIT_MS,
  carriedTitle,
  carryLockId,
  findOrCarry,
  withCarryLock,
} from '../server/ticket-carry-core';

/** An in-memory stand-in for the `carry_locks` collection. */
function fakeLocks() {
  const rows = new Map<string, { _id: string; takenAt: Date }>();
  return {
    rows,
    async insertOne(doc: { _id: string; takenAt: Date }) {
      if (rows.has(doc._id)) throw Object.assign(new Error('duplicate key'), { code: 11000 });
      rows.set(doc._id, doc);
    },
    async updateOne(
      filter: { _id: string; takenAt: { $lt: Date } },
      update: { $set: { takenAt: Date } },
    ) {
      const row = rows.get(filter._id);
      if (!row || !(row.takenAt < filter.takenAt.$lt)) return { modifiedCount: 0 };
      row.takenAt = update.$set.takenAt;
      return { modifiedCount: 1 };
    },
    async deleteOne(filter: { _id: string; takenAt: Date }) {
      const row = rows.get(filter._id);
      if (row && row.takenAt.getTime() === filter.takenAt.getTime()) rows.delete(filter._id);
    },
  };
}

const noWait = async () => {};

describe('carryLockId', () => {
  it('is one lock per team and issue', () => {
    expect(carryLockId('team1', '482')).toBe('team1:482');
    expect(carryLockId('team2', '482')).not.toBe(carryLockId('team1', '482'));
  });
});

describe('carriedTitle', () => {
  it("takes the issue's subject", () => {
    expect(carriedTitle({ subject: '  Fix login timeout ' }, '482')).toBe('Fix login timeout');
  });

  it('names the issue when it has no subject', () => {
    expect(carriedTitle({ subject: '' }, '482')).toBe('Redmine issue #482');
    expect(carriedTitle(null, '482')).toBe('Redmine issue #482');
  });
});

describe('findOrCarry', () => {
  it('returns the ticket already carrying the issue, without asking Redmine', async () => {
    const readIssue = vi.fn();
    const createCarrier = vi.fn();
    const result = await findOrCarry({
      findCarrier: async () => ({ id: 't1' }),
      readIssue,
      createCarrier,
    });
    expect(result).toEqual({ ticket: { id: 't1' }, created: false });
    expect(readIssue).not.toHaveBeenCalled();
    expect(createCarrier).not.toHaveBeenCalled();
  });

  it('reads the issue and creates a carrier when there is none', async () => {
    const createCarrier = vi.fn(async (issue: { subject: string }) => ({
      id: 'new',
      title: issue.subject,
    }));
    const result = await findOrCarry({
      findCarrier: async () => null,
      readIssue: async () => ({ subject: 'Fix login timeout' }),
      createCarrier,
    });
    expect(result).toEqual({ ticket: { id: 'new', title: 'Fix login timeout' }, created: true });
  });

  it('creates nothing when the issue cannot be read', async () => {
    const createCarrier = vi.fn();
    await expect(
      findOrCarry({
        findCarrier: async () => null,
        readIssue: async () => {
          throw new Error('issue-unavailable');
        },
        createCarrier,
      }),
    ).rejects.toThrow('issue-unavailable');
    expect(createCarrier).not.toHaveBeenCalled();
  });
});

describe('withCarryLock', () => {
  it('runs the work and releases the lock', async () => {
    const locks = fakeLocks();
    const result = await withCarryLock(locks, 'team1:482', async () => {
      expect(locks.rows.has('team1:482')).toBe(true);
      return 'done';
    });
    expect(result).toBe('done');
    expect(locks.rows.size).toBe(0);
  });

  it('releases the lock when the work fails', async () => {
    const locks = fakeLocks();
    await expect(
      withCarryLock(locks, 'team1:482', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(locks.rows.size).toBe(0);
  });

  it('makes a second caller wait for the first, so the issue is carried once', async () => {
    const locks = fakeLocks();
    let carriers = 0;
    const carry = async () => {
      // The second caller finds the ticket the first one created.
      if (carriers === 0) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        carriers += 1;
        return 'created';
      }
      return 'found';
    };
    const results = await Promise.all([
      withCarryLock(locks, 'team1:482', carry),
      withCarryLock(locks, 'team1:482', carry),
    ]);
    expect(results.sort()).toEqual(['created', 'found']);
    expect(carriers).toBe(1);
  });

  it('outwaits a carry stuck on a slow Redmine read', async () => {
    const locks = fakeLocks();
    locks.rows.set('team1:482', { _id: 'team1:482', takenAt: new Date() });
    // The holder's Redmine read times out after 8 seconds, then it lets go.
    let waited = 0;
    const wait = async (ms: number) => {
      waited += ms;
      if (waited >= 8000) locks.rows.delete('team1:482');
    };
    await expect(withCarryLock(locks, 'team1:482', async () => 'found', { wait })).resolves.toBe(
      'found',
    );
    expect(waited).toBeLessThanOrEqual(CARRY_WAIT_MS);
  });

  it('takes over a lock left behind by a crash', async () => {
    const locks = fakeLocks();
    const start = Date.now();
    locks.rows.set('team1:482', {
      _id: 'team1:482',
      takenAt: new Date(start - CARRY_LOCK_STALE_MS - 1),
    });
    const result = await withCarryLock(locks, 'team1:482', async () => 'done', {
      now: () => start,
    });
    expect(result).toBe('done');
    expect(locks.rows.size).toBe(0);
  });

  it('gives up with carry-busy when the lock stays taken', async () => {
    const locks = fakeLocks();
    locks.rows.set('team1:482', { _id: 'team1:482', takenAt: new Date() });
    const work = vi.fn();
    await expect(withCarryLock(locks, 'team1:482', work, { wait: noWait })).rejects.toMatchObject({
      code: 'carry-busy',
    });
    expect(work).not.toHaveBeenCalled();
    // Someone else's lock is left alone.
    expect(locks.rows.has('team1:482')).toBe(true);
  });
});
