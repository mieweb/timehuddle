/**
 * Who hears about a Huddle post, and when (#596). An immediate post notifies on
 * create; a scheduled one notifies when its Agenda job delivers it. Kept apart
 * from huddle.js so agenda.js can deliver without importing the methods.
 */
import { ObjectId } from 'mongodb';
import { rawDb } from './collections';
import { createNotification, userDisplayName } from './notify-core';

/** In-app link to a post, in the URL scheme of src/ui/ROUTING.md. */
export function huddlePostUrl(teamId, postId) {
  return `/app/huddle?team=${encodeURIComponent(teamId)}&post=${encodeURIComponent(postId)}`;
}

/**
 * Notify the users @mentioned in `post` — never its author, and only those
 * still on `team`, so a mention can't leak the text outside the team.
 */
export async function notifyPostRecipients(post, team) {
  const onTeam = new Set([...(team.members ?? []), ...(team.admins ?? [])].map(String));
  const recipients = [...new Set(post.content?.mentions ?? [])].filter(
    (userId) => userId !== post.userId && onTeam.has(String(userId)),
  );
  if (!recipients.length) return;

  const postId = String(post._id);
  const teamId = String(post.teamId);
  const title = `${await userDisplayName(post.userId)} mentioned you in Huddle`;
  const body = (post.content?.text ?? '').substring(0, 100);
  await Promise.all(
    recipients.map((userId) =>
      createNotification({
        userId,
        title,
        body,
        data: { type: 'huddle-mention', postId, teamId, url: huddlePostUrl(teamId, postId) },
      }).catch((err) => console.error('[huddle] mention notification failed:', err)),
    ),
  );
}

/** A post's team, whichever form (string or legacy ObjectId) its id is stored in. */
async function findPostTeam(teamId) {
  const id = String(teamId);
  const ids = /^[a-f0-9]{24}$/i.test(id) ? [id, new ObjectId(id)] : [id];
  return rawDb().collection('teams').findOne({ _id: { $in: ids } });
}

/**
 * Deliver a scheduled post: stamp `deliveredAt` (which reveals a hidden post
 * through the feed's change stream) and notify. Atomic, so a job firing twice
 * or racing "Send now" notifies once. False when there was nothing to deliver.
 * `updatedAt` is left alone: delivery isn't an edit.
 *
 * The Agenda job calls this without `force`, so a stale run — its row already
 * cancelled, but the callback itself was already past that point when a
 * reschedule moved `deliverAt` later — still finds the new time not yet due
 * and does nothing. `huddle.sendScheduledNow` passes `force: true` to ignore
 * `deliverAt` and send regardless of the clock.
 */
export async function deliverScheduledPost(postId, { force = false } = {}) {
  if (typeof postId !== 'string' || !/^[a-f0-9]{24}$/i.test(postId)) return false;
  const post = await rawDb()
    .collection('huddlePosts')
    .findOneAndUpdate(
      {
        _id: new ObjectId(postId),
        deliveredAt: null,
        deliverAt: force ? { $exists: true } : { $lte: new Date() },
      },
      { $set: { deliveredAt: new Date() } },
      { returnDocument: 'after' },
    );
  if (!post) return false;
  const team = await findPostTeam(post.teamId);
  if (team) await notifyPostRecipients(post, team);
  return true;
}
