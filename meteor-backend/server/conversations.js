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
import { ObjectId } from 'mongodb';

import { requireIdentity } from './auth-bridge';
import { rawDb } from './collections';
import {
  canSee,
  checkStartDateKey,
  cleanLabel,
  DATE_KEY_RE,
  directKey,
  displayLabel,
  isOpen,
  isTeamMember,
  legacyDateKeyFor,
  utcDateKey,
} from './conversations-core';

const DUPLICATE_KEY = 11000;
const isDuplicateKey = (err) => err?.code === DUPLICATE_KEY;

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
  const key = { teamId: String(teamId), kind: 'workday', legacy: true, dateKey };
  // A legacy day that became today's open workday (openWorkday) is left alone:
  // the upsert then collides with it and the catch below returns it.
  const filter = { ...key, open: { $ne: true } };
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
    // Two servers upserted the same day at once, or the day is open: use the row that's there.
    if (!isDuplicateKey(err)) throw err;
    const row = await conversationsCollection().findOne(key, { projection: { _id: 1 } });
    return row._id.toHexString();
  }
}

// ─── Workdays (#866 M2) ────────────────────────────────────────────────────

/** The team's open workday, or null. */
export function findOpenWorkday(teamId) {
  return conversationsCollection().findOne({ teamId: String(teamId), open: true });
}

/**
 * Open a workday for `teamId` dated `dateKey`, the one way a workday ever
 * opens (startWorkday, and a post that finds none open). If one is already
 * open — another request got there first (#866 R1, R3) — that one is returned
 * instead; this never fails on the race.
 *
 * A legacy day for the same date (made by the backfill from today's posts
 * before the first huddle start) is reopened rather than duplicated, so the
 * inbox never shows two threads for one day.
 *
 * @param {string} teamId
 * @param {string} dateKey  YYYY-MM-DD, the starter's (or poster's) local date
 * @param {string | null} startedBy  null when a post opened it
 */
export async function openWorkday(teamId, dateKey, startedBy) {
  const conversations = conversationsCollection();
  const now = new Date();
  const opened = { open: true, closedAt: null, startedAt: now, startedBy };
  try {
    const reopened = await conversations.findOneAndUpdate(
      { teamId: String(teamId), kind: 'workday', legacy: true, dateKey, open: { $ne: true } },
      { $set: opened },
      { returnDocument: 'after' },
    );
    if (reopened) return reopened;
    const row = {
      _id: new ObjectId(),
      teamId: String(teamId),
      kind: 'workday',
      dateKey,
      ...opened,
      createdBy: startedBy,
      createdAt: now,
    };
    await conversations.insertOne(row);
    return row;
  } catch (err) {
    if (!isDuplicateKey(err)) throw err;
    const winner = await findOpenWorkday(teamId);
    if (winner) return winner;
    throw err;
  }
}

/** Close `workday` if it is still open. Does nothing if someone else already did (#866 R1). */
async function closeWorkday(workday, now = new Date()) {
  await conversationsCollection().updateOne(
    { _id: workday._id, open: true },
    { $set: { closedAt: now }, $unset: { open: '' } },
  );
}

/**
 * Start the team's huddle: close the open workday and open one for `dateKey`.
 * Starting again on the same day returns the open workday unchanged.
 */
export async function startWorkday(userId, team, dateKey) {
  const teamId = String(team._id);
  const current = await findOpenWorkday(teamId);
  const error = checkStartDateKey(dateKey, current?.dateKey ?? null, new Date());
  if (error) throw new Meteor.Error('bad-request', error);
  if (current?.dateKey === dateKey) return current;
  if (current) await closeWorkday(current);
  const workday = await openWorkday(teamId, dateKey, userId);
  if (workday.startedBy === null) {
    // A post opened this one in the moment between our close and open (#866 R2):
    // it is the new workday, so it takes the starter's date and name.
    const startedAt = new Date();
    await conversationsCollection().updateOne(
      { _id: workday._id, startedBy: null },
      { $set: { startedBy: userId, startedAt, dateKey } },
    );
    return { ...workday, startedBy: userId, startedAt, dateKey };
  }
  return workday;
}

