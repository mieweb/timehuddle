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
import { optionalRedmineBaseUrl } from './redmine-client';
import { hostOf, ticketIdsForTeams } from './ticket-ids';
import { huddleTicketLabel, redmineIssueLabel } from './ticket-label';
import { normalizeSource } from './ticket-refs';
import { PlanUpdate, planUpdateText, timerUpdateText } from './timer-updates-core';

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
 * Where an update goes, and how it names its ticket given the team's ticket
 * IDs. A Huddle ticket's update goes to the ticket's team. A Redmine issue has
 * no team, so its update goes to the team of the shift the session runs inside.
 */
async function audienceFor(session, workItem) {
  if (normalizeSource(workItem.source) === 'huddle') {
    if (!isValidId(workItem.ticketId)) return null;
    const row = await rawDb()
      .collection('tickets')
      .findOne(
        { _id: new ObjectId(workItem.ticketId) },
        { projection: { teamId: 1, title: 1, number: 1, github: 1, linkIsIssue: 1, linkedIssue: 1 } },
      );
    if (!row?.teamId) return null;
    return {
      teamId: String(row.teamId),
      label: (ids, redmineHost) => huddleTicketLabel(row, ids, redmineHost),
    };
  }

  if (!isValidId(session.clockEventId)) return null;
  const shift = await rawDb()
    .collection('clockevents')
    .findOne({ _id: new ObjectId(session.clockEventId) }, { projection: { teamId: 1 } });
  if (!shift?.teamId) return null;
  return {
    teamId: String(shift.teamId),
    label: (ids, redmineHost) => redmineIssueLabel(workItem.ticketId, ids.sourcePrefixes, redmineHost),
  };
}

/**
 * Write an update post: an ordinary Huddle post on the person's behalf, which
 * the feed's publication carries live like any other.
 * @returns {Promise<string>} the post's id
 */
export async function insertUpdatePost({ teamId, userId, text, at }) {
  const now = at === undefined ? new Date() : new Date(at);
  const post = {
    _id: new ObjectId(),
    teamId,
    userId,
    content: { text, mentions: [] },
    attachments: [],
    likes: [],
    commentCount: 0,
    createdAt: now,
    updatedAt: now,
  };
  await rawDb().collection('huddlePosts').insertOne(post);
  return post._id.toHexString();
}

/**
 * How a team names its tickets in an update, by id: `Map<ticketId, label>`
 * (ticket-label.js). A ticket gone from the team is left out.
 */
export async function teamTicketLabels(teamId, ticketIds) {
  const ids = ticketIds.filter(isValidId);
  if (!ids.length) return new Map();
  const team = String(teamId);
  const [rows, naming] = await Promise.all([
    rawDb()
      .collection('tickets')
      .find(
        {
          _id: { $in: ids.map((id) => new ObjectId(id)) },
          // A team's id is a string or, for older teams, an ObjectId.
          teamId: { $in: isValidId(team) ? [team, new ObjectId(team)] : [team] },
        },
        { projection: { title: 1, number: 1, github: 1, linkIsIssue: 1, linkedIssue: 1 } },
      )
      .toArray(),
    ticketIdsForTeams(rawDb(), [team]),
  ]);
  const redmineHost = hostOf(optionalRedmineBaseUrl());
  const teamIds = naming.get(team);
  return new Map(
    rows.map((row) => [row._id.toHexString(), huddleTicketLabel(row, teamIds, redmineHost)]),
  );
}

/**
 * Post an update for a timer session. An update that opens a session (started,
 * switched, resumed) is remembered on it, so it can be discarded if the stint
 * turns out to be a slip (`discardTimerUpdate`).
 *
 * @param {string} action one of `TimerUpdate`
 * @param {{ _id: unknown, userId: string, workItemId: string, clockEventId?: string | null }} session
 * @param {{ remember?: boolean, at?: number, checkedOff?: CheckedOff | null }} [options]
 *   `at` is when it happened (epoch ms), for an update that must read before
 *   something else stamped at the same moment; the default is now.
 *   `checkedOff` is a ticket this switch checked off today's plan (M4). When
 *   the plan is that team's, this update stands for it (`namedCheckOff`): the
 *   checked-off ticket's own update shows its time, stopped.
 * @returns {Promise<{ postId: string, teamId: string, namedCheckOff: boolean } | null>}
 *   null when nothing was posted
 */
export async function postTimerUpdate(action, session, { remember = false, at, checkedOff = null } = {}) {
  try {
    if (!session || !isValidId(session.workItemId)) return null;
    const workItem = await rawDb()
      .collection('workitems')
      .findOne({ _id: new ObjectId(session.workItemId) });
    if (!workItem) return null;
    const audience = await audienceFor(session, workItem);
    if (!audience || !(await isOnTeam(audience.teamId, session.userId))) return null;
    const ids = (await ticketIdsForTeams(rawDb(), [audience.teamId])).get(audience.teamId);
    const label = audience.label(ids, hostOf(optionalRedmineBaseUrl()));
    // The plan's check-off this switch made, when the plan is this team's.
    const standsForCheckOff = !!checkedOff && checkedOff.teamId === audience.teamId;

    const postId = await insertUpdatePost({
      teamId: audience.teamId,
      userId: session.userId,
      text: timerUpdateText(action, label),
      at,
    });
    if (remember) {
      await rawDb()
        .collection('timers')
        .updateOne(
          { _id: new ObjectId(hex(session._id)) },
          // A check-off it names is posted on its own if the update is discarded.
          { $set: { huddlePostId: postId, ...(standsForCheckOff ? { huddleCheckedOff: checkedOff } : {}) } },
        );
    }
    return { postId, teamId: audience.teamId, namedCheckOff: standsForCheckOff };
  } catch (err) {
    console.error('[timer-updates] could not post the update:', err);
    return null;
  }
}

/**
 * @typedef {{ teamId: string, ticketId: string, seconds: number }} CheckedOff
 * a ticket a switch checked off today's plan, on the plan's team
 */

/**
 * A check-off as its own update on the plan's team, for when no switch update
 * there names it: the switch went to another team's ticket, posted nothing, or
 * was discarded.
 * @param {string} userId
 * @param {CheckedOff | null | undefined} checkedOff
 */
export async function postCheckedOff(userId, checkedOff) {
  try {
    if (!checkedOff || !(await isOnTeam(checkedOff.teamId, userId))) return;
    const label = (await teamTicketLabels(checkedOff.teamId, [checkedOff.ticketId])).get(
      checkedOff.ticketId,
    );
    if (!label) return;
    await insertUpdatePost({
      teamId: checkedOff.teamId,
      userId,
      text: planUpdateText(PlanUpdate.CHECKED, { label }, checkedOff.seconds),
    });
  } catch (err) {
    console.error('[timer-updates] could not post the check-off:', err);
  }
}

/**
 * Remove the update a session opened with, when its owner chose to discard it,
 * along with any replies to it (as `huddle.deletePost` does). A check-off it
 * named still happened, so it stays in Huddle as its own update.
 */
export async function discardTimerUpdate(userId, session) {
  try {
    if (!isValidId(session?.huddlePostId)) return;
    const removed = await rawDb()
      .collection('huddlePosts')
      .deleteOne({ _id: new ObjectId(session.huddlePostId), userId });
    if (removed.deletedCount) {
      await rawDb().collection('huddleComments').deleteMany({ postId: session.huddlePostId });
      await postCheckedOff(userId, session.huddleCheckedOff);
    }
  } catch (err) {
    console.error('[timer-updates] could not discard the update:', err);
  }
}
