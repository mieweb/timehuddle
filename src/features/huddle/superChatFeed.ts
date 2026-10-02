/**
 * superChatFeed — map huddle posts onto SuperChatInbox conversations, grouped
 * by session, day, person, or ticket (`postsToConversations`). Image
 * attachments are embedded as markdown images (rendered by createImagePlugin
 * with a lightbox), Pulse videos as `pulse_video` GenUI cards (see
 * pulseVideoBlock.ts); other attachments become plain links. Comments have no
 * surface here — SuperChat has no per-message thread concept (see
 * .attic/huddle-superchat-inbox/README.md).
 */
import { resolveMediaUrl } from '@lib/api';
import type { HuddlePost } from '@lib/api';
import { avatarColorToCss, getUserColor } from './avatar';
import { formatDuration } from '@lib/timeUtils';
import { pulseVideoMarkdown } from './pulseVideoBlock';
import type {
  Participant,
  SuperChatConversation,
  SuperChatMessage,
} from '@mieweb/ui/components/SuperChat';

function attachmentMarkdown(att: HuddlePost['attachments'][number]): string {
  const name = att.filename ?? 'attachment';
  // A Pulse video becomes the `pulse_video` card (poster + play); anything that
  // isn't a PulseVault artifact falls through to a plain link.
  if (att.type === 'video') {
    const card = pulseVideoMarkdown(att.url, att.filename);
    if (card) return card;
  }
  // Posts store attachment URLs by path — bind them to the current backend
  // origin.
  const url = resolveMediaUrl(att.url);
  if (att.type === 'image') return `![${name}](${url})`;
  return `[📎 ${name}](${url})`;
}

/** The `/uploads/…` path of a media URL, however it was stored. */
function mediaPathOf(url: string): string {
  try {
    return new URL(url, 'http://placeholder.invalid').pathname;
  } catch {
    return url;
  }
}

/** Attachments not already embedded in the post's text (pasted/dropped images
 *  are written inline and still recorded as attachments). */
function attachmentsNotInlined(post: HuddlePost): HuddlePost['attachments'] {
  const text = post.content.text;
  if (!text) return post.attachments;
  return post.attachments.filter((att) => !text.includes(mediaPathOf(att.url)));
}

// ─── SuperChatInbox grouping (postsToConversations) ────────────────────────

export type ThreadBy = 'session' | 'day' | 'person' | 'ticket';

export interface InboxViewer {
  userId: string;
  isAdmin: boolean;
}

const SYSTEM_PARTICIPANT_ID = 'system';
const OFF_THE_CLOCK = 'Off the clock';

