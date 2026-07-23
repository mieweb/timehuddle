/**
 * superChatFeed — map huddle posts onto the SuperChat conversation model.
 *
 * One participant per post author, one message per post (newest-first is
 * handled by SuperChat's order="desc"). Image attachments are embedded as
 * markdown images (rendered by createImagePlugin with a lightbox); other
 * attachments become plain links. Comments deliberately stay in the classic
 * card view — SuperChat has no per-message thread concept.
 */
import type { HuddlePost } from '@lib/api';
import type {
  Participant,
  SuperChatConversation,
  SuperChatMessage,
} from '@mieweb/ui/components/SuperChat';

function attachmentMarkdown(att: HuddlePost['attachments'][number]): string {
  const name = att.filename ?? 'attachment';
  if (att.type === 'image') return `![${name}](${att.url})`;
  return `[📎 ${name}](${att.url})`;
}

/** Message text = post markdown + ticket tag + attachment embeds/links. */
export function postToMessageText(post: HuddlePost): string {
  const parts = [post.content.text];
  if (post.ticketTitle) {
    parts.push(`\`🎫 ${post.ticketTitle}\``);
  }
  if (post.attachments.length > 0) {
    parts.push(post.attachments.map(attachmentMarkdown).join('\n\n'));
  }
  return parts.filter(Boolean).join('\n\n');
}

export function postsToConversation(
  teamId: string,
  teamName: string,
  posts: HuddlePost[],
): SuperChatConversation {
  const participants = new Map<string, Participant>();
  for (const post of posts) {
    if (!participants.has(post.userId)) {
      participants.set(post.userId, {
        id: post.userId,
        kind: 'human',
        name: post.userName || post.userInitials || 'Unknown',
      });
    }
  }

  const thread: SuperChatMessage[] = posts.map((post) => ({
    id: post.id,
    participantId: post.userId,
    text: postToMessageText(post),
    time: post.createdAt,
    editedAt: post.updatedAt !== post.createdAt ? post.updatedAt : undefined,
  }));

  return {
    id: teamId,
    title: teamName,
    participants: [...participants.values()],
    thread,
  };
}
