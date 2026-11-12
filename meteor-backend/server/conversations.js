/**
 * Huddle conversation topics (#866) — storage. The rules live in
 * conversations-core.js; this file owns the two collections, their indexes,
 * and the backfill that gives every existing post a conversation.
 *
 *   huddleConversations       one row per conversation (workday, group, direct)
 *   huddleConversationLabels  one row per person per conversation they renamed
 *
 * Posts point at a conversation with `huddlePosts.conversationId` (a hex id).
 */
import { Meteor } from 'meteor/meteor';

import { rawDb } from './collections';
import { legacyDateKeyFor } from './conversations-core';

const DUPLICATE_KEY = 11000;

export const conversationsCollection = () => rawDb().collection('huddleConversations');
export const conversationLabelsCollection = () => rawDb().collection('huddleConversationLabels');

/**
 * Create the indexes. Runs before the backfill, so the unique legacy index
 * already guards it when two servers start at once (#866 R14).
 */
export async function ensureConversationIndexes() {
  const conversations = conversationsCollection();
  await conversations.createIndex({ teamId: 1, kind: 1, closedAt: 1 });
  // One direct conversation per pair.
  await conversations.createIndex(
    { directKey: 1 },
    { unique: true, partialFilterExpression: { kind: 'direct' } },
  );
  // One open workday per team. `open: true` is set while a workday is open and
  // removed when it closes: a partial index can rely on that, not on `closedAt: null`.
  await conversations.createIndex(
    { teamId: 1 },
    { unique: true, partialFilterExpression: { open: true }, name: 'one_open_workday_per_team' },
  );
  // One legacy workday per team and date, so the backfill is idempotent.
  await conversations.createIndex(
    { teamId: 1, dateKey: 1 },
    { unique: true, partialFilterExpression: { legacy: true }, name: 'one_legacy_workday_per_day' },
  );
  await conversationLabelsCollection().createIndex({ userId: 1, conversationId: 1 }, { unique: true });
}

/**
 * The id (hex) of the legacy workday for `teamId` on `dateKey`, made on first
 * use. Legacy workdays stand in for the Day threads posts had before #866: no
 * stand-up time is known, so `startedAt` stays null and the day counts as
 * closed at its latest post (`lastAt`).
 */
export async function legacyWorkdayFor(teamId, dateKey, lastAt = new Date()) {
  const filter = { teamId: String(teamId), kind: 'workday', legacy: true, dateKey };
  const update = {
    $setOnInsert: { startedAt: null, startedBy: null, createdBy: null, createdAt: new Date() },
    $max: { closedAt: lastAt },
  };
  try {
    const row = await conversationsCollection().findOneAndUpdate(filter, update, {
      upsert: true,
      returnDocument: 'after',
      projection: { _id: 1 },
    });
    return row._id.toHexString();
  } catch (err) {
    // Two servers upserted the same day at once: the other one's row won.
    if (err?.code !== DUPLICATE_KEY) throw err;
    const row = await conversationsCollection().findOne(filter, { projection: { _id: 1 } });
    return row._id.toHexString();
  }
}

/**
 * The conversation a new post joins. Until workdays can be started (#866 M2)
 * that is the legacy workday for the post's date, the same day thread it
 * would have been in before.
 */
export async function conversationForNewPost(teamId, { postDate, at = new Date() } = {}) {
  return legacyWorkdayFor(teamId, legacyDateKeyFor({ postDate, createdAt: at }), at);
}

/** Posts the backfill fills in: no conversation yet, and already visible (a scheduled post gets one at delivery). */
const POSTS_WITHOUT_CONVERSATION = {
  conversationId: { $exists: false },
  $or: [{ deliverAt: null }, { deliveredAt: { $ne: null } }],
};

/**
 * Give every post without a conversation one: grouped by team and day, each
 * group pointed at that day's legacy workday. Only ever fills in a missing
 * `conversationId` (#866 R15), so it is safe to run on every start and on two
 * servers at once.
 */
export async function backfillPostConversations() {
  const posts = rawDb().collection('huddlePosts');
  const cursor = posts.find(POSTS_WITHOUT_CONVERSATION, {
    projection: { teamId: 1, postDate: 1, createdAt: 1, deliveredAt: 1 },
  });
  /** `${teamId}|${dateKey}` → { teamId, dateKey, ids, lastAt } */
  const groups = new Map();
  for await (const post of cursor) {
    const teamId = String(post.teamId);
    const dateKey = legacyDateKeyFor(post);
    const key = `${teamId}|${dateKey}`;
    const group = groups.get(key) ?? { teamId, dateKey, ids: [], lastAt: post.createdAt };
    group.ids.push(post._id);
    if (post.createdAt > group.lastAt) group.lastAt = post.createdAt;
    groups.set(key, group);
  }
  let updated = 0;
  for (const { teamId, dateKey, ids, lastAt } of groups.values()) {
    const conversationId = await legacyWorkdayFor(teamId, dateKey, lastAt);
    const { modifiedCount } = await posts.updateMany(
      { _id: { $in: ids }, conversationId: { $exists: false } },
      { $set: { conversationId } },
    );
    updated += modifiedCount;
  }
  return { updated, workdays: groups.size };
}

Meteor.startup(async () => {
  try {
    await ensureConversationIndexes();
  } catch (error) {
    console.error('[conversations] failed to create indexes:', error);
    return; // the backfill relies on the unique index; try again on the next start
  }
  try {
    const { updated, workdays } = await backfillPostConversations();
    if (updated) console.log(`[conversations] gave ${updated} posts a conversation across ${workdays} days`);
  } catch (error) {
    console.error('[conversations] backfill failed:', error);
  }
});
