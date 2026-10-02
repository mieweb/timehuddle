import { describe, expect, it } from 'vitest';
import type { HuddlePost } from '@lib/api';
import {
  postsToConversations,
  searchConversations,
  starterConversation,
  stripInboxDecorations,
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
        makePost({ id: 'p1', ticketId: 'tkt-1', ticketTitle: 'Onboarding checklist' }),
        makePost({ id: 'p2', ticketId: 'tkt-1', ticketTitle: 'Onboarding checklist' }),
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
    it('marks a live session (no endTime) as "● Live" with no clock-out message', () => {
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
      expect(systemMessages).toHaveLength(1);
      expect(systemMessages[0].text).toContain('Clocked in');
    });

    it('adds both clock-in and clock-out messages for a finished session', () => {
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
      expect(systemMessages).toHaveLength(2);
      expect(systemMessages[0].text).toContain('Clocked in');
      expect(systemMessages[1].text).toContain('Clocked out');
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

  describe('ticket threads', () => {
    it('never include clock in/out messages, even when posts carry session data', () => {
      const posts = [
        makePost({
          id: 'p1',
          ticketId: 'tkt-1',
          ticketTitle: 'Onboarding checklist',
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
  it('skips attachments already embedded in the post text', () => {
    const post = makePost({
      id: 'p1',
      content: { text: 'Look ![shot](/uploads/media/a.png)', mentions: [] },
      attachments: [
        {
          mediaId: 'm-a',
          type: 'image',
          url: 'http://localhost:3100/uploads/media/a.png',
          filename: 'a.png',
        },
        {
          mediaId: 'm-b',
          type: 'image',
          url: 'http://localhost:3100/uploads/media/b.png',
          filename: 'b.png',
        },
      ],
    });
    const [conversation] = postsToConversations([post], 'day', VIEWER_MEMBER, NOW);
    const text = conversation.thread[0].text ?? '';
    expect(text.match(/a\.png/g)).toHaveLength(1);
    expect(text).toContain('![b.png]');
  });
});

describe('searchConversations', () => {
  const posts = [
    makePost({
      id: 'p1',
      content: { text: 'Shipped the onboarding checklist', mentions: [] },
      ticketId: 't-1',
      ticketTitle: 'Onboarding checklist',
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
