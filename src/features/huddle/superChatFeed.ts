/**
 * superChatFeed — map huddle posts onto SuperChatInbox conversations, grouped
 * by session, day, person, or ticket (`postsToConversations`). Image
 * attachments are embedded as markdown images (rendered by createImagePlugin
 * with a lightbox); other attachments become plain links. Comments have no
 * surface here — SuperChat has no per-message thread concept (see
 * .attic/huddle-superchat-inbox/README.md).
 */
import { resolveMediaUrl } from '@lib/api';
import type { HuddlePost } from '@lib/api';
import { avatarColorToCss, getUserColor } from './avatar';
import { formatDuration } from '@lib/timeUtils';
import type {
  Participant,
  SuperChatConversation,
  SuperChatMessage,
} from '@mieweb/ui/components/SuperChat';

function attachmentMarkdown(att: HuddlePost['attachments'][number]): string {
  const name = att.filename ?? 'attachment';
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

export const SYSTEM_PARTICIPANT_ID = 'system';
const OFF_THE_CLOCK = 'Off the clock';

/** User-facing thread line text, kept in one place for translation. */
const THREAD_TEXT = {
  you: 'You',
  unknown: 'Unknown',
  clockedIn: (who: string, when: string) => `${who} clocked in · ${when}`,
  clockedOut: (who: string, when: string) => `${who} clocked out · ${when}`,
  stillClockedIn: (who: string, isViewer: boolean, since: string) =>
    `${who} ${isViewer ? 'are' : 'is'} still clocked in · since ${since}`,
  postedWithoutClockingIn: 'Posted without clocking in',
  scheduledHidden: '🔒 Only you can see this until it is sent',
} as const;

/** A scheduled post whose time hasn't come (and wasn't sent early). */
export function isAwaitingDelivery(post: HuddlePost): boolean {
  return !!post.deliverAt && !post.deliveredAt;
}

/** When a post sits in its thread: a scheduled one when it is sent, others when written. */
function postAt(post: HuddlePost): string {
  if (!post.deliverAt) return post.createdAt;
  return post.deliveredAt ?? post.deliverAt;
}

const postTime = (post: HuddlePost) => new Date(postAt(post)).getTime();

/** "YYYY-MM-DD" for the given epoch ms, based on the local calendar date. */
function localDateKey(epochMs: number): string {
  const d = new Date(epochMs);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * A post's plan/wrap-up calendar date, falling back to its created date. A
 * delivered scheduled post groups by the date it actually appeared instead of
 * the `postDate` stamped for its original schedule — otherwise sending one
 * early (Send now) leaves it in tomorrow's Day/Session conversation with
 * today's time inside it.
 */
function getPostDateKey(post: HuddlePost): string {
  if (post.deliverAt && post.deliveredAt) return localDateKey(new Date(post.deliveredAt).getTime());
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

/** Titles of a post's tickets that still exist. */
function ticketTitles(post: HuddlePost): string[] {
  return (post.tickets ?? []).flatMap((t) => (t.title ? [t.title] : []));
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
      // A post threads under its first ticket; its label still names them all.
      return post.tickets?.[0]?.id ?? 'none';
  }
}

interface SessionInfo {
  clockEventId: string;
  userId: string;
  userName: string;
  startTime: number;
  endTime: number | null;
  /** Earliest post in the session — a plan posted just before the clock started. */
  firstPostAt: number;
}

/** Every distinct clock session referenced by a group's posts, oldest first. */
function collectSessions(posts: HuddlePost[]): SessionInfo[] {
  const byId = new Map<string, SessionInfo>();
  for (const post of posts) {
    if (!post.clockEventId || !post.session) continue;
    const createdAt = new Date(post.createdAt).getTime();
    const existing = byId.get(post.clockEventId);
    if (existing) {
      existing.firstPostAt = Math.min(existing.firstPostAt, createdAt);
      continue;
    }
    byId.set(post.clockEventId, {
      clockEventId: post.clockEventId,
      userId: post.userId,
      userName: authorName(post),
      startTime: post.session.startTime,
      endTime: post.session.endTime,
      firstPostAt: createdAt,
    });
  }
  return [...byId.values()].sort((a, b) => a.startTime - b.startTime);
}

interface ClockLineContext {
  viewer: InboxViewer;
  /** Person threads span several days, so each line names its day. */
  includeDay: boolean;
  /** When the "still clocked in" line sorts: now, but never above a post already in the thread. */
  liveAt: number;
}

function clockLineWhen(epochMs: number, includeDay: boolean): string {
  const time = formatClockTime(epochMs);
  return includeDay ? `${formatDayLabel(localDateKey(epochMs))} · ${time}` : time;
}

function clockLine(id: string, text: string, epochMs: number): SuperChatMessage {
  return {
    id,
    type: 'system',
    participantId: SYSTEM_PARTICIPANT_ID,
    text,
    time: new Date(epochMs),
  };
}

function systemMessagesForSession(
  session: SessionInfo,
  { viewer, includeDay, liveAt }: ClockLineContext,
): SuperChatMessage[] {
  const isViewer = session.userId === viewer.userId;
  const who = isViewer ? THREAD_TEXT.you : session.userName;
  const { clockEventId, startTime, endTime } = session;
  const messages = [
    clockLine(
      `${clockEventId}:clock-in`,
      THREAD_TEXT.clockedIn(who, clockLineWhen(startTime, includeDay)),
      // Above the plan posted just before the clock started (SuperChat orders by time).
      Math.min(startTime, session.firstPostAt),
    ),
  ];
  if (endTime == null) {
    messages.push(
      clockLine(
        `${clockEventId}:still-in`,
        THREAD_TEXT.stillClockedIn(who, isViewer, clockLineWhen(startTime, includeDay)),
        liveAt,
      ),
    );
    return messages;
  }
  let outText = THREAD_TEXT.clockedOut(who, clockLineWhen(endTime, includeDay));
  // Shift length stays admin-only, matching the session title.
  if (viewer.isAdmin) outText += ` · ${formatDuration((endTime - startTime) / 1000)}`;
  messages.push(clockLine(`${clockEventId}:clock-out`, outText, endTime));
  return messages;
}

const isClockIn = (m: SuperChatMessage) => m.id.endsWith(':clock-in');

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
  // SuperChat draws the scheduled time (`scheduledFor`); this says who can see it.
  if (isAwaitingDelivery(post)) {
    parts.push(THREAD_TEXT.scheduledHidden);
  }
  if (isSessionPost) {
    parts.push(post.wrapUpAt ? 'Wrap-up' : 'Plan');
  }
  for (const title of ticketTitles(post)) {
    parts.push(`🎫 ${title}`);
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

function authorName(post: HuddlePost): string {
  return post.userName || post.userInitials || THREAD_TEXT.unknown;
}

function displayName(post: HuddlePost, viewer: InboxViewer): string {
  return post.userId === viewer.userId ? THREAD_TEXT.you : authorName(post);
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
      return first.tickets?.length ? (first.tickets[0].title ?? 'Ticket') : 'No ticket';
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
          name: authorName(post),
          color: avatarColorToCss(getUserColor(post.userId)),
        });
      }
    }

    const lineContext: ClockLineContext = {
      viewer,
      includeDay: threadBy === 'person',
      liveAt: Math.max(now, ...groupPosts.map((p) => postTime(p) + 1)),
    };
    const systemMessages = sessions.flatMap((s) => systemMessagesForSession(s, lineContext));
    // Session view: a thread of posts made without clocking in says so up
    // front, rather than looking like a shift with its clock lines missing.
    const offTheClockThread = threadBy === 'session' && !groupPosts[0].clockEventId;
    if (offTheClockThread) {
      const earliest = Math.min(...groupPosts.map(postTime));
      systemMessages.push({
        id: `${key}:off-the-clock`,
        type: 'system',
        participantId: SYSTEM_PARTICIPANT_ID,
        text: THREAD_TEXT.postedWithoutClockingIn,
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
      time: postAt(post),
      editedAt: post.updatedAt !== post.createdAt ? post.updatedAt : undefined,
      ...(isAwaitingDelivery(post) && { scheduledFor: post.deliverAt }),
    }));

    // On a tie the clock-in goes first, above the plan it shares a moment with;
    // SuperChat's own sort by time is stable, so it keeps this order.
    const thread = [...systemMessages, ...postMessages].sort(
      (a, b) =>
        new Date(a.time).getTime() - new Date(b.time).getTime() ||
        Number(isClockIn(b)) - Number(isClockIn(a)),
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
    post.content.text,
    post.userName,
    ...ticketTitles(post),
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

/** Id of the {@link starterConversation}; it never matches a real post. */
export const STARTER_CONVERSATION_ID = 'starter';

/** A post-less conversation holding one system hint, so the chat input has somewhere to live. */
function emptyConversation(
  id: string,
  title: string,
  viewer: { userId: string; name: string },
  hint: string,
  now: number,
): SuperChatConversation {
  return {
    id,
    title,
    participants: [
      {
        id: viewer.userId,
        kind: 'human',
        name: viewer.name,
        color: avatarColorToCss(getUserColor(viewer.userId)),
      },
    ],
    thread: [
      {
        id: `${id}:hint`,
        type: 'system',
        participantId: SYSTEM_PARTICIPANT_ID,
        text: hint,
        time: new Date(now),
      },
    ],
    lastActivity: new Date(now),
  };
}

/**
 * The conversation the inbox shows when there are no posts at all. SuperChat
 * only renders its chat input inside an open conversation, so with zero data
 * the page still needs one for the user to post the first update from. It
 * exists only on screen: the first real post replaces it.
 */
export function starterConversation(
  viewer: { userId: string; name: string },
  scope: 'team' | 'me',
  now: number = Date.now(),
): SuperChatConversation {
  const hint =
    scope === 'me'
      ? "You haven't posted in any team in the last 30 days. Share an update below, or clock in to post your plan."
      : 'No updates yet. Share what you’re working on below, or clock in to post your plan.';
  return emptyConversation(STARTER_CONVERSATION_ID, 'Today', viewer, hint, now);
}

/** Id of the Day thread for the calendar day containing `now`. */
function todayConversationId(now: number): string {
  return `day:${localDateKey(now)}`;
}

/**
 * Day grouping always has a Today thread: with no post yet today, an empty one
 * (same id the first post will land in) is added so Today is both the default
 * and somewhere to post. Other groupings are returned as they are.
 */
export function withTodayConversation(
  conversations: SuperChatConversation[],
  threadBy: ThreadBy,
  viewer: { userId: string; name: string },
  scope: 'team' | 'me',
  now: number = Date.now(),
): SuperChatConversation[] {
  if (threadBy !== 'day' || conversations.length === 0) return conversations;
  const id = todayConversationId(now);
  if (conversations.some((c) => c.id === id)) return conversations;
  const hint =
    scope === 'me'
      ? 'You haven’t posted today. Share an update below, or clock in to post your plan.'
      : 'No updates yet today. Share what you’re working on below, or clock in to post your plan.';
  const title = formatDayLabel(localDateKey(now));
  return [emptyConversation(id, title, viewer, hint, now), ...conversations];
}

/**
 * The conversation to open when the URL doesn't name one: Today in Day
 * grouping, the first (most recent) conversation otherwise.
 */
export function defaultConversation(
  conversations: SuperChatConversation[],
  threadBy: ThreadBy,
  now: number = Date.now(),
): SuperChatConversation | undefined {
  if (threadBy === 'day') {
    const id = todayConversationId(now);
    const today = conversations.find((c) => c.id === id);
    if (today) return today;
  }
  return conversations[0];
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
          // Drop markdown link targets so media URLs don't match every query.
          const shown = (message.text ?? '').replace(/\]\([^)]*\)/g, ']');
          const post = postsById.get(message.id);
          return post ? `${shown}\n${postSearchText(post, getTeamName?.(post.teamId))}` : shown;
        }),
      ].join('\n'),
    );
    return words.every((word) => haystack.includes(word));
  });
}