/** "YYYY-MM-DD" for the given epoch ms, based on the local calendar date. */
function localDateKey(epochMs: number): string {
  const d = new Date(epochMs);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/** A post's plan/wrap-up calendar date, falling back to its created date. */
function getPostDateKey(post: HuddlePost): string {
  return post.postDate ?? localDateKey(new Date(post.createdAt).getTime());
}

/** "08:58" — local wall-clock time, matching the rest of the app's clock UI. */
function formatClockTime(epochMs: number): string {
  const d = new Date(epochMs);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** "Tue, Sep 29" for a "YYYY-MM-DD" key, parsed as a local calendar date. */
function formatDayLabel(dateKey: string): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function groupKeyFor(post: HuddlePost, threadBy: ThreadBy): string {
  switch (threadBy) {
    case 'session':
      return post.clockEventId ?? `nosession:${post.userId}:${getPostDateKey(post)}`;
    case 'day':
      return getPostDateKey(post);
    case 'person':
      return post.userId;
    case 'ticket':
      return post.ticketId ?? 'none';
  }
}

interface SessionInfo {
  clockEventId: string;
  startTime: number;
  endTime: number | null;
}

/** Every distinct clock session referenced by a group's posts, oldest first. */
function collectSessions(posts: HuddlePost[]): SessionInfo[] {
  const byId = new Map<string, SessionInfo>();
  for (const post of posts) {
    if (post.clockEventId && post.session && !byId.has(post.clockEventId)) {
      byId.set(post.clockEventId, {
        clockEventId: post.clockEventId,
        startTime: post.session.startTime,
        endTime: post.session.endTime,
      });
    }
  }
  return [...byId.values()].sort((a, b) => a.startTime - b.startTime);
}

function systemMessagesForSession(session: SessionInfo): SuperChatMessage[] {
  const messages: SuperChatMessage[] = [
    {
      id: `${session.clockEventId}:clock-in`,
      type: 'system',
      participantId: SYSTEM_PARTICIPANT_ID,
      text: `Clocked in at ${formatClockTime(session.startTime)}`,
      time: new Date(session.startTime),
    },
  ];
  if (session.endTime != null) {
    messages.push({
      id: `${session.clockEventId}:clock-out`,
      type: 'system',
      participantId: SYSTEM_PARTICIPANT_ID,
      text: `Clocked out at ${formatClockTime(session.endTime)}`,
      time: new Date(session.endTime),
    });
  }
  return messages;
}

/**
 * Each session's plan/wrap-up post: the one with the wrap-up, else the earliest
 * (same pick as the backend's SESSION_POST_SORT). Any other post in a session
 * is a reply sent from the inbox.
 */
function sessionPostIds(posts: HuddlePost[]): Set<string> {
  const bySession = new Map<string, HuddlePost>();
  for (const post of posts) {
    if (!post.clockEventId) continue;
    const current = bySession.get(post.clockEventId);
    const better =
      !current ||
      (!!post.wrapUpAt !== !!current.wrapUpAt
        ? !!post.wrapUpAt
        : new Date(post.createdAt).getTime() < new Date(current.createdAt).getTime());
    if (better) bySession.set(post.clockEventId, post);
  }
  return new Set([...bySession.values()].map((p) => p.id));
}

/** Plan/wrap-up + ticket label for a post, e.g. "Plan · 🎫 Onboarding checklist". */
function postLabelParts(post: HuddlePost, isSessionPost: boolean, teamName?: string): string[] {
  const parts: string[] = [];
  if (isSessionPost) {
    parts.push(post.wrapUpAt ? 'Wrap-up' : 'Plan');
  }
  if (post.ticketTitle) {
    parts.push(`🎫 ${post.ticketTitle}`);
  }
  if (teamName) {
    parts.push(teamName);
  }
  return parts;
}

/** Message text for the inbox: body first (the sidebar preview shows the
 *  first line), then attachments, then an italic plan/ticket label. */
function postToInboxMessageText(
  post: HuddlePost,
  isSessionPost: boolean,
  teamName?: string,
): string {
  const parts = [post.content.text];
  const attachments = attachmentsNotInlined(post);
  if (attachments.length > 0) {
    parts.push(attachments.map(attachmentMarkdown).join('\n\n'));
  }
  const label = postLabelParts(post, isSessionPost, teamName);
  if (label.length > 0) {
    parts.push(`*${label.join(' · ')}*`);
  }
  return parts.filter(Boolean).join('\n\n');
}

/**
 * SuperChat's inline edit starts from the message text as shown, so an edit
 * comes back with the attachment markdown and label appended above. Strip
 * those back off (`shownText` is what the inbox displayed, `body` the post's
 * stored text) so they're never saved into the post and re-appended. Each
 * decoration is removed wherever it now sits (last occurrence), not only as a
 * trailing suffix — text typed after the label must not drag it along.
 */
export function stripInboxDecorations(editedText: string, shownText: string, body: string): string {
  if (!shownText.startsWith(body)) return editedText;
  let text = editedText;
  const decorations = shownText.slice(body.length).split('\n\n').filter(Boolean);
  for (const part of decorations) {
    const at = text.lastIndexOf(part);
    if (at === -1) continue;
    const before = text.slice(0, at).replace(/[ \t]+$/, '');
    const after = text.slice(at + part.length).replace(/^[ \t]+/, '');
    text = /\S$/.test(before) && /^\S/.test(after) ? `${before}\n\n${after}` : before + after;
  }
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

function displayName(post: HuddlePost, viewer: InboxViewer): string {
  return post.userId === viewer.userId ? 'You' : post.userName || post.userInitials || 'Unknown';
}

function buildTitle(
  threadBy: ThreadBy,
  posts: HuddlePost[],
  sessions: SessionInfo[],
  viewer: InboxViewer,
  now: number,
  wrappedUpSessions: Set<string>,
): string {
  const first = posts[0];
  switch (threadBy) {
    case 'day':
      return formatDayLabel(getPostDateKey(first));
    case 'person':
      return displayName(first, viewer);
    case 'ticket':
      return first.ticketId ? (first.ticketTitle ?? 'Ticket') : 'No ticket';
    case 'session': {
      const dateLabel = formatDayLabel(getPostDateKey(first));
      const name = displayName(first, viewer);
      if (!first.clockEventId) return `${name} · ${dateLabel} · ${OFF_THE_CLOCK}`;
      const session = sessions[0];
      if (!session) return `${name} · ${dateLabel}`;

      const isLive = session.endTime == null;
      const span = `${formatClockTime(session.startTime)}\u2013${isLive ? 'now' : formatClockTime(session.endTime as number)}`;
      let title = `${name} · ${dateLabel} · ${span}`;
      if (isLive) title += ' · \u25CF Live';
      if (viewer.isAdmin) {
        const endTime = session.endTime ?? now;
        title += ` · ${formatDuration((endTime - session.startTime) / 1000)}`;
        if (!isLive && !wrappedUpSessions.has(session.clockEventId)) {
          title += ' · \u26A0 no wrap-up';
        }
      }
      return title;
    }
  }
}

/**
 * Group huddle posts (+ their clock sessions) into SuperChatInbox
 * conversations. Pure: no React, no API calls, no `Date.now()` — pass `now`
 * explicitly so callers (and tests) get a stable "live" duration/label.
 *
 * `getTeamName` is only needed for the Personal ("me") scope, where posts
 * from several teams can land in one conversation and each message's label
 * needs to say which team it came from.
 *
 * `sessionContext` is the unfiltered post list when `posts` is a search
 * result: which post is a session's plan, and whether it has a wrap-up, are
 * facts about the whole session, not about what the search happened to match.
 */
export function postsToConversations(
  posts: HuddlePost[],
  threadBy: ThreadBy,
  viewer: InboxViewer,
  now: number = Date.now(),
  getTeamName?: (teamId: string) => string | undefined,
  sessionContext: HuddlePost[] = posts,
): SuperChatConversation[] {
  const groups = new Map<string, HuddlePost[]>();
  const planPostIds = sessionPostIds(sessionContext);
  const wrappedUpSessions = new Set(
    sessionContext.flatMap((p) => (p.clockEventId && p.wrapUpAt ? [p.clockEventId] : [])),
  );
  for (const post of posts) {
    const key = groupKeyFor(post, threadBy);
    const bucket = groups.get(key);
    if (bucket) bucket.push(post);
    else groups.set(key, [post]);
  }

  const conversations: SuperChatConversation[] = [];
  for (const [key, groupPosts] of groups) {
    const sessions = threadBy === 'ticket' ? [] : collectSessions(groupPosts);

    const participants = new Map<string, Participant>();
    for (const post of groupPosts) {
      if (!participants.has(post.userId)) {
        participants.set(post.userId, {
          id: post.userId,
          kind: 'human',
          name: post.userName || post.userInitials || 'Unknown',
          color: avatarColorToCss(getUserColor(post.userId)),
        });
      }
    }

    const systemMessages = sessions.flatMap(systemMessagesForSession);
    // Session view: a thread of posts made without clocking in says so up
    // front, rather than looking like a shift with its clock lines missing.
    const offTheClockThread = threadBy === 'session' && !groupPosts[0].clockEventId;
    if (offTheClockThread) {
      const earliest = Math.min(...groupPosts.map((p) => new Date(p.createdAt).getTime()));
      systemMessages.push({
        id: `${key}:off-the-clock`,
        type: 'system',
        participantId: SYSTEM_PARTICIPANT_ID,
        text: 'Posted without clocking in',
        time: new Date(earliest - 1),
      });
    }
    if (systemMessages.length > 0) {
      participants.set(SYSTEM_PARTICIPANT_ID, {
        id: SYSTEM_PARTICIPANT_ID,
        kind: 'system',
        name: 'Clock',
      });
    }

    const postMessages: SuperChatMessage[] = groupPosts.map((post) => ({
      id: post.id,
      participantId: post.userId,
      text: postToInboxMessageText(post, planPostIds.has(post.id), getTeamName?.(post.teamId)),
      time: post.createdAt,
      editedAt: post.updatedAt !== post.createdAt ? post.updatedAt : undefined,
    }));

    const thread = [...systemMessages, ...postMessages].sort(
      (a, b) => new Date(a.time).getTime() - new Date(b.time).getTime(),
    );

    const isLive = sessions.some((s) => s.endTime == null);
    const lastActivity = isLive
      ? new Date(now)
      : new Date(Math.max(...thread.map((m) => new Date(m.time).getTime())));

    conversations.push({
      id: `${threadBy}:${key}`,
      title: buildTitle(threadBy, groupPosts, sessions, viewer, now, wrappedUpSessions),
      participants: [...participants.values()],
      thread,
      lastActivity,
    });
  }

  return conversations;
}

/** Lower-cased, accent-free form used on both sides of a search match. */
function normalizeForSearch(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
}

/** Everything a post can be found by: body, author, ticket, attachments, team
 *  and its date in several spellings ("2026-09-24", "Thu, Sep 24", "September"). */
/**
 * Text as a reader sees it: no markdown link targets and no GenUI card
 * payloads (one line or pretty-printed), so media URLs, widget names and
 * artifact ids don't match every query.
 */
function searchableText(text: string): string {
  return text.replace(/\]\([^)]*\)/g, ']').replace(/```genui[\s\S]*?```/g, '');
}

function postSearchText(post: HuddlePost, teamName?: string): string {
  const dateKey = getPostDateKey(post);
  const [year, month, day] = dateKey.split('-').map(Number);
  const longDate = new Date(year, month - 1, day).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  return [
    searchableText(post.content.text),
    post.userName,
    post.ticketTitle,
    post.wrapUpAt ? 'wrap-up wrapup' : undefined,
    post.clockEventId ? undefined : OFF_THE_CLOCK,
    post.session && post.session.endTime == null ? 'live' : undefined,
    ...post.attachments.flatMap((att) => [att.filename, att.type]),
    teamName,
    dateKey,
    formatDayLabel(dateKey),
    longDate,
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Filter inbox conversations by a free-text query. Every word must appear
 * somewhere in the conversation — its title, participants, message text
 * (including clock-in/out lines and plan/wrap-up labels) or the fields of any
 * post in it — so "priya wrap-up sep 24" narrows across all of them. A match
 * keeps the whole conversation, so the hit is seen in context.
 */
export function searchConversations(
  conversations: SuperChatConversation[],
  posts: HuddlePost[],
  query: string,
  getTeamName?: (teamId: string) => string | undefined,
): SuperChatConversation[] {
  const words = normalizeForSearch(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return conversations;

  const postsById = new Map(posts.map((post) => [post.id, post]));
  return conversations.filter((conversation) => {
    const haystack = normalizeForSearch(
      [
        conversation.title,
        ...conversation.participants.map((p) => p.name),
        ...conversation.thread.map((message) => {
          const shown = searchableText(message.text ?? '');
          const post = postsById.get(message.id);
          return post ? `${shown}\n${postSearchText(post, getTeamName?.(post.teamId))}` : shown;
        }),
      ].join('\n'),
    );
    return words.every((word) => haystack.includes(word));
  });
}
