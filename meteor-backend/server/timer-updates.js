/**
 * Automatic Huddle updates for ticket timers: a one-line post on the person's
 * behalf when their timer starts, switches, stops or resumes (#681).
 *
 * An update is an ordinary Huddle post, written straight to `huddlePosts` so
 * the feed's publication carries it live like any other. It is deliberately
 * not tied to the clock session (`clockEventId`): a session's plan is its
 * first post, and an update must never be taken for one.
 *
 * Posting is best-effort everywhere. Nothing here throws: a timer starts or
 * stops whether or not its update could be written.
 */
import { MongoInternals } from 'meteor/mongo';
import { rawDb, isValidId } from './collections';
import { normalizeSource } from './ticket-refs';
import { timerUpdateText } from './timer-updates-core';

const { ObjectId } = MongoInternals.NpmModules.mongodb.module;

const hex = (id) => (typeof id === 'string' ? id : id?.toHexString?.());

/**
 * Whether the person is on the team now. A work item outlives membership, and
 * someone who has left a team must not go on posting to its Huddle. A team's
 * id is a string or, for older teams, an ObjectId.
 */
async function isOnTeam(teamId, userId) {
  const ids = isValidId(teamId) ? [teamId, new ObjectId(teamId)] : [teamId];
  const team = await rawDb()
    .collection('teams')
    .findOne(
      { _id: { $in: ids }, $or: [{ members: userId }, { admins: userId }] },
      { projection: { _id: 1 } },
    );
  return team !== null;
}

/**
 * Where an update goes and how it names its ticket. A Huddle ticket's update
 * goes to the ticket's team. A Redmine issue has no team, so its update goes
 * to the team of the shift the session runs inside.
 */
async function audienceFor(session, workItem) {
  const source = normalizeSource(workItem.source);
  const ticket = { source, ticketId: workItem.ticketId, title: null };

  if (source === 'huddle') {
    if (!isValidId(workItem.ticketId)) return null;
    const row = await rawDb()
      .collection('tickets')
      .findOne({ _id: new ObjectId(workItem.ticketId) }, { projection: { teamId: 1, title: 1 } });
    if (!row?.teamId) return null;
    return { teamId: String(row.teamId), ticket: { ...ticket, title: row.title } };
  }

  if (!isValidId(session.clockEventId)) return null;
  const shift = await rawDb()
    .collection('clockevents')
    .findOne({ _id: new ObjectId(session.clockEventId) }, { projection: { teamId: 1 } });
  if (!shift?.teamId) return null;
  return { teamId: String(shift.teamId), ticket };
}

/**
 * Post an update for a timer session. An update that opens a session (started,
 * switched, resumed) is remembered on it, so it can be discarded if the stint
 * turns out to be a slip (`discardTimerUpdate`).
 *
 * @param {string} action one of `TimerUpdate`
 * @param {{ _id: unknown, userId: string, workItemId: string, clockEventId?: string | null }} session
 * @param {{ remember?: boolean, at?: number }} [options] `at` is when it
 *   happened (epoch ms), for an update that must read before something else
 *   stamped at the same moment; the default is now.
 * @returns {Promise<{ postId: string, teamId: string } | null>} null when nothing was posted
 */
export async function postTimerUpdate(action, session, { remember = false, at } = {}) {
  try {
    if (!session || !isValidId(session.workItemId)) return null;
    const workItem = await rawDb()
      .collection('workitems')
      .findOne({ _id: new ObjectId(session.workItemId) });
    if (!workItem) return null;
    const audience = await audienceFor(session, workItem);
    if (!audience || !(await isOnTeam(audience.teamId, session.userId))) return null;

    const now = at === undefined ? new Date() : new Date(at);
    const post = {
      _id: new ObjectId(),
      teamId: audience.teamId,
      userId: session.userId,
      content: { text: timerUpdateText(action, audience.ticket), mentions: [] },
      attachments: [],
      likes: [],
      commentCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    await rawDb().collection('huddlePosts').insertOne(post);

    const postId = post._id.toHexString();
    if (remember) {
      await rawDb()
        .collection('timers')
        .updateOne({ _id: new ObjectId(hex(session._id)) }, { $set: { huddlePostId: postId } });
    }
    return { postId, teamId: audience.teamId };
  } catch (err) {
    console.error('[timer-updates] could not post the update:', err);
    return null;
  }
}

/**
 * Remove the update a session opened with, when its owner chose to discard it,
 * along with any replies to it (as `huddle.deletePost` does).
 */
export async function discardTimerUpdate(userId, session) {
  try {
    if (!isValidId(session?.huddlePostId)) return;
    const removed = await rawDb()
      .collection('huddlePosts')
      .deleteOne({ _id: new ObjectId(session.huddlePostId), userId });
    if (removed.deletedCount) {
      await rawDb().collection('huddleComments').deleteMany({ postId: session.huddlePostId });
    }
  } catch (err) {
    console.error('[timer-updates] could not discard the update:', err);
  }
}
