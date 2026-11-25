/**
 * "My Board" — a personal priority list of tickets/issues.
 *
 * Identity only: `{ userId, sourceId, ticketId, addedAt, pinOrder? }`. No title, status, or
 * any other display field is snapshotted here — the client resolves those by
 * looking the ref up against its already-fetched unified ticket list (Core
 * Model Data Discipline). A Redmine entry keeps its issue in that list — the
 * relevant list counts the board as a reason (`board`) — so an entry only goes
 * unresolved when its ticket is gone: a Huddle ticket deleted, or a Redmine
 * issue deleted or no longer visible. The Tickets page offers to remove those.
 *
 * Pinning (#884) is a place in the user's plan for the day, kept on the board
 * row itself: `pinOrder` set means pinned, and pins list in ascending order.
 * So only a ticket on the board can be pinned, and taking it off the board
 * unpins it with no second write.
 */
import { Meteor } from 'meteor/meteor';

import { Mongo } from 'meteor/mongo';

import { DUPLICATE_KEY_ERROR_CODE, MyBoard, Tickets, isValidId } from './collections';
import { requireIdentity } from './auth-bridge';
import { bustUserCaches } from './redmine-cache';
import { HUDDLE, refKey, teamsOpenTo } from './ticket-refs';

/**
 * The most tickets one board holds, and so the most one call may name. Every
 * Redmine entry is an issue the relevant list fetches, so the board cannot be
 * left to grow without limit; nobody works from a list of 500.
 */
const MAX_BOARD_ENTRIES_PER_USER = 500;

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

/** `allowEmpty` for a call where no refs means something: setPins([]) unpins everything. */
function validateRefs(refs, { allowEmpty = false } = {}) {
  if (!Array.isArray(refs) || (refs.length === 0 && !allowEmpty)) {
    throw new Meteor.Error('bad-request', 'refs array required');
  }
  if (refs.length > MAX_BOARD_ENTRIES_PER_USER) {
    throw new Meteor.Error('bad-request', `At most ${MAX_BOARD_ENTRIES_PER_USER} refs per call.`);
  }
  for (const ref of refs) {
    if (typeof ref?.sourceId !== 'string' || !ref.sourceId || typeof ref?.ticketId !== 'string' || !ref.ticketId) {
      throw new Meteor.Error('bad-request', 'Each ref requires a sourceId and a ticketId.');
    }
  }
}

/**
 * Whether a ref names a ticket that can go on the board. Only TimeHuddle
 * tickets do: a Redmine issue goes on as the ticket carrying it (#736).
 */
const isTicketRef = ({ sourceId, ticketId }) => sourceId === HUDDLE && isValidId(ticketId);

/**
 * The distinct refs of an add request. Stricter than `validateRefs`, which
 * removal keeps so that a row written before this check can still be removed.
 */
