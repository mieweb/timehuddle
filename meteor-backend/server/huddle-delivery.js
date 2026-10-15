/**
 * Who hears about a Huddle post, and when (#596). An immediate post notifies on
 * create; a scheduled one notifies when its Agenda job delivers it. Kept apart
 * from huddle.js so agenda.js can deliver without importing the methods.
 */
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
