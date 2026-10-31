import { describe, expect, it } from 'vitest';
import type { HuddlePost } from '@lib/api';
import { noteRenamed, noteVideoNames } from '../pulse-upload/videoNames';
import {
  defaultConversation,
  postsToConversations,
  searchConversations,
  starterConversation,
  shownBody,
  stripInboxDecorations,
  withTodayConversation,
} from './superChatFeed';

/** Build an epoch ms from local calendar components, so fixtures and their
 *  expected "HH:MM" / weekday output stay identical regardless of the test
 *  runner's timezone (both are read back via local Date getters). */
function localMs(year: number, month: number, day: number, hour = 0, minute = 0): number {
  return new Date(year, month - 1, day, hour, minute).getTime();
}

const SEP_29_0858 = localMs(2026, 9, 29, 8, 58);
const SEP_29_1032 = localMs(2026, 9, 29, 10, 32);
const SEP_28_0900 = localMs(2026, 9, 28, 9, 0);
const NOW = localMs(2026, 9, 29, 12, 0);

function makePost(overrides: Partial<HuddlePost> & { id: string }): HuddlePost {
  const createdAt = overrides.createdAt ?? new Date(SEP_29_0858).toISOString();
  return {
    teamId: 'team-1',
    userId: 'user-aisha',
    userName: 'Aisha Khan',
    userInitials: 'AK',
    content: { text: 'Checklist UI is done.', mentions: [] },
    attachments: [],
    likes: [],
    commentCount: 0,
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}

const VIEWER_MEMBER = { userId: 'user-aisha', isAdmin: false };
const VIEWER_OTHER_MEMBER = { userId: 'user-priya', isAdmin: false };
const VIEWER_ADMIN = { userId: 'user-priya', isAdmin: true };

describe('postsToConversations', () => {
  describe('grouping', () => {
    it('groups by session via clockEventId', () => {
      const posts = [
        makePost({
          id: 'p1',
          clockEventId: 'evt-1',
          session: { startTime: SEP_29_0858, endTime: SEP_29_1032 },
        }),
        makePost({
          id: 'p2',
          userId: 'user-priya',
          userName: 'Priya Sharma',
          clockEventId: 'evt-2',
          session: { startTime: SEP_28_0900, endTime: null },
        }),
      ];
      const conversations = postsToConversations(posts, 'session', VIEWER_MEMBER, NOW);
      expect(conversations).toHaveLength(2);
      const ids = conversations.map((c) => c.id).sort();
      expect(ids).toEqual(['session:evt-1', 'session:evt-2']);
    });

    it('groups by day using postDate, falling back to the created date', () => {
      const posts = [
        makePost({ id: 'p1', postDate: '2026-09-29' }),
        makePost({
          id: 'p2',
          userId: 'user-priya',
          createdAt: new Date(SEP_29_1032).toISOString(),
        }),
        makePost({ id: 'p3', postDate: '2026-09-28' }),
      ];
      const conversations = postsToConversations(posts, 'day', VIEWER_MEMBER, NOW);
      const byId = new Map(conversations.map((c) => [c.id, c]));
      expect(byId.get('day:2026-09-29')?.thread.filter((m) => m.type !== 'system')).toHaveLength(2);
      expect(byId.get('day:2026-09-28')?.thread).toHaveLength(1);
    });

    it('groups by person via userId', () => {
      const posts = [
        makePost({ id: 'p1', userId: 'user-aisha' }),
        makePost({ id: 'p2', userId: 'user-aisha' }),
        makePost({ id: 'p3', userId: 'user-priya' }),
      ];
      const conversations = postsToConversations(posts, 'person', VIEWER_MEMBER, NOW);
      const ids = conversations.map((c) => c.id).sort();
      expect(ids).toEqual(['person:user-aisha', 'person:user-priya']);
    });

    it('groups by ticket, bucketing posts with no ticket under "none"', () => {
      const posts = [
        makePost({ id: 'p1', tickets: [{ id: 'tkt-1', title: 'Onboarding checklist' }] }),
        makePost({ id: 'p2', tickets: [{ id: 'tkt-1', title: 'Onboarding checklist' }] }),
        makePost({ id: 'p3' }),
      ];
      const conversations = postsToConversations(posts, 'ticket', VIEWER_MEMBER, NOW);
      const byId = new Map(conversations.map((c) => [c.id, c]));
      expect(byId.get('ticket:tkt-1')?.thread).toHaveLength(2);
      expect(byId.get('ticket:none')?.thread).toHaveLength(1);
      expect(byId.get('ticket:none')?.title).toBe('No ticket');
    });
  });

  describe('live sessions', () => {
    it('marks a live session (no endTime) as "● Live" and ends it with a still-clocked-in line', () => {
      const posts = [
        makePost({
          id: 'p1',
          clockEventId: 'evt-1',
          session: { startTime: SEP_29_0858, endTime: null },
        }),
      ];
      const [conversation] = postsToConversations(posts, 'session', VIEWER_MEMBER, NOW);
      expect(conversation.title).toContain('● Live');
      const systemMessages = conversation.thread.filter((m) => m.type === 'system');
      expect(systemMessages.map((m) => m.text)).toEqual([
        'You clocked in · 08:58',
        'You are still clocked in · since 08:58',
      ]);
      expect(conversation.thread.at(-1)?.id).toBe('evt-1:still-in');
      expect(conversation.thread.some((m) => m.id === 'evt-1:clock-out')).toBe(false);
    });

    it('says "is still clocked in" with the name for someone else', () => {
      const posts = [
        makePost({
          id: 'p1',
          clockEventId: 'evt-1',
          session: { startTime: SEP_29_0858, endTime: null },
        }),
      ];
      const [conversation] = postsToConversations(posts, 'session', VIEWER_OTHER_MEMBER, NOW);
      expect(conversation.thread.at(-1)?.text).toBe('Aisha Khan is still clocked in · since 08:58');
    });

    it('keeps the still-clocked-in line last when a post lands after the minute NOW was rounded to', () => {
      const live = { startTime: SEP_29_0858, endTime: null };
      const posts = [
        makePost({ id: 'plan', clockEventId: 'evt-1', session: live }),
        makePost({
          id: 'late-reply',
          clockEventId: 'evt-1',
          session: live,
          createdAt: new Date(NOW + 30_000).toISOString(),
        }),
      ];
      const [conversation] = postsToConversations(posts, 'session', VIEWER_MEMBER, NOW);
      const sorted = [...conversation.thread].sort(
        (a, b) => new Date(a.time).getTime() - new Date(b.time).getTime(),
      );
      expect(sorted.at(-1)?.id).toBe('evt-1:still-in');
    });

    it('drops the still-clocked-in line once the session ends', () => {
      const posts = [
        makePost({
          id: 'p1',
          clockEventId: 'evt-1',
          session: { startTime: SEP_29_0858, endTime: SEP_29_1032 },
        }),
      ];
      const [conversation] = postsToConversations(posts, 'session', VIEWER_MEMBER, NOW);
      expect(conversation.title).not.toContain('Live');
      const systemMessages = conversation.thread.filter((m) => m.type === 'system');
      expect(systemMessages.map((m) => m.text)).toEqual([
        'You clocked in · 08:58',
        'You clocked out · 10:32',
      ]);
    });
  });

  describe('clock lines', () => {
    const closed = { startTime: SEP_29_0858, endTime: SEP_29_1032 };
    const systemTexts = (conversation: { thread: { type?: string; text?: string }[] }) =>
      conversation.thread.filter((m) => m.type === 'system').map((m) => m.text);

    it('names the person, and says "You" for the viewer', () => {
      const posts = [makePost({ id: 'p1', clockEventId: 'evt-1', session: closed })];
      const [asOther] = postsToConversations(posts, 'session', VIEWER_OTHER_MEMBER, NOW);
      expect(systemTexts(asOther)).toEqual([
        'Aisha Khan clocked in · 08:58',
        'Aisha Khan clocked out · 10:32',
      ]);
    });

    it('attributes each line in a Day thread with two people on overlapping shifts', () => {
      const posts = [
        makePost({ id: 'aisha', postDate: '2026-09-29', clockEventId: 'evt-a', session: closed }),
        makePost({
          id: 'ravi',
          userId: 'user-ravi',
          userName: 'Ravi Shah',
          postDate: '2026-09-29',
          createdAt: new Date(localMs(2026, 9, 29, 9, 30)).toISOString(),
          clockEventId: 'evt-r',
          session: { startTime: localMs(2026, 9, 29, 9, 30), endTime: null },
        }),
      ];
      const [conversation] = postsToConversations(posts, 'day', VIEWER_OTHER_MEMBER, NOW);
      expect(systemTexts(conversation)).toEqual([
        'Aisha Khan clocked in · 08:58',
        'Ravi Shah clocked in · 09:30',
        'Aisha Khan clocked out · 10:32',
        'Ravi Shah is still clocked in · since 09:30',
      ]);
    });

    it('shows the shift length on clock-out to admins only', () => {
      const posts = [makePost({ id: 'p1', clockEventId: 'evt-1', session: closed })];
      const [adminView] = postsToConversations(posts, 'session', VIEWER_ADMIN, NOW);
      const [memberView] = postsToConversations(posts, 'session', VIEWER_MEMBER, NOW);
      expect(systemTexts(adminView)).toContain('Aisha Khan clocked out · 10:32 · 1h 34m');
      expect(systemTexts(memberView)).toContain('You clocked out · 10:32');
    });

    it('includes the day in Person threads, not in Session or Day threads', () => {
      const posts = [makePost({ id: 'p1', clockEventId: 'evt-1', session: closed })];
      const [person] = postsToConversations(posts, 'person', VIEWER_MEMBER, NOW);
      expect(systemTexts(person)).toEqual([
        'You clocked in · Tue, Sep 29 · 08:58',
        'You clocked out · Tue, Sep 29 · 10:32',
      ]);
      for (const threadBy of ['session', 'day'] as const) {
        const [conversation] = postsToConversations(posts, threadBy, VIEWER_MEMBER, NOW);
        expect(systemTexts(conversation)[0]).toBe('You clocked in · 08:58');
      }
    });

    it('puts the clock-in above a plan posted just before the clock started', () => {
      const posts = [
        makePost({
          id: 'plan',
          createdAt: new Date(SEP_29_0858 - 20_000).toISOString(),
          clockEventId: 'evt-1',
          session: closed,
        }),
      ];
      for (const threadBy of ['session', 'day', 'person'] as const) {
        const [conversation] = postsToConversations(posts, threadBy, VIEWER_MEMBER, NOW);
        // SuperChat re-sorts the thread by time (stably), so the times must agree.
        const bySuperChat = [...conversation.thread].sort(
          (a, b) => new Date(a.time).getTime() - new Date(b.time).getTime(),
        );
        expect(bySuperChat.map((m) => m.id)).toEqual(['evt-1:clock-in', 'plan', 'evt-1:clock-out']);
      }
    });

    it("keeps another session's post where it was when reordering a clock-in", () => {
      const posts = [
        makePost({
          id: 'other',
          userId: 'user-ravi',
          userName: 'Ravi Shah',
          createdAt: new Date(SEP_29_0858 - 60_000).toISOString(),
        }),
        makePost({
          id: 'plan',
          createdAt: new Date(SEP_29_0858 - 20_000).toISOString(),
          clockEventId: 'evt-1',
          session: closed,
        }),
      ];
      const [conversation] = postsToConversations(posts, 'day', VIEWER_MEMBER, NOW);
      expect(conversation.thread.map((m) => m.id)).toEqual([
        'other',
        'evt-1:clock-in',
        'plan',
        'evt-1:clock-out',
      ]);
    });
  });

  describe('titles', () => {
    it('shows hours (and no-wrap-up warning) for admins, not for members', () => {
      const posts = [
        makePost({
          id: 'p1',
          clockEventId: 'evt-1',
          session: { startTime: SEP_29_0858, endTime: SEP_29_1032 },
        }),
      ];
      const [adminView] = postsToConversations(posts, 'session', VIEWER_ADMIN, NOW);
      const [memberView] = postsToConversations(posts, 'session', VIEWER_MEMBER, NOW);
      expect(adminView.title).toContain('1h 34m');
      expect(adminView.title).toContain('⚠ no wrap-up');
      expect(memberView.title).not.toContain('1h 34m');
      expect(memberView.title).not.toContain('no wrap-up');
    });

    it('omits the no-wrap-up warning once a post in the session has a wrap-up', () => {
      const posts = [
        makePost({
          id: 'p1',
          clockEventId: 'evt-1',
          session: { startTime: SEP_29_0858, endTime: SEP_29_1032 },
          wrapUpAt: new Date(SEP_29_1032).toISOString(),
        }),
      ];
      const [adminView] = postsToConversations(posts, 'session', VIEWER_ADMIN, NOW);
      expect(adminView.title).not.toContain('no wrap-up');
    });

    it('shows "You" for the viewer\'s own session thread', () => {
      const posts = [
        makePost({
          id: 'p1',
          userId: 'user-aisha',
          clockEventId: 'evt-1',
          session: { startTime: SEP_29_0858, endTime: SEP_29_1032 },
        }),
      ];
      const [asAuthor] = postsToConversations(posts, 'session', VIEWER_MEMBER, NOW);
      const [asOther] = postsToConversations(posts, 'session', VIEWER_OTHER_MEMBER, NOW);
      expect(asAuthor.title.startsWith('You')).toBe(true);
      expect(asOther.title.startsWith('Aisha Khan')).toBe(true);
    });
  });

  describe('plan / wrap-up labels', () => {
    const session = { startTime: SEP_29_0858, endTime: null };
    const textOf = (posts: HuddlePost[], id: string) =>
      postsToConversations(posts, 'session', VIEWER_MEMBER, NOW)[0].thread.find((m) => m.id === id)
        ?.text;

    it('labels only the earliest session post as the plan, not later inbox replies', () => {
      const posts = [
        makePost({ id: 'plan', clockEventId: 'evt-1', session }),
        makePost({
          id: 'reply',
          clockEventId: 'evt-1',
          session,
          createdAt: new Date(SEP_29_1032).toISOString(),
        }),
      ];
      expect(textOf(posts, 'plan')).toContain('*Plan*');
      expect(textOf(posts, 'reply')).not.toContain('Plan');
    });

    it('labels the wrap-up post and leaves an earlier reply unlabeled', () => {
      const posts = [
        makePost({ id: 'reply', clockEventId: 'evt-1', session }),
        makePost({
          id: 'wrapup',
          clockEventId: 'evt-1',
          session,
          createdAt: new Date(SEP_29_1032).toISOString(),
          wrapUpAt: new Date(SEP_29_1032).toISOString(),
        }),
      ];
      expect(textOf(posts, 'wrapup')).toContain('*Wrap-up*');
      expect(textOf(posts, 'reply')).not.toMatch(/Plan|Wrap-up/);
    });

    it('keeps labels and the wrap-up warning right when a search hides the plan', () => {
      const closed = { startTime: SEP_29_0858, endTime: SEP_29_1032 };
      const plan = makePost({
        id: 'plan',
        clockEventId: 'evt-1',
        session: closed,
        wrapUpAt: new Date(SEP_29_1032).toISOString(),
      });
      const reply = makePost({
        id: 'reply',
        clockEventId: 'evt-1',
        session: closed,
        createdAt: new Date(SEP_29_1032).toISOString(),
      });
      const [searched] = postsToConversations([reply], 'session', VIEWER_ADMIN, NOW, undefined, [
        plan,
        reply,
      ]);
      expect(searched.thread.find((m) => m.id === 'reply')?.text).not.toMatch(/Plan|Wrap-up/);
      expect(searched.title).not.toContain('no wrap-up');
    });
  });

  describe('stripInboxDecorations', () => {
    const body = 'Checklist UI is done.';
    const shown = `${body}\n\n![shot.png](http://x/uploads/shot.png)\n\n*Plan · Dev Team*`;

    it('removes the attachment markdown and label an edit comes back with', () => {
      const edited = shown.replace(body, 'Checklist UI is done and shipped.');
      expect(stripInboxDecorations(edited, shown, body)).toBe('Checklist UI is done and shipped.');
    });

    it('removes decorations when text is typed after them', () => {
      expect(stripInboxDecorations(`${shown}\n\nAlso deployed.`, shown, body)).toBe(
        `${body}\n\nAlso deployed.`,
      );
      expect(stripInboxDecorations(`${shown} Also deployed.`, shown, body)).toBe(
        `${body}\n\nAlso deployed.`,
      );
    });

    it('leaves text alone when there were no decorations', () => {
      expect(stripInboxDecorations('New text', body, body)).toBe('New text');
    });
  });

  describe('scheduled posts', () => {
    const OCT_1_0900 = localMs(2026, 10, 1, 9, 0);
    const scheduled = (overrides: Partial<HuddlePost> = {}) =>
      makePost({
        id: 'p-sched',
        deliverAt: new Date(OCT_1_0900).toISOString(),
        ...overrides,
      });
    const messageOf = (post: HuddlePost) =>
      postsToConversations([post], 'person', VIEWER_MEMBER, NOW)[0].thread.find(
        (m) => m.id === post.id,
      )!;

    it('places a waiting post at its send time and says only you see it', () => {
      const message = messageOf(scheduled());
      expect(message.scheduledFor).toBe(new Date(OCT_1_0900).toISOString());
      expect(message.text).toContain('Only you can see this until it is sent');
      expect(message.time).toBe(new Date(OCT_1_0900).toISOString());
    });

    it('clears the schedule once delivered, keeping the post where it was sent', () => {
      const deliveredAt = new Date(SEP_29_1032).toISOString();
      const message = messageOf(scheduled({ deliveredAt }));
      expect(message.scheduledFor).toBeUndefined();
      expect(message.text).toBe('Checklist UI is done.');
      expect(message.time).toBe(deliveredAt);
    });

    it('strips the note off an inline edit', () => {
      const post = scheduled();
      const shown = messageOf(post).text!;
      const edited = shown.replace(post.content.text, 'Updated plan.');
      expect(stripInboxDecorations(edited, shown, post.content.text)).toBe('Updated plan.');
    });

    it('groups a post sent early under the day it actually appeared, not its original schedule', () => {
      const post = makePost({
        id: 'p-early',
        postDate: '2026-09-30', // originally scheduled for tomorrow
        deliverAt: new Date(SEP_29_0858).toISOString(),
        deliveredAt: new Date(SEP_29_1032).toISOString(), // sent early, today
      });
      const conversations = postsToConversations([post], 'day', VIEWER_MEMBER, NOW);
      expect(conversations.map((c) => c.id)).toEqual(['day:2026-09-29']);
    });
  });

  describe('posts without a session or ticket', () => {
    it('labels a session-view thread of off-the-clock posts, title and first line', () => {
      const posts = [makePost({ id: 'p1', postDate: '2026-09-29' })];
      const [conversation] = postsToConversations(posts, 'session', VIEWER_MEMBER, NOW);
      expect(conversation.id).toBe('session:nosession:user-aisha:2026-09-29');
      expect(conversation.title).toBe('You · Tue, Sep 29 · Off the clock');
      const system = conversation.thread.filter((m) => m.type === 'system');
      expect(system.map((m) => m.text)).toEqual(['Posted without clocking in']);
      expect(conversation.thread[0].type).toBe('system');
      // The thread says it once; the post itself isn't labelled again.
      expect(conversation.thread[1].text).not.toContain('Off the clock');
    });

    it('keeps the label out of message text in the other views (it would seed inline edit)', () => {
      const posts = [makePost({ id: 'bare' })];
      for (const threadBy of ['day', 'person', 'ticket'] as const) {
        const thread = postsToConversations(posts, threadBy, VIEWER_MEMBER, NOW).flatMap(
          (c) => c.thread,
        );
        expect(thread.find((m) => m.id === 'bare')?.text).not.toContain('Off the clock');
      }
    });
  });

  describe('ticket links', () => {
    const tickets = [
      { id: 'tkt-1', title: 'Onboarding checklist', label: 'TH-1: Onboarding checklist' },
      { id: 'tkt-gone', title: null, label: null },
      { id: 'tkt-2', title: 'Fix [beta] *login*', label: 'TH-2: Fix [beta] *login*' },
    ];

    it('names a ticket by the label the server sends (#788)', () => {
      const carried = { id: 'tkt-3', title: 'Fix login', label: 'RMX-656: Fix login' };
      const [conversation] = postsToConversations(
        [makePost({ id: 'p1', tickets: [carried] })],
        'ticket',
        VIEWER_MEMBER,
        NOW,
      );
      const text = conversation.thread.find((m) => m.id === 'p1')?.text ?? '';
      expect(text).toContain('[RMX-656: Fix login](/app/tickets/tkt-3)');
    });

    it('falls back to the title when the post carries no label', () => {
      const [conversation] = postsToConversations(
        [makePost({ id: 'p1', tickets: [{ id: 'tkt-1', title: 'Onboarding checklist' }] })],
        'day',
        VIEWER_MEMBER,
        NOW,
      );
      expect(conversation.thread[0].text).toContain('[Onboarding checklist](/app/tickets/tkt-1)');
    });

    it('links each existing ticket to its page and skips deleted ones', () => {
      for (const threadBy of ['session', 'day', 'person', 'ticket'] as const) {
        const [conversation] = postsToConversations(
          [makePost({ id: 'p1', tickets })],
          threadBy,
          VIEWER_MEMBER,
          NOW,
        );
        const text = conversation.thread.find((m) => m.id === 'p1')?.text ?? '';
        expect(text).toContain('[TH-1: Onboarding checklist](/app/tickets/tkt-1)');
        expect(text).toContain('[TH-2: Fix \\[beta\\] \\*login\\*](/app/tickets/tkt-2)');
        expect(text).not.toContain('🎫');
        expect(text).not.toContain('tkt-gone');
      }
    });

    it('keeps the rest of the label as plain text', () => {
      const post = makePost({ id: 'p1', clockEventId: 'evt-1', tickets: tickets.slice(0, 1) });
      const [conversation] = postsToConversations(
        [post],
        'session',
        VIEWER_MEMBER,
        NOW,
        () => 'Dev Team',
      );
      const text = conversation.thread.find((m) => m.id === 'p1')?.text;
      expect(text).toBe(
        `${post.content.text}\n\n*Plan · [TH-1: Onboarding checklist](/app/tickets/tkt-1) · Dev Team*`,
      );
    });

    it('never saves the link into the post on an inline edit', () => {
      const post = makePost({ id: 'p1', tickets });
      const [conversation] = postsToConversations([post], 'day', VIEWER_MEMBER, NOW);
      const shown = conversation.thread.find((m) => m.id === 'p1')?.text ?? '';
      const edited = shown.replace(post.content.text, 'Checklist UI is shipped.');
      expect(stripInboxDecorations(edited, shown, post.content.text)).toBe(
        'Checklist UI is shipped.',
      );
    });
  });

  describe('ticket threads', () => {
    it('never include clock in/out messages, even when posts carry session data', () => {
      const posts = [
        makePost({
          id: 'p1',
          tickets: [{ id: 'tkt-1', title: 'Onboarding checklist' }],
          clockEventId: 'evt-1',
          session: { startTime: SEP_29_0858, endTime: SEP_29_1032 },
        }),
      ];
      const [conversation] = postsToConversations(posts, 'ticket', VIEWER_MEMBER, NOW);
      expect(conversation.thread.some((m) => m.type === 'system')).toBe(false);
      expect(conversation.participants.some((p) => p.kind === 'system')).toBe(false);
    });
  });
});

describe('the Personal ("me") scope (posts from multiple teams)', () => {
  const TEAM_NAMES: Record<string, string> = {
    'team-1': 'Platform Team',
    'team-2': 'Support Team',
  };
  const getTeamName = (teamId: string) => TEAM_NAMES[teamId];

  it('groups posts from every team the same way (person), each labeled with its own team', () => {
    const posts = [
      makePost({ id: 'p1', teamId: 'team-1', postDate: '2026-09-29' }),
      makePost({ id: 'p2', teamId: 'team-2', postDate: '2026-09-29' }),
    ];
    const [conversation] = postsToConversations(posts, 'person', VIEWER_MEMBER, NOW, getTeamName);
    expect(conversation.thread).toHaveLength(2);
    const byId = new Map(conversation.thread.map((m) => [m.id, m]));
    expect(byId.get('p1')?.text).toContain('Platform Team');
    expect(byId.get('p2')?.text).toContain('Support Team');
  });
});

describe('attachments', () => {
  const image = (name: string) => ({
    mediaId: `m-${name}`,
    type: 'image' as const,
    url: `http://localhost:3100/uploads/media/${name}`,
    filename: name,
  });

  it("shows a post's images under its text, those inlined in it too", () => {
    const post = makePost({
      id: 'p1',
      content: {
        text: 'Look ![shot](/uploads/media/a.png) and ![logo](https://cdn.example/logo.png)',
        mentions: [],
      },
      attachments: [image('a.png'), image('b.png')],
    });
    const [message] = postsToConversations([post], 'day', VIEWER_MEMBER, NOW)[0].thread;
    // An attached image leaves the text; one that isn't attached stays.
    expect(message.text).not.toContain('a.png');
    expect(message.text).toContain('![logo](https://cdn.example/logo.png)');
    expect(message.media?.map((m) => [m.id, m.kind, m.title])).toEqual([
      ['m-a.png', 'image', 'a.png'],
      ['m-b.png', 'image', 'b.png'],
    ]);
  });

  it("makes an uploaded video media and a document one of the message's files", () => {
    const post = makePost({
      id: 'p1',
      content: { text: 'Spec and demo', mentions: [] },
      attachments: [
        { mediaId: 'm-v', type: 'video', url: '/uploads/media/demo.mp4', filename: 'demo.mp4' },
        { mediaId: 'm-f', type: 'file', url: '/uploads/media/spec.pdf', filename: 'spec.pdf' },
      ],
    });
    const [message] = postsToConversations([post], 'day', VIEWER_MEMBER, NOW)[0].thread;
    expect(message.text).not.toContain('spec.pdf');
    expect(message.media).toEqual([
      expect.objectContaining({
        id: 'm-v',
        kind: 'video',
        src: expect.stringMatching(/\/uploads\/media\/demo\.mp4$/),
        caption: 'Spec and demo',
      }),
    ]);
    expect(message.files).toEqual([
      { id: 'm-f', name: 'spec.pdf', url: expect.stringMatching(/\/uploads\/media\/spec\.pdf$/) },
    ]);
  });

  it('saves an edit without the images it showed under the text', () => {
    const post = makePost({
      id: 'p1',
      content: { text: 'Before\n\n![shot](/uploads/media/a.png)\n\nAfter', mentions: [] },
      attachments: [image('a.png')],
    });
    const [message] = postsToConversations([post], 'day', VIEWER_MEMBER, NOW)[0].thread;
    expect(shownBody(post)).toBe('Before\n\nAfter');
    const edited = message.text!.replace('After', 'After, edited');
    expect(stripInboxDecorations(edited, message.text!, shownBody(post))).toBe(
      'Before\n\nAfter, edited',
    );
  });

  it("makes a post's Pulse video the message's media, not text", () => {
    const videoId = '0b8e2c1a-3f4d-4e5a-9b6c-7d8e9f0a1b2c';
    const post = makePost({
      id: 'p1',
      content: { text: 'Standup', mentions: [] },
      attachments: [
        {
          mediaId: 'm-v',
          type: 'video',
          url: `/pulsevault/artifacts/${videoId}`,
          filename: 'clip.mp4',
          name: 'Sprint review',
        },
      ],
    });
    const [message] = postsToConversations([post], 'day', VIEWER_MEMBER, NOW)[0].thread;
    expect(message.text).not.toContain(videoId);
    expect(message.media).toEqual([
      {
        id: videoId,
        kind: 'video',
        src: expect.stringMatching(new RegExp(`/pulsevault/artifacts/${videoId}$`)),
        poster: expect.stringMatching(new RegExp(`/pulsevault/artifacts/${videoId}/poster$`)),
        title: 'Sprint review',
        caption: 'Standup',
      },
    ]);
  });

  it("shows a video by the name it was renamed to in this tab, over the post's", () => {
    const videoId = '0b8e2c1a-3f4d-4e5a-9b6c-7d8e9f0a1b2d';
    const post = makePost({
      id: 'p1',
      attachments: [
        {
          mediaId: 'm-v',
          type: 'video',
          url: `/pulsevault/artifacts/${videoId}`,
          filename: 'clip.mp4',
          name: 'Old name',
        },
      ],
    });
    const shownName = () =>
      postsToConversations([post], 'day', VIEWER_MEMBER, NOW)[0].thread[0].media?.[0]?.title;
    expect(shownName()).toBe('Old name');
    noteRenamed(videoId, 'New name');
    expect(shownName()).toBe('New name');
    noteRenamed(videoId, null);
    expect(shownName()).toBeUndefined();
  });

  it('lets a fetch after a rename take over, but not one from before it', () => {
    const videoId = '1c9f3d2b-4a5e-4f6b-8c7d-8e9f0a1b2c3e';
    const post = makePost({
      id: 'p1',
      attachments: [
        {
          mediaId: 'm-v',
          type: 'video',
          url: `/pulsevault/artifacts/${videoId}`,
          filename: 'clip.mp4',
          name: 'Posted name',
        },
      ],
    });
    const shownName = () =>
      postsToConversations([post], 'day', VIEWER_MEMBER, NOW)[0].thread[0].media?.[0]?.title;
    const beforeRename = Date.now() - 1000;
    noteRenamed(videoId, 'Renamed here');
    // A fetch that started before the rename brings older news.
    noteVideoNames([[videoId, 'Posted name']], beforeRename);
    expect(shownName()).toBe('Renamed here');
    // Another tab renames it again; the next fetch brings that.
    noteVideoNames([[videoId, 'Renamed elsewhere']], Date.now() + 1000);
    expect(shownName()).toBe('Renamed elsewhere');
  });
});

describe('searchConversations', () => {
  const posts = [
    makePost({
      id: 'p1',
      content: { text: 'Shipped the onboarding checklist', mentions: [] },
      tickets: [{ id: 't-1', title: 'Onboarding checklist' }],
      clockEventId: 'evt-1',
      session: { startTime: SEP_29_0858, endTime: SEP_29_1032 },
      wrapUpAt: new Date(SEP_29_1032).toISOString(),
      attachments: [
        { mediaId: 'm1', type: 'file', url: '/uploads/spec.pdf', filename: 'spec.pdf' },
      ],
    }),
    makePost({
      id: 'p2',
      userId: 'user-priya',
      userName: 'Priya Sharma',
      content: { text: 'Reviewing PRs', mentions: [] },
      createdAt: new Date(SEP_28_0900).toISOString(),
    }),
  ];
  const all = postsToConversations(posts, 'session', VIEWER_MEMBER, NOW);
  const titlesFor = (query: string) =>
    searchConversations(all, posts, query).map(
      (c) => c.thread.find((m) => m.id.startsWith('p'))?.id,
    );

  it('returns everything for a blank query', () => {
    expect(searchConversations(all, posts, '   ')).toHaveLength(2);
  });

  it.each([
    ['post text', 'reviewing'],
    ['author', 'priya'],
    ['ticket title', 'onboarding'],
    ['attachment filename', 'spec.pdf'],
    ['wrap-up label', 'wrap-up'],
    ['clock line', 'clocked out'],
    ['ISO date', '2026-09-28'],
    ['month name', 'september 28'],
  ])('matches by %s', (_field, query) => {
    expect(titlesFor(query).length).toBeGreaterThan(0);
  });

  it('requires every word, across fields, and ignores case and accents', () => {
    expect(titlesFor('AISHA Onbóarding')).toEqual(['p1']);
    expect(titlesFor('aisha reviewing')).toEqual([]);
  });

  it('does not match on media URLs', () => {
    expect(titlesFor('uploads')).toEqual([]);
  });

  it('matches a Pulse video by its name and file, never its id', () => {
    const videoId = '0b7e7c1e-5a3f-4c1d-9e2a-6f1d2c3b4a59';
    const withVideo = [
      makePost({
        id: 'p4',
        content: { text: 'Demo', mentions: [] },
        attachments: [
          {
            mediaId: 'm4',
            type: 'video',
            url: `/pulsevault/artifacts/${videoId}`,
            filename: 'Standup recap',
            name: 'Sprint review',
          },
        ],
      }),
    ];
    const grouped = postsToConversations(withVideo, 'session', VIEWER_MEMBER, NOW);
    const hits = (query: string) => searchConversations(grouped, withVideo, query).length;
    expect(hits('standup recap')).toBe(1);
    expect(hits('sprint review')).toBe(1);
    expect(hits('demo')).toBe(1);
    for (const query of [videoId, 'pulsevault']) expect(hits(query)).toBe(0);
  });

  it('searches a post built to be slow to strip without stalling', () => {
    const slow = [
      makePost({
        id: 'p7',
        content: {
          // Link openers with no target end, many times over.
          text: `Slow\n\n${'](x'.repeat(40_000)}`,
          mentions: [],
        },
      }),
    ];
    const grouped = postsToConversations(slow, 'session', VIEWER_MEMBER, NOW);
    const started = performance.now();
    expect(searchConversations(grouped, slow, 'slow')).toHaveLength(1);
    expect(performance.now() - started).toBeLessThan(500);
  });

  it('still matches inside other GenUI blocks, which show as code', () => {
    const withChart = [
      makePost({
        id: 'p5',
        content: {
          text: 'Numbers\n\n```genui\n{"widget":"chart","props":{"series":"latency"}}\n```',
          mentions: [],
        },
      }),
    ];
    const grouped = postsToConversations(withChart, 'session', VIEWER_MEMBER, NOW);
    expect(searchConversations(grouped, withChart, 'latency')).toHaveLength(1);
  });

  it('finds off-the-clock and live posts the same way in every view', () => {
    const livePost = makePost({
      id: 'p3',
      userId: 'user-priya',
      userName: 'Priya Sharma',
      clockEventId: 'evt-live',
      session: { startTime: SEP_29_1032, endTime: null },
    });
    const withLive = [...posts, livePost];
    for (const threadBy of ['day', 'session', 'person', 'ticket'] as const) {
      const grouped = postsToConversations(withLive, threadBy, VIEWER_MEMBER, NOW);
      const idsFor = (query: string) =>
        searchConversations(grouped, withLive, query).flatMap((c) =>
          c.thread.filter((m) => m.type !== 'system').map((m) => m.id),
        );
      expect(idsFor('off the clock')).toContain('p2');
      expect(idsFor('live')).toContain('p3');
    }
  });
});

describe('starterConversation', () => {
  const viewer = { userId: 'u1', name: 'Test User' };

  it('lists only the viewer, so no system avatar shows in the header', () => {
    const conversation = starterConversation(viewer, 'team', NOW);
    expect(conversation.participants.map((p) => p.id)).toEqual(['u1']);
    expect(conversation.participants[0]).toMatchObject({ kind: 'human', name: 'Test User' });
  });

  it('holds a single system hint pointing at the input and Clock In', () => {
    const { thread } = starterConversation(viewer, 'team', NOW);
    expect(thread).toHaveLength(1);
    expect(thread[0]).toMatchObject({ type: 'system' });
    expect(thread[0].text).toMatch(/share what you.re working on below/i);
    expect(thread[0].text).toMatch(/clock in/i);
  });

  it('words the hint for the Personal view', () => {
    const { thread } = starterConversation(viewer, 'me', NOW);
    expect(thread[0].text).toMatch(/last 30 days/);
  });
});

describe('Today as the default conversation', () => {
  const viewer = { userId: 'u1', name: 'Test User' };
  const older = [makePost({ id: 'old', createdAt: new Date(SEP_28_0900).toISOString() })];
  const withToday = [makePost({ id: 'new', createdAt: new Date(SEP_29_0858).toISOString() })];

  function dayConversations(posts: HuddlePost[]) {
    const grouped = postsToConversations(posts, 'day', VIEWER_MEMBER, NOW);
    return withTodayConversation(grouped, 'day', viewer, 'team', NOW);
  }

  it('adds an empty Today to Day grouping when nobody has posted today', () => {
    const conversations = dayConversations(older);
    expect(conversations.map((c) => c.id)).toEqual(['day:2026-09-29', 'day:2026-09-28']);
    expect(conversations[0].thread).toHaveLength(1);
  });

  it('leaves a real Today thread alone', () => {
    const conversations = dayConversations(withToday);
    expect(conversations.map((c) => c.id)).toEqual(['day:2026-09-29']);
    expect(conversations[0].thread[0].id).toBe('new');
  });

  it('adds nothing in other groupings or when there are no posts at all', () => {
    const grouped = postsToConversations(older, 'ticket', VIEWER_MEMBER, NOW);
    expect(withTodayConversation(grouped, 'ticket', viewer, 'team', NOW)).toBe(grouped);
    expect(withTodayConversation([], 'day', viewer, 'team', NOW)).toEqual([]);
  });

  it('opens Today in Day grouping even when an older day is more recent in the list', () => {
    const conversations = dayConversations(older);
    const reordered = [conversations[1], conversations[0]];
    expect(defaultConversation(reordered, 'day', NOW)?.id).toBe('day:2026-09-29');
  });

  it('opens the first conversation in other groupings', () => {
    const conversations = postsToConversations(older, 'person', VIEWER_MEMBER, NOW);
    expect(defaultConversation(conversations, 'person', NOW)).toBe(conversations[0]);
  });

  it('rolls over at local midnight', () => {
    const nextDay = localMs(2026, 9, 30, 0, 1);
    const grouped = postsToConversations(withToday, 'day', VIEWER_MEMBER, nextDay);
    const conversations = withTodayConversation(grouped, 'day', viewer, 'team', nextDay);
    expect(defaultConversation(conversations, 'day', nextDay)?.id).toBe('day:2026-09-30');
  });
});
