/**
 * Who hears about a Huddle post, and when (#596). An immediate post notifies on
 * create; a scheduled one notifies when its Agenda job delivers it. Kept apart
 * from huddle.js so agenda.js can deliver without importing the methods.
 */
import { ObjectId } from 'mongodb';
import { rawDb } from './collections';
import { createNotification, userDisplayName } from './notify-core';
import { isAwaitingDelivery } from './huddle-schedule-core';

/** In-app link to a post, in the URL scheme of src/ui/ROUTING.md. */
export function huddlePostUrl(teamId, postId) {
  return `/app/huddle?team=${encodeURIComponent(teamId)}&post=${encodeURIComponent(postId)}`;
}

/** Title/body for a post's mention notification, computed once and reused per recipient. */
async function mentionNotificationText(post) {
  return {
    title: `${await userDisplayName(post.userId)} mentioned you in Huddle`,
    body: (post.content?.text ?? '').substring(0, 100),
  };
}

/** Send one recipient's mention notification; true on success, logs and returns false on failure. */
async function sendMentionNotification(userId, post, { title, body }) {
  const postId = String(post._id);
  const teamId = String(post.teamId);
  try {
    await createNotification({
      userId,
      title,
      body,
      data: { type: 'huddle-mention', postId, teamId, url: huddlePostUrl(teamId, postId) },
    });
    return true;
  } catch (err) {
    console.error('[huddle] mention notification failed:', err);
    return false;
  }
}

/** Ids of everyone still on `team` (members and admins), as strings. */
function teamMemberIds(team) {
  return new Set([...(team.members ?? []), ...(team.admins ?? [])].map(String));
}

/**
 * Send `post`'s mention notification to each of `recipientIds`. Returns the
 * ids it couldn't reach, so the caller can retry them later rather than lose
 * them silently.
 */
async function sendMentionNotifications(post, recipientIds) {
  if (!recipientIds.length) return [];
  let text;
  try {
    text = await mentionNotificationText(post);
  } catch (err) {
    // Shared lookup (author display name) failed before any send was attempted —
    // treat everyone as failed so the retry job still gets a chance to reach them.
    console.error('[huddle] mention notification text failed:', err);
    return recipientIds;
  }
  const results = await Promise.all(
    recipientIds.map(async (userId) => ({
      userId,
      ok: await sendMentionNotification(userId, post, text),
    })),
  );
  return results.filter((r) => !r.ok).map((r) => r.userId);
}

/**
 * Notify the users @mentioned in `post` — never its author, and only those
 * still on `team`, so a mention can't leak the text outside the team. Returns
 * the ids of any recipients whose notification failed.
 */
export async function notifyPostRecipients(post, team) {
  const onTeam = teamMemberIds(team);
  const recipients = [...new Set(post.content?.mentions ?? [])].filter(
    (userId) => userId !== post.userId && onTeam.has(String(userId)),
  );
  return sendMentionNotifications(post, recipients);
}

/**
 * Retry a post's mention notifications for exactly `recipientIds`, used by
 * the `huddle-mention-retry` Agenda job. Deduplicates against the
 * `notifications` collection, so a recipient a previous attempt already
 * reached is never notified twice, and drops anyone no longer on the team.
 * Returns the ids still unreached, for the job to retry again (or give up on).
 */
export async function retryMentionNotifications(postId, recipientIds) {
  if (!recipientIds?.length) return [];
  const post = await rawDb()
    .collection('huddlePosts')
    .findOne({ _id: new ObjectId(postId) }, { projection: { userId: 1, teamId: 1, content: 1 } });
  if (!post) return []; // the post is gone — nothing left to notify about
  const team = await findPostTeam(post.teamId);
  if (!team) return [];

  const onTeam = teamMemberIds(team);
  const candidates = [...new Set(recipientIds)].filter((userId) => onTeam.has(String(userId)));
  if (!candidates.length) return [];

  const already = await rawDb()
    .collection('notifications')
    .find(
      { userId: { $in: candidates }, 'data.type': 'huddle-mention', 'data.postId': postId },
      { projection: { userId: 1 } },
    )
    .toArray();
  const notified = new Set(already.map((n) => String(n.userId)));
  return sendMentionNotifications(
    post,
    candidates.filter((userId) => !notified.has(String(userId))),
  );
}