/**
 * The conversation a new post joins, checked (#866 M2).
 *
 * - `conversationId` given: it must be on this team, visible to the author,
 *   and open. A closed workday is refused with `conversation-closed` when
 *   `onClosed` is `'refuse'` (the composer, which keeps the draft and says
 *   why); otherwise the post goes to the open workday instead (#866 R7:
 *   server-side callers have no draft to give back).
 * - Not given: the team's open workday, opening one dated `postDate` if none is.
 *
 * @returns {Promise<object>} the conversation row
 */
export async function resolvePostConversation(
  userId,
  team,
  { conversationId, postDate, onClosed = 'redirect', at = new Date() } = {},
) {
  const teamId = String(team._id);
  if (conversationId !== undefined && conversationId !== null) {
    if (typeof conversationId !== 'string' || !/^[a-f0-9]{24}$/i.test(conversationId)) {
      throw new Meteor.Error('bad-request', 'Invalid conversationId');
    }
    const conversation = await conversationsCollection().findOne({ _id: new ObjectId(conversationId) });
    if (!conversation || !canSee(conversation, userId, team)) {
      throw new Meteor.Error('forbidden', 'You cannot post to that conversation');
    }
    if (isOpen(conversation)) return conversation;
    if (onClosed === 'refuse') {
      const open = await findOpenWorkday(teamId);
      throw new Meteor.Error(
        'conversation-closed',
        'That workday closed when the next huddle started',
        { openConversationId: open ? open._id.toHexString() : null },
      );
    }
  }
  return currentWorkday(teamId, { postDate, at });
}

/**
 * The team's open workday, opening one dated `postDate` (the poster's local
 * date; the UTC date when a server-side caller has none) if none is open.
 */
export async function currentWorkday(teamId, { postDate, at = new Date() } = {}) {
  const open = await findOpenWorkday(teamId);
  if (open) return open;
  const dateKey = typeof postDate === 'string' && DATE_KEY_RE.test(postDate) ? postDate : utcDateKey(at);
  return openWorkday(teamId, dateKey, null);
}

/** The team, if `userId` is on it; throws otherwise. */
async function requireTeam(userId, teamId) {
  if (!teamId || typeof teamId !== 'string') throw new Meteor.Error('bad-request', 'teamId is required');
  const team = await findTeam(teamId);
  if (!team) throw new Meteor.Error('not-found', 'Team not found');
  if (!isTeamMember(team, userId)) throw new Meteor.Error('forbidden', 'Not a team member');
  return team;
}

/**
 * A conversation row as the API returns it. `displayLabel` is the name this
 * viewer sees (null for a workday: the client formats its `dateKey`).
 */
export function toConversationShape(row, { displayLabel: shown = null, myLabel = null } = {}) {
  return {
    id: row._id.toHexString(),
    teamId: row.teamId,
    kind: row.kind,
    displayLabel: shown,
    myLabel,
    ...(row.kind === 'workday'
      ? {
          dateKey: row.dateKey,
          startedAt: row.startedAt ? row.startedAt.toISOString() : null,
          startedBy: row.startedBy ?? null,
          closedAt: row.closedAt ? row.closedAt.toISOString() : null,
        }
      : { label: row.label ?? null, memberIds: row.memberIds ?? [], createdBy: row.createdBy ?? null }),
  };
}

// ─── Team and direct conversations, names (#866 M3) ────────────────────────

/** Names (profile.name) for `userIds`, by id. */
async function userNames(userIds) {
  if (userIds.length === 0) return new Map();
  const users = await rawDb()
    .collection('users')
    .find({ _id: { $in: userIds } }, { projection: { 'profile.name': 1 } })
    .toArray();
  return new Map(users.map((u) => [String(u._id), u.profile?.name ?? null]));
}