function addableRefs(refs) {
  validateRefs(refs);
  const byKey = new Map();
  for (const { sourceId, ticketId } of refs) {
    if (!isTicketRef({ sourceId, ticketId })) {
      throw new Meteor.Error('bad-request', 'Unknown ticket reference.');
    }
    byKey.set(refKey(sourceId, ticketId), { sourceId, ticketId });
  }
  return [...byKey.values()];
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

/**
 * Put one ticket on a user's board unless the board is full. For adds the user
 * did not make by hand (a ticket they just created): those must never fail the
 * action that caused them, so a full board is skipped rather than refused.
 * @returns {Promise<boolean>} whether the ticket is on the board afterwards
 */
export async function addBoardEntryIfRoom(userId, ref) {
  const held = await MyBoard.find({ userId }).countAsync();
  if (held >= MAX_BOARD_ENTRIES_PER_USER) return false;
  await upsertEntry(userId, ref);
  return true;
}

/**
 * Of these Huddle ticket ids, the ones this user can no longer see: deleted, or
 * in a team they are not in. The same visibility `tickets.byTeam` publishes, so
 * the Tickets page is told for certain — its live list can be momentarily
 * partial while the subscription fills, which must not read as "gone".
 */
async function unavailableHuddleTicketIds(userId, ticketIds) {
  if (!ticketIds.length) return new Set();
  const tickets = await Tickets.find(
    {
      _id: { $in: ticketIds.filter(isValidId).map((id) => new Mongo.ObjectID(id)) },
      status: { $ne: 'deleted' },
    },
    { fields: { teamId: 1 } },
  ).fetchAsync();
  const visibleTeams = await teamsOpenTo(
    userId,
    tickets.map((t) => t.teamId),
  );
  const visible = new Set(
    tickets.filter((t) => visibleTeams.has(t.teamId)).map((t) => t._id.toHexString()),
  );
  return new Set(ticketIds.filter((id) => !visible.has(id)));
}

/**
 * The board is a reason for a Redmine issue to be in the relevant list, which is
 * cached for 90 seconds, so a board change must clear it.
 */
function bustIfRedmine(userId, refs) {
  if (refs.some((ref) => ref.sourceId === 'redmine')) bustUserCaches(userId);
}

/** One ref, as the pin methods take it. */
function validateRef(ref) {
  validateRefs([ref]);
  return { sourceId: ref.sourceId, ticketId: ref.ticketId };
}

/** Delete these (sourceId, ticketId) entries from one user's board. */
export async function removeBoardEntries(userId, refs) {
  const result = await MyBoard.rawCollection().deleteMany({
    userId,
    $or: refs.map(({ sourceId, ticketId }) => ({ sourceId, ticketId })),
  });
  bustIfRedmine(userId, refs);
  return result.deletedCount;
}

/**
 * Unpin these Huddle tickets on one user's board (M5 carry-over, #887): each
 * ticket's own entry and the entry for the issue it's linked to, either of
 * which pins it. They stay on the board, back with the rest; the pins left
 * keep their order.
 * @returns {Promise<number>} how many entries were unpinned
 */
export async function releasePins(userId, ticketIds) {
  const ids = ticketIds.filter(isValidId);
  if (!ids.length) return 0;
  const tickets = await Tickets.find(
    { _id: { $in: ids.map((id) => new Mongo.ObjectID(id)) } },
    { fields: { linkedIssue: 1 } },
  ).fetchAsync();
  const refs = [
    ...ids.map((ticketId) => ({ sourceId: HUDDLE, ticketId })),
    ...tickets.flatMap(({ linkedIssue }) =>
      linkedIssue?.source && linkedIssue?.id
        ? [{ sourceId: linkedIssue.source, ticketId: String(linkedIssue.id) }]
        : [],
    ),
  ];
  const result = await MyBoard.rawCollection().updateMany(
    { userId, pinOrder: { $type: 'number' }, $or: refs },
    { $unset: { pinOrder: '' } },
  );
  return result.modifiedCount;
}

Meteor.methods({
  /**
   * List the caller's My Board entries (identity only, no display fields).
   * A Huddle entry whose ticket the caller can no longer see is marked
   * `unavailable`; Redmine entries are answered by `redmine.issues.relevant`,
   * since only Redmine can say whether an issue still exists.
   */
  async 'myBoard.list'() {
    const { userId } = await requireIdentity(this);
    const entries = await MyBoard.find(
      { userId },
      { fields: { sourceId: 1, ticketId: 1, addedAt: 1, pinOrder: 1 } },
    ).fetchAsync();
    const gone = await unavailableHuddleTicketIds(
      userId,
      entries.filter((e) => e.sourceId === 'huddle').map((e) => e.ticketId),
    );
    return {
      entries: entries.map((e) => ({
        sourceId: e.sourceId,
        ticketId: e.ticketId,
        addedAt: e.addedAt,
        ...(typeof e.pinOrder === 'number' ? { pinOrder: e.pinOrder } : {}),
        ...(e.sourceId === 'huddle' && gone.has(e.ticketId) ? { unavailable: true } : {}),
      })),
    };
  },

  /**
   * Add tickets to the caller's My Board. Idempotent — re-adding is a no-op.
   * `addedCount` is how many of the refs are on the board afterwards.
   */
  async 'myBoard.addMany'({ refs } = {}) {
    const { userId } = await requireIdentity(this);
    const wanted = addableRefs(refs);

    // A ticket the caller cannot see is skipped, not refused: one stale row in
    // a selection should not stop the rest.
    const hidden = await unavailableHuddleTicketIds(
      userId,
      wanted.map((ref) => ref.ticketId),
    );
    const allowed = wanted.filter((ref) => !hidden.has(ref.ticketId));

    const existing = await MyBoard.find(
      { userId },
      { fields: { sourceId: 1, ticketId: 1 } },
    ).fetchAsync();
    const onBoard = new Set(existing.map((e) => refKey(e.sourceId, e.ticketId)));
    const fresh = allowed.filter((ref) => !onBoard.has(refKey(ref.sourceId, ref.ticketId)));
    if (existing.length + fresh.length > MAX_BOARD_ENTRIES_PER_USER) {
      throw new Meteor.Error(
        'board-full',
        `My Board holds at most ${MAX_BOARD_ENTRIES_PER_USER} tickets. Remove some first.`,
      );
    }

    await Promise.all(fresh.map((ref) => upsertEntry(userId, ref)));
    bustIfRedmine(userId, fresh);
    return { addedCount: allowed.length };
  },

  /** Remove tickets from the caller's My Board. */
  async 'myBoard.removeMany'({ refs } = {}) {
    const { userId } = await requireIdentity(this);
    validateRefs(refs);
    return { removedCount: await removeBoardEntries(userId, refs) };
  },

  /**
   * Pin one of the caller's board entries, after the pins already there.
   * Pinning one already pinned leaves it where it is.
   */
  async 'myBoard.pin'({ ref } = {}) {
    const { userId } = await requireIdentity(this);
    const { sourceId, ticketId } = validateRef(ref);
    const entry = await MyBoard.findOneAsync(
      { userId, sourceId, ticketId },
      { fields: { pinOrder: 1 } },
    );
    if (!entry) throw new Meteor.Error('not-on-board', 'Only a ticket on My Board can be pinned.');
    if (typeof entry.pinOrder === 'number') return { pinned: true };

    const [last] = await MyBoard.find(
      { userId, pinOrder: { $type: 'number' } },
      { sort: { pinOrder: -1 }, limit: 1, fields: { pinOrder: 1 } },
    ).fetchAsync();
    await MyBoard.updateAsync(
      { _id: entry._id },
      { $set: { pinOrder: last ? last.pinOrder + 1 : 0 } },
    );
    return { pinned: true };
  },

  /** Unpin one of the caller's board entries. It stays on the board. */
  async 'myBoard.unpin'({ ref } = {}) {
    const { userId } = await requireIdentity(this);
    const { sourceId, ticketId } = validateRef(ref);
    await MyBoard.updateAsync({ userId, sourceId, ticketId }, { $unset: { pinOrder: '' } });
    return { pinned: false };
  },

  /**
   * Make `refs` the caller's pins, in this order: what one drag on My Board
   * does, whether it reorders the pins, pins a ticket or unpins one. Every
   * other board entry is unpinned. A ref no longer on the board is skipped.
   */
  async 'myBoard.setPins'({ refs } = {}) {
    const { userId } = await requireIdentity(this);
    // Empty is a real answer: the last pin dragged out of Pinned.
    validateRefs(refs, { allowEmpty: true });
    const keys = refs.map((r) => refKey(r.sourceId, r.ticketId));
    if (new Set(keys).size !== keys.length) {
      throw new Meteor.Error('bad-request', 'Each ticket can be pinned once.');
    }
    const entries = await MyBoard.find(
      { userId },
      { fields: { sourceId: 1, ticketId: 1, pinOrder: 1 } },
    ).fetchAsync();
    const order = new Map(keys.map((key, index) => [key, index]));
    const writes = entries.flatMap(({ sourceId, ticketId, pinOrder }) => {
      const wanted = order.get(refKey(sourceId, ticketId));
      if (wanted === pinOrder) return [];
      const filter = { userId, sourceId, ticketId };
      const update = wanted === undefined ? { $unset: { pinOrder: '' } } : { $set: { pinOrder: wanted } };
      return [{ updateOne: { filter, update } }];
    });
    if (writes.length) await MyBoard.rawCollection().bulkWrite(writes);
    return { pinned: entries.filter((e) => order.has(refKey(e.sourceId, e.ticketId))).length };
  },
});