/** A post's team, whichever form (string or legacy ObjectId) its id is stored in. */
async function findPostTeam(teamId) {
  const id = String(teamId);
  const ids = /^[a-f0-9]{24}$/i.test(id) ? [id, new ObjectId(id)] : [id];
  return rawDb().collection('teams').findOne({ _id: { $in: ids } });
}

/** Whether `userId` is still a member or admin of `team`. */
function isTeamMember(team, userId) {
  return (team.members ?? []).includes(userId) || (team.admins ?? []).includes(userId);
}

/**
 * Deliver a scheduled post: stamp `deliveredAt` (which reveals a hidden post
 * through the feed's change stream) and notify. Atomic, so a job firing twice
 * or racing "Send now" notifies once. False when there was nothing to deliver.
 * `updatedAt` is left alone: delivery isn't an edit.
 *
 * The Agenda job calls this without `force`, so a run that was already
 * dequeued when a reschedule moved `deliverAt` later finds the new time not
 * yet due and does nothing — see `isPostStillAwaitingDelivery` for why that
 * run must not then remove the job row. `huddle.sendScheduledNow` passes
 * `force: true` to ignore `deliverAt` and send regardless of the clock.
 *
 * Checks the author's own team access before ever revealing the post —
 * `teams.removeMember`/`orgs.blockMember` don't cancel a departed member's
 * pending schedules, so without this a removed author's post would still
 * surface and notify the team they no longer belong to. A post that fails
 * the check was never shown to anyone, so it's dropped rather than left
 * stranded with no way to ever be delivered or managed.
 *
 * Returns `{ delivered, failedRecipientIds }`: `failedRecipientIds` is only
 * meaningful when `delivered` is true, and lists anyone `notifyPostRecipients`
 * couldn't reach — the caller schedules a `huddle-mention-retry` job for
 * those, since the post is visible either way once delivered.
 */
export async function deliverScheduledPost(postId, { force = false } = {}) {
  if (typeof postId !== 'string' || !/^[a-f0-9]{24}$/i.test(postId)) return { delivered: false };
  const pending = await rawDb()
    .collection('huddlePosts')
    .findOne(
      {
        _id: new ObjectId(postId),
        deliveredAt: null,
        deliverAt: force ? { $exists: true } : { $lte: new Date() },
      },
      { projection: { userId: 1, teamId: 1 } },
    );
  if (!pending) return { delivered: false };
  const team = await findPostTeam(pending.teamId);
  if (!team || !isTeamMember(team, pending.userId)) {
    // Never shown to anyone — drop it rather than leave it stranded with no
    // way to ever be delivered or managed.
    await rawDb().collection('huddlePosts').deleteOne({ _id: pending._id, deliveredAt: null });
    return { delivered: false };
  }
  const post = await rawDb()
    .collection('huddlePosts')
    .findOneAndUpdate(
      {
        _id: pending._id,
        deliveredAt: null,
        // Re-check the deadline here too: a reschedule committed while
        // findPostTeam() above was in flight must not still be revealed early.
        deliverAt: force ? { $exists: true } : { $lte: new Date() },
      },
      { $set: { deliveredAt: new Date() }, $inc: { scheduleVersion: 1 } },
      { returnDocument: 'after' },
    );
  if (!post) return { delivered: false }; // raced with something else (send now, delete, reschedule) between the checks above
  const failedRecipientIds = await notifyPostRecipients(post, team);
  return { delivered: true, failedRecipientIds };
}

/**
 * Whether `postId` still has a delivery pending. `schedulePostDelivery` upserts
 * one job row per post (keyed by postId), so a reschedule updates that same
 * row rather than replacing it; a run already dequeued under the row's old
 * time sees `deliverScheduledPost` decline (not due yet) and must check this
 * before deciding whether to remove the row — the reschedule already pointed
 * it at the new time, and removing it regardless would strand the post with
 * no job to ever deliver it.
 */
export async function isPostStillAwaitingDelivery(postId) {
  if (typeof postId !== 'string' || !/^[a-f0-9]{24}$/i.test(postId)) return false;
  const post = await rawDb()
    .collection('huddlePosts')
    .findOne({ _id: new ObjectId(postId) }, { projection: { deliverAt: 1, deliveredAt: 1 } });
  return !!post && isAwaitingDelivery(post);
}
