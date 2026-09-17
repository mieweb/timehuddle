/**
 * "My Board" — a personal priority list of tickets/issues (Milestone 2.2).
 *
 * Identity only: `{ userId, sourceId, ticketId, addedAt }`. No title, status, or
 * any other display field is snapshotted here — the client resolves those by
 * looking the ref up against its already-fetched unified ticket list (Core
 * Model Data Discipline). A board entry whose ticket later disappears from
 * that list (archived, deleted, out of the Redmine fetch window) is simply
 * omitted client-side; nothing here needs to know why.
 */
import { Meteor } from 'meteor/meteor';

import { MyBoard } from './collections';
import { requireIdentity } from './auth-bridge';

const DUPLICATE_KEY_ERROR_CODE = 11000;

// Enforces "one board row per (user, ticket)" at the storage layer, so
// `addMany` can upsert idempotently instead of erroring on a re-add.
Meteor.startup(async () => {
  try {
    await MyBoard.createIndexAsync(
      { userId: 1, sourceId: 1, ticketId: 1 },
      { unique: true, name: 'unique_my_board_entry' },
    );
  } catch (error) {
    console.error('[my-board] failed to create unique entry index:', error);
  }
});

function validateRefs(refs) {
  if (!Array.isArray(refs) || refs.length === 0) {
    throw new Meteor.Error('bad-request', 'refs array required');
  }
  for (const ref of refs) {
    if (typeof ref?.sourceId !== 'string' || !ref.sourceId || typeof ref?.ticketId !== 'string' || !ref.ticketId) {
      throw new Meteor.Error('bad-request', 'Each ref requires a sourceId and a ticketId.');
    }
  }
}

/** Upsert one (userId, sourceId, ticketId) entry, tolerating a concurrent-insert race. */
async function upsertEntry(userId, { sourceId, ticketId }) {
  const selector = { userId, sourceId, ticketId };
  try {
    await MyBoard.upsertAsync(selector, { $setOnInsert: { addedAt: new Date() } });
  } catch (err) {
    if (err?.code !== DUPLICATE_KEY_ERROR_CODE) throw err;
    // Lost a concurrent first-insert race against the unique index; the row
    // now exists, so there's nothing left to do.
  }
}

Meteor.methods({
  /** List the caller's My Board entries (identity only, no display fields). */
  async 'myBoard.list'() {
    const { userId } = await requireIdentity(this);
    const entries = await MyBoard.find(
      { userId },
      { fields: { sourceId: 1, ticketId: 1, addedAt: 1 } },
    ).fetchAsync();
    return {
      entries: entries.map((e) => ({
        sourceId: e.sourceId,
        ticketId: e.ticketId,
        addedAt: e.addedAt,
      })),
    };
  },

  /** Add tickets to the caller's My Board. Idempotent — re-adding is a no-op. */
  async 'myBoard.addMany'({ refs } = {}) {
    const { userId } = await requireIdentity(this);
    validateRefs(refs);
    await Promise.all(refs.map((ref) => upsertEntry(userId, ref)));
    return { addedCount: refs.length };
  },

  /** Remove tickets from the caller's My Board. */
  async 'myBoard.removeMany'({ refs } = {}) {
    const { userId } = await requireIdentity(this);
    validateRefs(refs);
    const result = await MyBoard.rawCollection().deleteMany({
      userId,
      $or: refs.map(({ sourceId, ticketId }) => ({ sourceId, ticketId })),
    });
    return { removedCount: result.deletedCount };
  },
});