/** Rows shaped for `userId`: their personal names and the names they see. Two queries, never one per row. */
async function shapeFor(userId, rows) {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r._id.toHexString());
  const labels = await conversationLabelsCollection()
    .find({ userId, conversationId: { $in: ids } }, { projection: { conversationId: 1, label: 1 } })
    .toArray();
  const mine = new Map(labels.map((l) => [l.conversationId, l.label]));
  const others = [
    ...new Set(rows.filter((r) => r.kind === 'direct').flatMap((r) => r.memberIds ?? [])),
  ].filter((id) => id !== userId);
  const names = await userNames(others);
  return rows.map((row) => {
    const myLabel = mine.get(row._id.toHexString()) ?? null;
    return toConversationShape(row, {
      myLabel,
      displayLabel: displayLabel(row, userId, { personalLabel: myLabel, nameOf: (id) => names.get(id) ?? null }),
    });
  });
}

/** The conversations `userId` can see on `team`: its workdays, and the team and direct conversations they are in. */
export async function listConversations(userId, team) {
  const rows = await conversationsCollection()
    .find({ teamId: String(team._id), $or: [{ kind: 'workday' }, { memberIds: userId }] })
    .sort({ createdAt: -1 })
    .toArray();
  return shapeFor(userId, rows);
}

/** Load a conversation `userId` can see, with its team; throws not-found otherwise (never reveals it exists). */
async function requireVisibleConversation(userId, conversationId) {
  if (typeof conversationId !== 'string' || !/^[a-f0-9]{24}$/i.test(conversationId)) {
    throw new Meteor.Error('bad-request', 'Invalid conversationId');
  }
  const row = await conversationsCollection().findOne({ _id: new ObjectId(conversationId) });
  const team = row ? await findTeam(row.teamId) : null;
  if (!row || !canSee(row, userId, team)) throw new Meteor.Error('not-found', 'Conversation not found');
  return { row, team };
}

/**
 * Create a team conversation (`group`, named, with members) or a direct one
 * (`direct`, one other person). A direct conversation that already exists is
 * returned instead — insert first and read the winner on a duplicate key,
 * never look up then insert (#866 R17).
 */
export async function createConversation(userId, team, { kind, label, memberIds } = {}) {
  if (kind !== 'group' && kind !== 'direct') {
    throw new Meteor.Error('bad-request', 'kind must be group or direct');
  }
  if (!Array.isArray(memberIds) || memberIds.some((id) => typeof id !== 'string' || !id)) {
    throw new Meteor.Error('bad-request', 'memberIds must be a list of user ids');
  }
  const others = [...new Set(memberIds)].filter((id) => id !== userId);
  if (others.some((id) => !isTeamMember(team, id))) {
    throw new Meteor.Error('bad-request', 'Everyone in a conversation must be on the team');
  }
  const now = new Date();
  const base = { teamId: String(team._id), kind, createdBy: userId, createdAt: now };
  if (kind === 'direct') {
    if (others.length !== 1) throw new Meteor.Error('bad-request', 'A direct conversation is with exactly one other person');
    const row = {
      _id: new ObjectId(),
      ...base,
      label: null,
      memberIds: [userId, others[0]],
      directKey: directKey(userId, others[0]),
    };
    try {
      await conversationsCollection().insertOne(row);
      return row;
    } catch (err) {
      if (!isDuplicateKey(err)) throw err;
      return conversationsCollection().findOne({ kind: 'direct', directKey: row.directKey });
    }
  }
  const { label: name, error } = cleanLabel(label);
  if (error) throw new Meteor.Error('bad-request', error);
  if (!name) throw new Meteor.Error('bad-request', 'A team conversation needs a name');
  if (others.length === 0) throw new Meteor.Error('bad-request', 'Add at least one other team member');
  const row = { _id: new ObjectId(), ...base, label: name, memberIds: [userId, ...others] };
  await conversationsCollection().insertOne(row);
  return row;
}

/** Change a team conversation's shared name, once. Its creator and team admins only; the last rename wins (#866 R20). */
export async function renameConversation(userId, conversationId, label) {
  const { row, team } = await requireVisibleConversation(userId, conversationId);
  if (row.kind !== 'group') {
    throw new Meteor.Error('bad-request', 'Only a team conversation has a shared name; set your own name instead');
  }
  if (row.createdBy !== userId && !(team.admins ?? []).includes(userId)) {
    throw new Meteor.Error('forbidden', 'Only its creator or a team admin can rename it for everyone');
  }
  const { label: name, error } = cleanLabel(label);
  if (error) throw new Meteor.Error('bad-request', error);
  if (!name) throw new Meteor.Error('bad-request', 'A team conversation needs a name');
  await conversationsCollection().updateOne({ _id: row._id }, { $set: { label: name } });
  return { ...row, label: name };
}

/**
 * Set (or with an empty name, clear) the name only `userId` sees. A name the
 * same as the one they would see anyway is cleared too. Two saves colliding
 * on the unique index retry once (#866 R19).
 */
export async function setMyLabel(userId, conversationId, label) {
  const { row } = await requireVisibleConversation(userId, conversationId);
  const { label: name, error } = cleanLabel(label);
  if (error) throw new Meteor.Error('bad-request', error);
  const key = { userId, conversationId: row._id.toHexString() };
  const other = row.kind === 'direct' ? (row.memberIds ?? []).find((id) => id !== userId) : null;
  const names = other ? await userNames([other]) : new Map();
  const shownAnyway = displayLabel(row, userId, { nameOf: (id) => names.get(id) ?? null });
  if (!name || name === shownAnyway) {
    await conversationLabelsCollection().deleteOne(key);
    return row;
  }
  const save = () =>
    conversationLabelsCollection().updateOne(
      key,
      { $set: { label: name, updatedAt: new Date() } },
      { upsert: true },
    );
  try {
    await save();
  } catch (err) {
    if (!isDuplicateKey(err)) throw err;
    await save();
  }
  return row;
}

/** The team row by id, either id form. */
function findTeam(teamId) {
  const id = String(teamId);
  return rawDb()
    .collection('teams')
    .findOne({ _id: /^[a-f0-9]{24}$/i.test(id) ? { $in: [id, new ObjectId(id)] } : id });
}

Meteor.methods({
  /** Start the team's huddle (#866): close the open workday and open today's. */
  async 'huddle.startWorkday'({ teamId, dateKey } = {}) {
    const identity = await requireIdentity(this);
    const team = await requireTeam(identity.userId, teamId);
    const [shaped] = await shapeFor(identity.userId, [await startWorkday(identity.userId, team, dateKey)]);
    return shaped;
  },

  /** The conversations the caller can see on a team, each with the name they see. */
  async 'huddle.conversations.list'({ teamId } = {}) {
    const identity = await requireIdentity(this);
    const team = await requireTeam(identity.userId, teamId);
    return { conversations: await listConversations(identity.userId, team) };
  },

  /** Create a team (`group`) or direct conversation. */
  async 'huddle.conversations.create'({ teamId, kind, label, memberIds } = {}) {
    const identity = await requireIdentity(this);
    const team = await requireTeam(identity.userId, teamId);
    const row = await createConversation(identity.userId, team, { kind, label, memberIds });
    const [shaped] = await shapeFor(identity.userId, [row]);
    return shaped;
  },

  /** Rename a team conversation for everyone. */
  async 'huddle.conversations.rename'({ conversationId, label } = {}) {
    const identity = await requireIdentity(this);
    const [shaped] = await shapeFor(identity.userId, [
      await renameConversation(identity.userId, conversationId, label),
    ]);
    return shaped;
  },

  /** Set or clear the caller's own name for a conversation. */
  async 'huddle.conversations.setMyLabel'({ conversationId, label } = {}) {
    const identity = await requireIdentity(this);
    const [shaped] = await shapeFor(identity.userId, [await setMyLabel(identity.userId, conversationId, label)]);
    return shaped;
  },
});

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
